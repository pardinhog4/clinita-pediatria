import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { query, transaction } from '@/lib/db';
import { ApiError } from '@/lib/errors';
import { zonedInstant } from '@/lib/timezone';
import { unitTimezone } from '@/server/clinic-rules';
import { persistPlan } from '@/server/referrals';
import { executeTool, toolSpecs, type ToolScope } from '@/server/ai/tools';
import { brainConfig } from './client';

// Servidor MCP da Integrar: expõe as ferramentas da clínica para o brain-desk.
// O contexto (tenant, unidade, paciente, prontuário autorizado) vem de _meta, definido pela própria
// Integrar ao abrir a conversa no brain. A IA não consegue alterá-lo.

const META_KEY = 'brain-desk/conversa';
// Ferramentas que o brain já tem por conta própria ou que são internas do motor local.
const hidden = new Set(['finalizar_atendimento', 'consultar_cenarios']);

const contextSchema = z.object({
  tenant_id: z.uuid(),
  unit_id: z.uuid(),
  conversation_id: z.uuid(),
  patient_id: z.uuid().nullable().default(null),
  include_clinical: z.boolean().default(false),
  requested_by: z.uuid(),
});

// Profissionais consultados durante uma execução do brain (para preparar_agendamento só aceitar IDs vistos).
const known = new Map<string, { ids: Set<string>; at: number }>();
function knownFor(runId: string) {
  for (const [k, v] of known) if (Date.now() - v.at > 15 * 60000) known.delete(k);
  const entry = known.get(runId) || { ids: new Set<string>(), at: Date.now() };
  entry.at = Date.now();
  known.set(runId, entry);
  return entry.ids;
}

export function authorizedTools(authorization: string | null) {
  const secret = brainConfig().toolsSecret;
  const given = /^Bearer\s+(.+)$/i.exec(authorization || '')?.[1] || '';
  return (
    !!secret &&
    given.length === secret.length &&
    timingSafeEqual(Buffer.from(given), Buffer.from(secret))
  );
}

export async function handleToolsRequest(req: Request) {
  if (!brainConfig().enabled)
    return Response.json({ error: 'AI_ENGINE não é brain.' }, { status: 404 });
  if (!authorizedTools(req.headers.get('authorization')))
    return Response.json({ error: 'Não autorizado.' }, { status: 401 });
  const server = new Server(
    { name: 'integrar', version: '1.0.0' },
    { capabilities: { tools: {} } },
  );
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: toolSpecs
      .filter((t) => !hidden.has(t.name))
      .map((t) => ({ name: t.name, description: t.description, inputSchema: t.schema as any })),
  }));
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const name = request.params.name;
    try {
      if (hidden.has(name) || !toolSpecs.some((t) => t.name === name))
        throw new ApiError(422, 'Ferramenta não disponível.');
      const meta = (request.params._meta as any)?.[META_KEY] || {};
      const parsed = contextSchema.safeParse(meta.contexto);
      if (!parsed.success) throw new ApiError(422, 'Contexto da conversa ausente ou inválido.');
      const c = parsed.data;
      const runId: string = meta.execucao_id || c.conversation_id;
      const [conv] = await query(
        'SELECT id,patient_id,sandbox,guardian,include_clinical_context,ai_mode FROM conversations WHERE tenant_id=$1 AND unit_id=$2 AND id=$3 AND deleted_at IS NULL',
        [c.tenant_id, c.unit_id, c.conversation_id],
      );
      if (!conv) throw new ApiError(404, 'Conversa não encontrada.');
      if (conv.ai_mode !== 'AI') throw new ApiError(409, 'A equipe assumiu este atendimento.');
      const scope: ToolScope = {
        tenantId: c.tenant_id,
        unitId: c.unit_id,
        patientId: conv.patient_id,
        includeClinical: !!conv.include_clinical_context,
        requestedBy: c.requested_by,
        knownProfessionalIds: knownFor(runId),
        agentSpecialty: meta.agente,
        scenariosEnabled: false,
      };
      const result = (await executeTool(scope, name, request.params.arguments || {})) as any;
      // Efeitos que o motor local aplicava ao fim da execução: aqui acontecem na própria ferramenta.
      if (name === 'buscar_profissionais_compativeis')
        for (const p of result.professionals || []) scope.knownProfessionalIds.add(p.id);
      if (name === 'montar_plano_encaminhamento' && scope.plan)
        await transaction(async (db) => {
          const run = await pendingRun(db, c.tenant_id, c.conversation_id);
          await persistPlan(
            db,
            {
              tenant_id: c.tenant_id,
              unit_id: c.unit_id,
              conversation_id: c.conversation_id,
              id: run,
              requested_by: c.requested_by,
            },
            conv as { patient_id: string | null; sandbox: boolean; guardian: string },
            scope.plan!,
          );
        });
      if (name === 'preparar_agendamento' && result.proposal)
        await transaction(async (db) => {
          const run = await pendingRun(db, c.tenant_id, c.conversation_id);
          const tz = await unitTimezone(c.tenant_id, c.unit_id);
          await db.query(
            'INSERT INTO conversation_proposals(tenant_id,unit_id,conversation_id,patient_id,appointments,request_id,agent_run_id,created_by) VALUES($1,$2,$3,$4,$5,$6,$6,$7) ON CONFLICT DO NOTHING',
            [
              c.tenant_id,
              c.unit_id,
              c.conversation_id,
              conv.patient_id,
              JSON.stringify([
                {
                  professional_id: result.proposal.professional_id,
                  starts_at: zonedInstant(
                    result.proposal.date,
                    result.proposal.time,
                    tz,
                  ).toISOString(),
                  duration: result.proposal.duration,
                },
              ]),
              run,
              c.requested_by,
            ],
          );
        });
      return {
        content: [{ type: 'text', text: JSON.stringify(result) }],
        structuredContent: wrap(result),
      };
    } catch (e) {
      const message =
        e instanceof ApiError
          ? e.message
          : e instanceof z.ZodError
            ? 'Argumentos inválidos: ' +
              e.issues.map((i) => i.path.join('.') + ' ' + i.message).join('; ')
            : 'Falha interna na ferramenta.';
      if (!(e instanceof ApiError) && !(e instanceof z.ZodError))
        console.error('[brain-tools]', name, e);
      return { isError: true, content: [{ type: 'text', text: message }] };
    }
  });
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  await server.connect(transport);
  try {
    return await transport.handleRequest(req);
  } finally {
    void transport.close();
  }
}

/** Execução pendente da conversa (criada ao enviar a mensagem ao brain); a última, se houver. */
async function pendingRun(db: { query: any }, tenantId: string, conversationId: string) {
  const { rows } = await db.query(
    "SELECT id FROM agent_runs WHERE tenant_id=$1 AND conversation_id=$2 AND provider='brain' AND status IN('QUEUED','RUNNING') ORDER BY created_at DESC LIMIT 1",
    [tenantId, conversationId],
  );
  if (!rows[0]) throw new ApiError(409, 'Nenhuma execução pendente para esta conversa.');
  return rows[0].id as string;
}

const wrap = (v: unknown) =>
  (v && typeof v === 'object' && !Array.isArray(v) ? v : { resultado: v }) as Record<
    string,
    unknown
  >;
