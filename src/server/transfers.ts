import { z } from 'zod';
import { transaction } from '@/lib/db';
import { ApiError } from '@/lib/errors';
import { permit, type Context } from '@/lib/security';
import { audit, scopeRow, version, receptionRoles, clinicalAccess } from './repository';
export async function transferConversation(ctx: Context, id: string, input: unknown) {
  permit(ctx, receptionRoles);
  const d = z
    .object({
      version: z.number().int().positive(),
      queue_id: z.uuid(),
      assigned_user_id: z.union([z.uuid(), z.literal('')]).default(''),
      priority: z.enum(['NORMAL', 'HIGH']),
      status: z.enum(['HUMAN', 'REVIEW', 'DONE']),
      reason: z.string().trim().min(10).max(1000),
    })
    .strict()
    .parse(input);
  return transaction(async (c) => {
    const conv = await scopeRow(c, ctx, 'conversations', id, true);
    version(conv, d.version);
    if (conv.include_clinical_context && conv.patient_id)
      await clinicalAccess(ctx, conv.patient_id);
    const {
      rows: [queue],
    } = await c.query(
      'SELECT name FROM service_queues WHERE tenant_id=$1 AND unit_id=$2 AND id=$3 AND active=true',
      [ctx.tenantId, conv.unit_id, d.queue_id],
    );
    if (!queue) throw new ApiError(422, 'Selecione uma fila válida desta unidade.');
    let userName = '';
    if (d.assigned_user_id) {
      const {
        rows: [user],
      } = await c.query(
        'SELECT u.name FROM users u JOIN memberships m ON m.user_id=u.id WHERE u.id=$1 AND m.tenant_id=$2 AND $3::uuid=ANY(m.unit_ids) AND m.active=true',
        [d.assigned_user_id, ctx.tenantId, conv.unit_id],
      );
      if (!user) throw new ApiError(422, 'Responsável não pertence à equipe desta unidade.');
      userName = user.name;
    }
    const assigned = queue.name + (userName ? ' · ' + userName : '');
    const {
      rows: [row],
    } = await c.query(
      "UPDATE conversations SET assigned_to=$3,queue_id=$4,assigned_user_id=$5,priority=$6,status=$7,stage=CASE WHEN $7='DONE' THEN 'COMPLETED' ELSE 'HUMAN' END,ai_mode='HUMAN',automation_epoch=automation_epoch+1,version=version+1 WHERE tenant_id=$1 AND id=$2 RETURNING *",
      [ctx.tenantId, id, assigned, d.queue_id, d.assigned_user_id || null, d.priority, d.status],
    );
    await c.query(
      "UPDATE agent_runs SET status='CANCELLED',finished_at=now(),error_message='Atendimento transferido para a equipe.' WHERE tenant_id=$1 AND conversation_id=$2 AND status IN('QUEUED','RUNNING')",
      [ctx.tenantId, id],
    );
    await c.query(
      "INSERT INTO messages(tenant_id,conversation_id,direction,content,created_by) VALUES($1,$2,'SYSTEM',$3,$4)",
      [ctx.tenantId, id, `Transferência para ${assigned}: ${d.reason}`, ctx.userId],
    );
    await audit(c, ctx, 'conversation.transferred', 'conversations', id, conv.unit_id, {
      queueId: d.queue_id,
      assignedUserId: d.assigned_user_id || null,
    });
    return row;
  });
}
