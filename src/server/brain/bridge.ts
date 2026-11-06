import { query } from '@/lib/db';
import type { Context } from '@/lib/security';
import { brain, brainQuiet, brainRef, brainEnabled } from './client';

// Ponte entre as conversas da Integrar e o brain-desk: abrir, enviar mensagem da família,
// registrar mensagem da equipe e mudanças de controle (assumir, devolver, transferir, encerrar).

type Conv = {
  id: string;
  unit_id: string;
  patient_id: string | null;
  guardian: string;
  sandbox: boolean;
  include_clinical_context: boolean;
};

export async function openInBrain(ctx: Context, conv: Conv, agentSpecialty?: string | null) {
  return brain('abrir_conversa', {
    referencia_externa: brainRef(conv.id),
    canal: conv.sandbox ? 'sandbox' : 'whatsapp',
    nome_contato: conv.guardian,
    contexto: {
      tenant_id: ctx.tenantId,
      unit_id: conv.unit_id,
      conversation_id: conv.id,
      patient_id: conv.patient_id,
      include_clinical: conv.include_clinical_context,
      requested_by: ctx.userId,
    },
    teste: conv.sandbox,
    ...(agentSpecialty !== undefined ? { agente: agentSpecialty } : {}),
  });
}

/**
 * Manda a mensagem da família ao brain e amarra a execução dele à linha de agent_runs
 * (lease_id guarda o id da execução no brain; o webhook execucao.concluida fecha a linha).
 */
export async function sendToBrain(
  ctx: Context,
  conv: Conv,
  runId: string,
  text: string,
  attachmentIds: string[],
  agentSpecialty?: string | null,
) {
  try {
    await openInBrain(ctx, conv, agentSpecialty);
    const files = attachmentIds.length
      ? await query(
          'SELECT id,name,mime,content FROM sandbox_attachments WHERE tenant_id=$1 AND conversation_id=$2 AND id=ANY($3::uuid[])',
          [ctx.tenantId, conv.id, attachmentIds],
        )
      : [];
    const r = await brain('enviar_mensagem', {
      referencia_externa: brainRef(conv.id),
      texto: text,
      id_requisicao: runId,
      aguardar_resposta: false,
      anexos: files.map((f) => ({
        nome: f.name,
        mime: f.mime,
        base64: f.content.toString('base64'),
        referencia: f.id,
      })),
    });
    if (!r.execucao_id) {
      await query(
        "UPDATE agent_runs SET status='FAILED',error_code='BRAIN_NO_RUN',error_message=$2,finished_at=now() WHERE id=$1 AND status='QUEUED'",
        [
          runId,
          r.situacao === 'COM_EQUIPE'
            ? 'A conversa está com a equipe no brain. Devolva para a IA.'
            : 'O brain não iniciou a análise (automação desligada ou sem agente).',
        ],
      );
      return null;
    }
    await query(
      "UPDATE agent_runs SET status='RUNNING',lease_id=$2,started_at=now(),attempts=1 WHERE id=$1 AND status='QUEUED'",
      [runId, r.execucao_id],
    );
    return r.execucao_id as string;
  } catch (e) {
    await query(
      "UPDATE agent_runs SET status='FAILED',error_code='BRAIN_UNAVAILABLE',error_message=$2,finished_at=now() WHERE id=$1 AND status IN('QUEUED','RUNNING')",
      [runId, (e as Error).message.slice(0, 500)],
    );
    return null;
  }
}

/** Execuções no brain que não voltaram (brain caiu): marca como falha para a tela não esperar para sempre. */
export async function sweepStaleBrainRuns(tenantId: string) {
  if (!brainEnabled()) return;
  await query(
    "UPDATE agent_runs SET status='FAILED',error_code='BRAIN_TIMEOUT',error_message='O brain não respondeu a tempo. Repita a análise.',finished_at=now() WHERE tenant_id=$1 AND provider='brain' AND status='RUNNING' AND started_at<now()-interval '5 minutes'",
    [tenantId],
  );
}

export const brainTeamMessage = (conversationId: string, text: string, who: string) =>
  brainQuiet('registrar_mensagem_equipe', {
    referencia_externa: brainRef(conversationId),
    texto: text,
    atendente: who,
  });
export const brainFamilyMessage = (conversationId: string, text: string, requestId: string) =>
  brainQuiet('enviar_mensagem', {
    referencia_externa: brainRef(conversationId),
    texto: text,
    id_requisicao: requestId,
    aguardar_resposta: false,
  });
export const brainTakeOver = (conversationId: string, who: string, queueCode?: string | null) =>
  brainQuiet('assumir_conversa', {
    referencia_externa: brainRef(conversationId),
    atendente: who,
    ...(queueCode ? { fila: queueCode } : {}),
  });
export const brainGiveBack = (conversationId: string) =>
  brainQuiet('devolver_para_ia', {
    referencia_externa: brainRef(conversationId),
    responder_agora: false,
  });
export const brainReset = (conversationId: string) =>
  brainQuiet('reiniciar_contexto', { referencia_externa: brainRef(conversationId) });
export const brainTransfer = (conversationId: string, queueCode: string, reason: string) =>
  brainQuiet('transferir_conversa', {
    referencia_externa: brainRef(conversationId),
    fila: queueCode,
    motivo: reason,
  });
export const brainClose = (conversationId: string, summary?: string) =>
  brainQuiet('encerrar_conversa', {
    referencia_externa: brainRef(conversationId),
    ...(summary ? { resumo: summary } : {}),
  });
