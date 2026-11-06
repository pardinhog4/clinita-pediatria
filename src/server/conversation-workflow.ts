import { z } from 'zod';
import { query, transaction } from '@/lib/db';
import { ApiError } from '@/lib/errors';
import { assertUnit, permit, type Context } from '@/lib/security';
import {
  scopeRow,
  audit,
  clinicalAccess,
  receptionRoles,
  clinicRoles,
  version,
} from './repository';
import { createAppointmentsWithClient } from './service';
import { appointmentSchema } from '@/lib/schemas';
import { onProposalDecided, addPlanSpecialties } from './referral-scheduling';
import { brainClose, brainTakeOver } from './brain/bridge';
export async function teamQueue(ctx: Context, unit: string) {
  permit(ctx, receptionRoles);
  assertUnit(ctx, unit);
  const data = await query(
    `SELECT c.id,c.version,c.guardian,c.patient_id,c.channel,c.status,c.priority,c.summary,c.sandbox,c.ai_mode,c.queue_id,c.assigned_user_id,c.created_at,q.name AS queue_name,u.name AS assigned_user_name,(SELECT max(created_at) FROM messages WHERE tenant_id=c.tenant_id AND conversation_id=c.id) AS last_message_at FROM conversations c LEFT JOIN service_queues q ON q.id=c.queue_id AND q.tenant_id=c.tenant_id LEFT JOIN users u ON u.id=c.assigned_user_id WHERE c.tenant_id=$1 AND c.unit_id=$2 AND c.deleted_at IS NULL AND c.status<>'DONE' AND (c.queue_id IS NOT NULL OR c.status IN('HUMAN','REVIEW')) AND (c.include_clinical_context=false OR $3::boolean) ORDER BY CASE WHEN c.priority='HIGH' THEN 0 ELSE 1 END,c.created_at`,
    [ctx.tenantId, unit, clinicRoles.includes(ctx.role)],
  );
  return { data };
}
export async function proposals(ctx: Context, unit: string) {
  permit(ctx, receptionRoles);
  assertUnit(ctx, unit);
  return {
    data: await query(
      `SELECT pr.*,c.guardian,c.sandbox,p.name AS patient_name FROM conversation_proposals pr JOIN conversations c ON c.id=pr.conversation_id AND c.tenant_id=pr.tenant_id LEFT JOIN patients p ON p.id=pr.patient_id AND p.tenant_id=pr.tenant_id WHERE pr.tenant_id=$1 AND pr.unit_id=$2 AND c.deleted_at IS NULL AND (c.include_clinical_context=false OR $3::boolean) ORDER BY pr.created_at DESC LIMIT 200`,
      [ctx.tenantId, unit, clinicRoles.includes(ctx.role)],
    ),
  };
}
export async function createProposal(ctx: Context, unit: string, input: unknown) {
  permit(ctx, receptionRoles);
  const d = z
    .object({
      conversation_id: z.uuid(),
      request_id: z.uuid(),
      patient_id: z.uuid().optional(),
      appointments: z
        .array(
          z
            .object({
              professional_id: z.uuid(),
              starts_at: z.iso.datetime({ offset: true }),
              duration: z.coerce.number().int().min(15).max(180),
            })
            .strict(),
        )
        .min(1)
        .max(30),
    })
    .strict()
    .parse(input);
  return transaction(async (c) => {
    const conv = await scopeRow(c, ctx, 'conversations', d.conversation_id, true);
    if (conv.unit_id !== unit || conv.deleted_at || conv.status === 'DONE')
      throw new ApiError(422, 'Conversa indisponível.');
    if (conv.include_clinical_context && conv.patient_id)
      await clinicalAccess(ctx, conv.patient_id);
    if (d.patient_id) {
      const p = await scopeRow(c, ctx, 'patients', d.patient_id);
      if (p.unit_id !== unit || (conv.patient_id && conv.patient_id !== p.id))
        throw new ApiError(422, 'Paciente incompatível com a conversa.');
    }
    for (const a of d.appointments) {
      const p = await scopeRow(c, ctx, 'professionals', a.professional_id);
      if (p.unit_id !== unit || !p.active || new Date(a.starts_at) <= new Date())
        throw new ApiError(422, 'Profissional ou horário indisponível.');
    }
    const {
      rows: [existing],
    } = await c.query(
      'SELECT * FROM conversation_proposals WHERE tenant_id=$1 AND conversation_id=$2 AND request_id=$3',
      [ctx.tenantId, conv.id, d.request_id],
    );
    if (existing) return existing;
    const {
      rows: [proposal],
    } = await c.query(
      'INSERT INTO conversation_proposals(tenant_id,unit_id,conversation_id,patient_id,appointments,request_id,created_by) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *',
      [
        ctx.tenantId,
        unit,
        conv.id,
        d.patient_id || conv.patient_id || null,
        JSON.stringify(d.appointments),
        d.request_id,
        ctx.userId,
      ],
    );
    await c.query(
      "UPDATE conversations SET stage='PROPOSAL',version=version+1 WHERE tenant_id=$1 AND id=$2",
      [ctx.tenantId, conv.id],
    );
    await audit(
      c,
      ctx,
      'conversation.proposal_prepared',
      'conversation_proposals',
      proposal.id,
      unit,
      { count: d.appointments.length, reserved: false },
    );
    return proposal;
  });
}
export async function decideProposal(ctx: Context, unit: string, input: unknown) {
  permit(ctx, receptionRoles);
  const d = z
    .object({
      proposal_id: z.uuid(),
      action: z.enum(['ACCEPT', 'APPROVE', 'REJECT']),
      patient_id: z.uuid().optional(),
      identity_confirmed: z.boolean().default(false),
      reason: z.string().min(10).max(3000),
    })
    .strict()
    .parse(input);
  return transaction(async (c) => {
    const {
      rows: [p],
    } = await c.query(
      'SELECT * FROM conversation_proposals WHERE tenant_id=$1 AND unit_id=$2 AND id=$3 FOR UPDATE',
      [ctx.tenantId, unit, d.proposal_id],
    );
    if (!p) throw new ApiError(404, 'Proposta não encontrada.');
    const conv = await scopeRow(c, ctx, 'conversations', p.conversation_id, true);
    if (conv.deleted_at) throw new ApiError(404, 'Conversa indisponível.');
    if (conv.include_clinical_context && conv.patient_id)
      await clinicalAccess(ctx, conv.patient_id);
    if (['APPROVED', 'REJECTED'].includes(p.status))
      throw new ApiError(409, 'Proposta já decidida.');
    let status = 'REJECTED',
      count = 0;
    if (d.action === 'ACCEPT') {
      if (p.status !== 'DRAFT') throw new ApiError(409, 'Aceite já registrado.');
      status = 'ACCEPTED';
    }
    if (d.action === 'APPROVE') {
      if (p.status !== 'ACCEPTED')
        throw new ApiError(422, 'Registre o aceite da família antes da aprovação.');
      const patientId = d.patient_id || p.patient_id;
      if (!patientId || !d.identity_confirmed)
        throw new ApiError(422, 'Identifique o paciente e confirme a conferência do vínculo.');
      const patient = await scopeRow(c, ctx, 'patients', patientId, true);
      if (patient.unit_id !== unit || (conv.patient_id && conv.patient_id !== patient.id))
        throw new ApiError(422, 'Paciente de outra unidade ou conversa.');
      await addPlanSpecialties(c, ctx, p, patient.id);
      for (const a of p.appointments) {
        const rows = await createAppointmentsWithClient(
          c,
          ctx,
          appointmentSchema.parse({
            unit_id: unit,
            patient_id: patient.id,
            professional_id: a.professional_id,
            starts_at: a.starts_at,
            duration: a.duration,
            location: a.location || 'CLINIC',
            occurrences: a.occurrences || 1,
            conversation_id: conv.id,
          }),
        );
        count += rows.length;
      }
      await c.query('UPDATE conversations SET patient_id=$3 WHERE tenant_id=$1 AND id=$2', [
        ctx.tenantId,
        conv.id,
        patient.id,
      ]);
      await c.query(
        'UPDATE conversation_proposals SET patient_id=$3 WHERE tenant_id=$1 AND id=$2',
        [ctx.tenantId, p.id, patient.id],
      );
      status = 'APPROVED';
    }
    await c.query(
      "UPDATE conversations SET ai_mode='HUMAN',status='HUMAN',automation_epoch=automation_epoch+1 WHERE tenant_id=$1 AND id=$2",
      [ctx.tenantId, conv.id],
    );
    await c.query(
      "UPDATE agent_runs SET status='CANCELLED',finished_at=now(),error_message='Proposta decidida pela equipe.' WHERE tenant_id=$1 AND conversation_id=$2 AND status IN('QUEUED','RUNNING')",
      [ctx.tenantId, conv.id],
    );
    await c.query(
      'UPDATE conversation_proposals SET status=$3,reason=$4,decided_by=$5,decided_at=now() WHERE tenant_id=$1 AND id=$2',
      [ctx.tenantId, p.id, status, d.reason, ctx.userId],
    );
    await onProposalDecided(
      c,
      ctx,
      p,
      status,
      status === 'APPROVED' ? d.patient_id || p.patient_id : null,
    );
    await c.query(
      'UPDATE conversations SET stage=$3,version=version+1 WHERE tenant_id=$1 AND id=$2',
      [
        ctx.tenantId,
        conv.id,
        status === 'ACCEPTED' ? 'ACCEPTED' : status === 'APPROVED' ? 'HUMAN' : 'CLARIFYING',
      ],
    );
    await c.query(
      "INSERT INTO messages(tenant_id,conversation_id,direction,content,created_by) VALUES($1,$2,'SYSTEM',$3,$4)",
      [
        ctx.tenantId,
        conv.id,
        status === 'APPROVED'
          ? `${count} sessão(ões) reservada(s) após aceite da família e aprovação da equipe.`
          : status === 'ACCEPTED'
            ? 'Aceite da família registrado para a proposta.'
            : 'Proposta recusada: ' + d.reason,
        ctx.userId,
      ],
    );
    await audit(
      c,
      ctx,
      'conversation.proposal_' + status.toLowerCase(),
      'conversation_proposals',
      p.id,
      unit,
      { count, reason: d.reason },
    );
    return { status, count };
  });
}
export async function conversationControl(ctx: Context, unit: string, input: unknown) {
  const r = await conversationControlTx(ctx, unit, input);
  if (r.action === 'CLOSE') await brainClose(r.id, 'Encerrado pela equipe.');
  else await brainTakeOver(r.id, ctx.name);
  return r.result;
}
async function conversationControlTx(ctx: Context, unit: string, input: unknown) {
  permit(ctx, receptionRoles);
  const d = z
    .object({
      conversation_id: z.uuid(),
      version: z.number().int(),
      action: z.enum(['TAKEOVER', 'CLOSE', 'REOPEN']),
    })
    .strict()
    .parse(input);
  return transaction(async (c) => {
    const conv = await scopeRow(c, ctx, 'conversations', d.conversation_id, true);
    version(conv, d.version);
    if (conv.unit_id !== unit || conv.deleted_at) throw new ApiError(404, 'Conversa indisponível.');
    if (conv.include_clinical_context && conv.patient_id)
      await clinicalAccess(ctx, conv.patient_id);
    const status = d.action === 'CLOSE' ? 'DONE' : 'HUMAN';
    await c.query(
      "UPDATE conversations SET status=$3,stage=$4,ai_mode='HUMAN',automation_epoch=automation_epoch+1,version=version+1,assigned_user_id=CASE WHEN $5 THEN $6 ELSE assigned_user_id END WHERE tenant_id=$1 AND id=$2",
      [
        ctx.tenantId,
        conv.id,
        status,
        d.action === 'CLOSE' ? 'COMPLETED' : 'HUMAN',
        d.action === 'TAKEOVER',
        ctx.userId,
      ],
    );
    await c.query(
      "UPDATE agent_runs SET status='CANCELLED',finished_at=now(),error_message='Conversa assumida ou encerrada pela equipe.' WHERE tenant_id=$1 AND conversation_id=$2 AND status IN('QUEUED','RUNNING')",
      [ctx.tenantId, conv.id],
    );
    await c.query(
      "INSERT INTO messages(tenant_id,conversation_id,direction,content,created_by) VALUES($1,$2,'SYSTEM',$3,$4)",
      [
        ctx.tenantId,
        conv.id,
        d.action === 'CLOSE'
          ? 'Atendimento encerrado pela equipe.'
          : d.action === 'REOPEN'
            ? 'Atendimento reaberto pela equipe.'
            : 'Atendimento assumido pela equipe.',
        ctx.userId,
      ],
    );
    await audit(c, ctx, 'conversation.' + d.action.toLowerCase(), 'conversations', conv.id, unit);
    return { id: conv.id as string, action: d.action, result: { ok: true } };
  });
}
