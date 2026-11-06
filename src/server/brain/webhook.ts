import { createHmac, timingSafeEqual } from 'node:crypto';
import { query, transaction } from '@/lib/db';
import { tenantSpecialties } from '@/server/specialties';
import { brainConfig } from './client';

// Eventos do brain-desk. O que importa para a Integrar é o fim de cada execução da IA:
// a resposta vira mensagem, a decisão vira fila/estágio da conversa e a linha de agent_runs
// (criada ao enviar a mensagem) recebe decisão e rastro, como no motor local.

type BrainEvent = {
  id: string;
  event: string;
  created_at: string;
  conversation: { id: string; external_ref: string; context: any; test: boolean };
  data: any;
};

const seen = new Map<string, number>();

export function verifySignature(header: string | null, raw: string) {
  const secret = brainConfig().webhookSecret;
  const m = /^t=(\d+),v1=([0-9a-f]+)$/.exec(header || '');
  if (!secret || !m) return false;
  if (Math.abs(Date.now() / 1000 - Number(m[1])) > 300) return false;
  const expected = createHmac('sha256', secret).update(`${m[1]}.${raw}`).digest('hex');
  return (
    expected.length === m[2].length && timingSafeEqual(Buffer.from(expected), Buffer.from(m[2]))
  );
}

export async function handleBrainEvent(req: Request) {
  if (!brainConfig().enabled)
    return Response.json({ error: 'AI_ENGINE não é brain.' }, { status: 404 });
  const raw = await req.text();
  if (!verifySignature(req.headers.get('x-brain-signature'), raw))
    return Response.json({ error: 'Assinatura inválida.' }, { status: 401 });
  let ev: BrainEvent;
  try {
    ev = JSON.parse(raw);
  } catch {
    return Response.json({ error: 'JSON inválido.' }, { status: 400 });
  }
  for (const [k, at] of seen) if (Date.now() - at > 3600000) seen.delete(k);
  if (seen.has(ev.id)) return new Response(null, { status: 204 });
  seen.set(ev.id, Date.now());
  try {
    await applyEvent(ev);
  } catch (e) {
    console.error('[brain-webhook]', ev.event, (e as Error).message);
    return Response.json({ error: 'Falha ao aplicar o evento.' }, { status: 500 });
  }
  return new Response(null, { status: 204 });
}

const now = () => new Date().toISOString();

export async function applyEvent(ev: BrainEvent) {
  const ctx = ev.conversation.context || {};
  const conversationId = /^integrar:(.+)$/.exec(ev.conversation.external_ref)?.[1];
  if (!conversationId || !ctx.tenant_id) return;
  if (ev.event === 'execucao.falhou') {
    await query(
      "UPDATE agent_runs SET status='FAILED',error_code=$3,error_message=$4,finished_at=now() WHERE tenant_id=$1 AND conversation_id=$2 AND provider='brain' AND status IN('QUEUED','RUNNING') AND (lease_id=$5 OR lease_id IS NULL)",
      [
        ctx.tenant_id,
        conversationId,
        ev.data.codigo || 'BRAIN_ERROR',
        ev.data.erro || 'A IA não concluiu.',
        ev.data.execucao_id,
      ],
    );
    return;
  }
  if (ev.event !== 'execucao.concluida') return;
  const d = ev.data;
  const decisionIn = d.decisao || {};
  const specialtyCodes = new Set((await tenantSpecialties(ctx.tenant_id)).map((s) => s.code));
  await transaction(async (c) => {
    const {
      rows: [run],
    } = await c.query(
      "SELECT * FROM agent_runs WHERE tenant_id=$1 AND conversation_id=$2 AND provider='brain' AND status IN('QUEUED','RUNNING') AND (lease_id=$3 OR lease_id IS NULL) ORDER BY created_at DESC LIMIT 1 FOR UPDATE",
      [ctx.tenant_id, conversationId, d.execucao_id],
    );
    if (!run) return;
    const {
      rows: [conv],
    } = await c.query('SELECT * FROM conversations WHERE tenant_id=$1 AND id=$2 FOR UPDATE', [
      ctx.tenant_id,
      conversationId,
    ]);
    const agentName =
      (run.agent_snapshot?.profiles || []).find((p: any) => p.specialty === d.agente)?.name ||
      run.agent_snapshot?.selected?.name ||
      'Assistente';
    const trace = [
      {
        at: now(),
        kind: 'run',
        title: 'Execução no brain-desk',
        data: { execucao_id: d.execucao_id, agente: d.agente },
      },
      ...(d.ferramentas || []).map((f: any) => ({
        at: now(),
        kind: 'tool',
        title: f.nome,
        data: {
          arguments: f.argumentos,
          result:
            f.nome === 'consultar_cenarios' && Array.isArray(f.resultado)
              ? {
                  cenarios: f.resultado.map((x: any) => ({
                    ...x,
                    id: x.referencia_externa || x.id,
                  })),
                }
              : f.resultado,
        },
      })),
    ];
    if (
      !conv ||
      conv.deleted_at ||
      conv.ai_mode !== 'AI' ||
      conv.automation_epoch !== run.automation_epoch
    ) {
      await c.query(
        "UPDATE agent_runs SET status='CANCELLED',error_code='HTTP_409',error_message='Controle alterado. Resposta cancelada.',trace=$2,finished_at=now() WHERE id=$1",
        [run.id, JSON.stringify(trace)],
      );
      return;
    }
    const handoff = decisionIn.next_action === 'HANDOFF';
    let queueId: string | null = null;
    if (handoff) {
      const {
        rows: [q],
      } = await c.query(
        'SELECT id,code FROM service_queues WHERE tenant_id=$1 AND unit_id=$2 AND active=true ORDER BY (code=$3) DESC,(code=$4) DESC LIMIT 1',
        [ctx.tenant_id, run.unit_id, decisionIn.destination, 'recepcao'],
      );
      queueId = q?.id ?? null;
      if (q && q.code !== decisionIn.destination) decisionIn.destination = q.code;
    }
    const {
      rows: [proposal],
    } = await c.query(
      'SELECT appointments FROM conversation_proposals WHERE tenant_id=$1 AND agent_run_id=$2',
      [ctx.tenant_id, run.id],
    );
    const {
      rows: [planItem],
    } = await c.query(
      "SELECT i.professional_id FROM referral_items i JOIN referral_plans p ON p.id=i.plan_id WHERE i.tenant_id=$1 AND i.conversation_id=$2 AND p.status='ACTIVE' AND i.professional_id IS NOT NULL ORDER BY i.position LIMIT 1",
      [ctx.tenant_id, conversationId],
    );
    const recommended =
      planItem?.professional_id || proposal?.appointments?.[0]?.professional_id || null;
    const decision = {
      reply: String(decisionIn.reply || ''),
      summary: String(decisionIn.summary || ''),
      confidence: Number(decisionIn.confidence ?? 0),
      next_action: decisionIn.next_action || 'ANSWER',
      handoff_reason:
        decisionIn.handoff_reason === 'SPECIALIST_REVIEW'
          ? 'CLINICAL_REVIEW'
          : (decisionIn.handoff_reason ?? null),
      destination: handoff && queueId ? decisionIn.destination : 'AI',
      requires_human: !!decisionIn.requires_human,
      recommended_specialties: (decisionIn.labels || []).filter((l: string) =>
        specialtyCodes.has(l),
      ),
      professional_ids: recommended ? [recommended] : [],
      missing_information: decisionIn.missing_information || [],
      evidence: decisionIn.evidence || [],
    };
    trace.push({
      at: now(),
      kind: 'decision',
      title: 'Decisão estruturada',
      data: {
        summary: decision.summary,
        destination: decision.destination,
        confidence: decision.confidence,
      },
    } as any);
    const scenarios = (d.ferramentas || [])
      .filter((f: any) => f.nome === 'consultar_cenarios' && Array.isArray(f.resultado))
      .flatMap((f: any) => f.resultado);
    if (scenarios.length)
      trace.push({
        at: now(),
        kind: 'scenarios',
        title: 'Cenários consultados',
        data: scenarios.map((s: any) => ({
          id: s.referencia_externa || s.id,
          version: s.versao,
          title: s.titulo,
        })),
      } as any);
    await c.query(
      "INSERT INTO messages(tenant_id,conversation_id,direction,content,agent_run_id,agent_name) VALUES($1,$2,'OUTBOUND',$3,$4,$5) ON CONFLICT DO NOTHING",
      [ctx.tenant_id, conversationId, decision.reply, run.id, agentName],
    );
    await c.query(
      'UPDATE conversations SET summary=$3,queue_id=$4,recommended_professional_id=$5,ai_mode=$6,status=$7,stage=$8,version=version+1 WHERE tenant_id=$1 AND id=$2',
      [
        ctx.tenant_id,
        conversationId,
        decision.summary,
        queueId,
        recommended,
        queueId ? 'HUMAN' : 'AI',
        queueId ? 'REVIEW' : 'WAITING',
        proposal
          ? 'PROPOSAL'
          : queueId
            ? 'HUMAN'
            : decision.next_action === 'ASK_USER'
              ? 'CLARIFYING'
              : 'TRIAGE',
      ],
    );
    await c.query(
      "UPDATE agent_runs SET status='COMPLETED',decision=$2,trace=$3,input_tokens=$4,output_tokens=$5,finished_at=now() WHERE id=$1",
      [
        run.id,
        JSON.stringify(decision),
        JSON.stringify(trace),
        d.tokens?.entrada || 0,
        d.tokens?.saida || 0,
      ],
    );
    await c.query(
      "INSERT INTO audit_events(tenant_id,unit_id,actor_id,action,entity_type,entity_id,details) VALUES($1,$2,$3,'sandbox.run_completed','conversations',$4,$5)",
      [
        ctx.tenant_id,
        run.unit_id,
        run.requested_by,
        conversationId,
        JSON.stringify({ runId: run.id, engine: 'brain', destination: decision.destination }),
      ],
    );
  });
}
