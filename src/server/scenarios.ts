import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { query, transaction } from '@/lib/db';
import { ApiError } from '@/lib/errors';
import { permit, assertUnit, type Context } from '@/lib/security';
import { audit, managers } from './repository';
import { normalize } from './professional-profiles';
import { createSandbox, enqueueSandbox } from './sandbox';
import { queueCodes } from './ai/contracts';
// Cenários da IA: situações recorrentes com orientação de como agir. A IA busca os publicados com consultar_cenarios;
// cada cenário também é um teste (mensagem de teste + desfecho esperado) executado no Sandbox.
const actions = ['ASK_USER', 'ANSWER', 'HANDOFF'] as const,
  destinations = ['AI', ...queueCodes] as const;
export const scenarioSchema = z
  .object({
    title: z.string().trim().min(3).max(120),
    situation: z.string().trim().min(10).max(1000),
    guidance: z.string().trim().min(10).max(3000),
    example: z.string().trim().max(2000).default(''),
    avoid: z.string().trim().max(1000).default(''),
    test_message: z.string().trim().max(1000).default(''),
    expected_action: z.enum(actions).nullable().default(null),
    expected_destination: z.enum(destinations).nullable().default(null),
    tags: z.array(z.string().trim().min(2).max(40)).max(12).default([]),
    agent_specialties: z.array(z.string().trim().min(2).max(40)).max(8).default([]),
  })
  .strict();
const columns = [
  'title',
  'situation',
  'guidance',
  'example',
  'avoid',
  'test_message',
  'expected_action',
  'expected_destination',
  'tags',
  'agent_specialties',
] as const;
const forAgent = '(cardinality(agent_specialties)=0 OR $2=ANY(agent_specialties))';
// Termos normalizados viram uma busca OU no PostgreSQL (stemming em português); etiquetas iguais pesam mais.
export function searchTerms(text: string) {
  return [
    ...new Set(
      normalize(text)
        .split(/[^a-z0-9]+/)
        .filter((w) => w.length >= 3),
    ),
  ]
    .slice(0, 24)
    .join(' | ');
}
export async function searchScenarios(
  tenantId: string,
  specialty: string,
  text: string,
  tags: string[] = [],
  limit = 3,
) {
  const terms = searchTerms(text),
    normTags = tags.map((t) => normalize(t)).filter(Boolean);
  if (!terms && !normTags.length) return [];
  const rows = await query(
    `SELECT id,title,situation,guidance,example,avoid,expected_action,expected_destination,tags,version,
   (CASE WHEN $3='' THEN 0 ELSE ts_rank(to_tsvector('portuguese',ai_norm(title||' '||situation||' '||array_to_string(tags,' '))),to_tsquery('portuguese',$3)) END)
   +0.4*cardinality(ARRAY(SELECT ai_norm(t) FROM unnest(tags) t INTERSECT SELECT unnest($4::text[]))) AS score
  FROM ai_scenarios WHERE tenant_id=$1 AND status='PUBLISHED' AND ${forAgent} ORDER BY score DESC,title LIMIT $5`,
    [tenantId, specialty, terms, normTags, limit],
  );
  return rows.filter((r) => Number(r.score) > 0);
}
// Índice curto para o prompt: a IA sabe quais situações têm orientação sem pagar o texto inteiro a cada rodada.
export async function scenarioIndex(tenantId: string, specialty: string) {
  return query(
    `SELECT title FROM ai_scenarios WHERE tenant_id=$1 AND status='PUBLISHED' AND ${forAgent} ORDER BY title LIMIT 40`,
    [tenantId, specialty],
  ).then((r) => r.map((x) => x.title as string));
}
export function scenarioForModel(s: any) {
  return {
    id: s.id,
    versao: s.version,
    titulo: s.title,
    quando_se_aplica: s.situation,
    como_lidar: s.guidance,
    exemplo: s.example || null,
    nao_fazer: s.avoid || null,
    desfecho_esperado: s.expected_action
      ? { next_action: s.expected_action, destination: s.expected_destination }
      : s.expected_destination
        ? { destination: s.expected_destination }
        : null,
  };
}

async function scenarioRow(c: import('pg').PoolClient, ctx: Context, id: string, lock = false) {
  z.uuid().parse(id);
  const {
    rows: [s],
  } = await c.query(
    `SELECT * FROM ai_scenarios WHERE tenant_id=$1 AND id=$2${lock ? ' FOR UPDATE' : ''}`,
    [ctx.tenantId, id],
  );
  if (!s) throw new ApiError(404, 'Cenário não encontrado.');
  return s;
}
export async function listScenarios(ctx: Context, params: URLSearchParams) {
  permit(ctx, managers);
  await refreshScenarioRuns(ctx);
  const status = z
      .enum(['ACTIVE', 'PUBLISHED', 'DRAFT', 'ARCHIVED', 'ALL'])
      .catch('ACTIVE')
      .parse(params.get('status')),
    q = (params.get('q') || '').trim().slice(0, 100);
  const data = await query(
    `SELECT s.*,u.name AS updated_by_name,r.status AS last_test_status,r.created_at AS last_test_at,r.version AS last_test_version FROM ai_scenarios s LEFT JOIN users u ON u.id=s.updated_by LEFT JOIN LATERAL(SELECT status,created_at,version FROM ai_scenario_runs WHERE scenario_id=s.id ORDER BY created_at DESC LIMIT 1)r ON true
  WHERE s.tenant_id=$1 AND ($2='ALL' OR ($2='ACTIVE' AND s.status<>'ARCHIVED') OR s.status=$2) AND ($3='' OR ai_norm(s.title||' '||s.situation||' '||array_to_string(s.tags,' ')) LIKE '%'||ai_norm($3)||'%') ORDER BY s.status='PUBLISHED' DESC,s.title`,
    [ctx.tenantId, status, q],
  );
  const agents = await query(
    'SELECT name,specialty,use_scenarios,enabled FROM agents WHERE tenant_id=$1 ORDER BY name',
    [ctx.tenantId],
  );
  const [s] = await query(
    "SELECT count(*) FILTER(WHERE status='PUBLISHED')::int AS published,count(*) FILTER(WHERE status='DRAFT')::int AS drafts FROM ai_scenarios WHERE tenant_id=$1",
    [ctx.tenantId],
  );
  return { data, agents, summary: s };
}
export async function scenarioDetail(ctx: Context, id: string) {
  permit(ctx, managers);
  await refreshScenarioRuns(ctx, id);
  return transaction(async (c) => {
    const s = await scenarioRow(c, ctx, id);
    const { rows: versions } = await c.query(
      'SELECT v.version,v.created_at,u.name AS author FROM ai_scenario_versions v LEFT JOIN users u ON u.id=v.created_by WHERE v.scenario_id=$1 ORDER BY v.version DESC LIMIT 30',
      [id],
    );
    const { rows: runs } = await c.query(
      'SELECT r.id,r.version,r.status,r.checks,r.reply,r.created_at,r.finished_at,r.agent_run_id,u.name AS author FROM ai_scenario_runs r LEFT JOIN users u ON u.id=r.created_by WHERE r.scenario_id=$1 ORDER BY r.created_at DESC LIMIT 20',
      [id],
    );
    return { ...s, versions, runs };
  });
}
export async function saveScenario(ctx: Context, id: string | null, input: unknown) {
  permit(ctx, managers);
  const body = z
    .object({ version: z.number().int().positive().optional() })
    .passthrough()
    .parse(input);
  const d = scenarioSchema.parse(
    Object.fromEntries(Object.entries(body).filter(([k]) => k !== 'version')),
  );
  if (
    d.expected_action === 'HANDOFF' &&
    (!d.expected_destination || d.expected_destination === 'AI')
  )
    throw new ApiError(422, 'Encaminhamento esperado precisa de uma fila de destino.');
  if (
    d.expected_action &&
    d.expected_action !== 'HANDOFF' &&
    d.expected_destination &&
    d.expected_destination !== 'AI'
  )
    throw new ApiError(422, 'Sem encaminhamento, o destino esperado é a própria IA.');
  return transaction(async (c) => {
    let row;
    if (id) {
      const s = await scenarioRow(c, ctx, id, true);
      if (body.version !== s.version)
        throw new ApiError(409, 'O cenário mudou. Atualize antes de salvar.');
      ({
        rows: [row],
      } = await c.query(
        `UPDATE ai_scenarios SET ${columns.map((k, i) => `${k}=$${i + 3}`).join(',')},version=version+1,updated_by=$${columns.length + 3},updated_at=now() WHERE tenant_id=$1 AND id=$2 RETURNING *`,
        [ctx.tenantId, id, ...columns.map((k) => d[k]), ctx.userId],
      ));
    } else
      ({
        rows: [row],
      } = await c.query(
        `INSERT INTO ai_scenarios(tenant_id,${columns.join(',')},created_by,updated_by) VALUES($1,${columns.map((_, i) => '$' + (i + 2)).join(',')},$${columns.length + 2},$${columns.length + 2}) RETURNING *`,
        [ctx.tenantId, ...columns.map((k) => d[k]), ctx.userId],
      ));
    await c.query(
      'INSERT INTO ai_scenario_versions(tenant_id,scenario_id,version,snapshot,created_by) VALUES($1,$2,$3,$4,$5)',
      [ctx.tenantId, row.id, row.version, JSON.stringify(row), ctx.userId],
    );
    await audit(
      c,
      ctx,
      id ? 'scenario.updated' : 'scenario.created',
      'ai_scenarios',
      row.id,
      null,
      { version: row.version, status: row.status },
    );
    return row;
  });
}
export async function setScenarioStatus(ctx: Context, id: string, input: unknown) {
  permit(ctx, managers);
  const d = z
    .object({
      status: z.enum(['DRAFT', 'PUBLISHED', 'ARCHIVED']),
      version: z.number().int().positive(),
    })
    .strict()
    .parse(input);
  return transaction(async (c) => {
    const s = await scenarioRow(c, ctx, id, true);
    if (d.version !== s.version)
      throw new ApiError(409, 'O cenário mudou. Atualize antes de continuar.');
    const {
      rows: [row],
    } = await c.query(
      'UPDATE ai_scenarios SET status=$3,updated_by=$4,updated_at=now() WHERE tenant_id=$1 AND id=$2 RETURNING *',
      [ctx.tenantId, id, d.status, ctx.userId],
    );
    await audit(c, ctx, 'scenario.' + d.status.toLowerCase(), 'ai_scenarios', id, null, {
      version: row.version,
    });
    return row;
  });
}

// Teste: a mensagem de teste roda numa sessão de Sandbox própria; ao terminar, o desfecho é comparado com o esperado
// e a sessão é arquivada para não aparecer nas filas.
export async function testScenario(ctx: Context, id: string, input: unknown) {
  permit(ctx, managers);
  const d = z.object({ unit_id: z.uuid() }).strict().parse(input);
  assertUnit(ctx, d.unit_id);
  const [s] = await query('SELECT * FROM ai_scenarios WHERE tenant_id=$1 AND id=$2', [
    ctx.tenantId,
    z.uuid().parse(id),
  ]);
  if (!s) throw new ApiError(404, 'Cenário não encontrado.');
  if (!s.test_message)
    throw new ApiError(422, 'Escreva a mensagem de teste do cenário antes de testar.');
  const agents = await query(
    'SELECT id,specialty,use_scenarios FROM agents WHERE tenant_id=$1 AND enabled=true ORDER BY name',
    [ctx.tenantId],
  );
  const agent = agents.find(
    (a) =>
      a.use_scenarios && (!s.agent_specialties.length || s.agent_specialties.includes(a.specialty)),
  );
  if (!agent)
    throw new ApiError(
      422,
      'Ligue "Usar cenários da clínica" em um agente habilitado para testar este cenário.',
    );
  const conv = await createSandbox(ctx, { unit_id: d.unit_id, consent: true });
  await query('UPDATE conversations SET guardian=$3 WHERE tenant_id=$1 AND id=$2', [
    ctx.tenantId,
    conv.id,
    ('Teste de cenário · ' + s.title).slice(0, 160),
  ]);
  const run = await enqueueSandbox(ctx, conv.id, {
    request_id: randomUUID(),
    content: s.test_message,
    agent_id: agent.id,
  });
  const [row] = await query(
    'INSERT INTO ai_scenario_runs(tenant_id,scenario_id,version,conversation_id,agent_run_id,created_by) VALUES($1,$2,$3,$4,$5,$6) RETURNING id,status',
    [ctx.tenantId, s.id, s.version, conv.id, run.id, ctx.userId],
  );
  return row;
}
type Check = { label: string; passed: boolean; required: boolean; detail: string };
export function evaluateScenario(
  s: { id: string; expected_action: string | null; expected_destination: string | null },
  decision: any,
  trace: any[],
): Check[] {
  const consulted = trace.some(
    (t) =>
      t.kind === 'tool' &&
      t.title === 'consultar_cenarios' &&
      (t.data?.result?.cenarios || []).some((x: any) => x.id === s.id),
  );
  const labels: Record<string, string> = {
    ASK_USER: 'continuar perguntando',
    ANSWER: 'responder',
    HANDOFF: 'encaminhar',
  };
  return [
    {
      label: 'Consultou este cenário',
      passed: consulted,
      required: false,
      detail: consulted
        ? 'A IA buscou e recebeu este cenário.'
        : 'A IA não buscou este cenário. O resultado ainda vale, mas a busca pode precisar de etiquetas melhores.',
    },
    ...(s.expected_action
      ? [
          {
            label: 'Ação esperada',
            passed: decision.next_action === s.expected_action,
            required: true,
            detail: `Esperado: ${labels[s.expected_action]}. A IA decidiu: ${labels[decision.next_action] || decision.next_action}.`,
          },
        ]
      : []),
    ...(s.expected_destination
      ? [
          {
            label: 'Destino esperado',
            passed: decision.destination === s.expected_destination,
            required: true,
            detail: `Esperado: ${s.expected_destination === 'AI' ? 'continuar com a IA' : 'fila ' + s.expected_destination}. A IA enviou para: ${decision.destination === 'AI' ? 'a própria IA' : 'fila ' + decision.destination}.`,
          },
        ]
      : []),
  ];
}
export async function refreshScenarioRuns(ctx: Context, scenarioId?: string) {
  const pending = await query(
    `SELECT r.id,r.conversation_id,s.id AS scenario_id,s.expected_action,s.expected_destination,a.status AS run_status,a.decision,a.trace,a.error_message,r.created_at FROM ai_scenario_runs r JOIN ai_scenarios s ON s.id=r.scenario_id LEFT JOIN agent_runs a ON a.id=r.agent_run_id WHERE r.tenant_id=$1 AND r.status='RUNNING' AND ($2::uuid IS NULL OR r.scenario_id=$2)`,
    [ctx.tenantId, scenarioId || null],
  );
  for (const p of pending) {
    let status: string | null = null,
      checks: Check[] = [];
    if (p.run_status === 'COMPLETED') {
      checks = evaluateScenario(
        {
          id: p.scenario_id,
          expected_action: p.expected_action,
          expected_destination: p.expected_destination,
        },
        p.decision,
        p.trace || [],
      );
      status = checks.every((c) => c.passed || !c.required) ? 'PASSED' : 'FAILED';
    } else if (
      ['FAILED', 'CANCELLED'].includes(p.run_status) ||
      Date.now() - new Date(p.created_at).getTime() > 5 * 60000
    ) {
      status = 'ERROR';
      checks = [
        {
          label: 'Execução',
          passed: false,
          required: true,
          detail:
            p.error_message || 'A análise não terminou. Confira se o worker de IA está rodando.',
        },
      ];
    }
    if (!status) continue;
    await transaction(async (c) => {
      const { rowCount } = await c.query(
        "UPDATE ai_scenario_runs SET status=$2,checks=$3,reply=$4,finished_at=now() WHERE id=$1 AND status='RUNNING'",
        [p.id, status, JSON.stringify(checks), p.decision?.reply || null],
      );
      if (!rowCount) return;
      // Sessão de teste sai do Sandbox e das filas; um plano criado pelo teste não vai para as caixas.
      await c.query(
        "UPDATE conversations SET deleted_at=now(),ai_mode='HUMAN',automation_epoch=automation_epoch+1,version=version+1 WHERE tenant_id=$1 AND id=$2 AND deleted_at IS NULL",
        [ctx.tenantId, p.conversation_id],
      );
      await c.query(
        "UPDATE referral_items SET state='SUPERSEDED',updated_at=now() WHERE tenant_id=$1 AND conversation_id=$2 AND state='PENDING'",
        [ctx.tenantId, p.conversation_id],
      );
      await c.query(
        "UPDATE referral_plans SET status='SUPERSEDED' WHERE tenant_id=$1 AND conversation_id=$2",
        [ctx.tenantId, p.conversation_id],
      );
    });
  }
}
