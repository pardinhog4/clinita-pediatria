import { unitTimezone } from './clinic-rules';
import { formatDateTime } from '@/lib/timezone';
import { z } from 'zod';
import { query, transaction } from '@/lib/db';
import { ApiError } from '@/lib/errors';
import { permit, assertUnit, type Context } from '@/lib/security';
import { audit, scopeRow, managers, financeRoles, auditRoles, receptionRoles } from './repository';
import { update } from './service';
import { buildPlan, persistPlan } from './referrals';
import { specialtyCode } from '@/lib/schemas';
import { assertSpecialties } from './specialties';
// Ciclo de vida dos registros operacionais: restaurar versões e arquivar agentes/modelos, cancelar lançamento,
// cancelar ausência com reversão, editar lista de espera, cancelar lote TISS, estornar ajuste de repasse
// e encaminhamentos manuais. Tudo com motivo e auditoria.
const reason = z.string().trim().min(5, 'Explique o motivo em poucas palavras.').max(1000);
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

// Agentes e modelos clínicos: restaurar uma versão antiga vira uma versão nova (o histórico não é reescrito).
const restorable: Record<'agents' | 'models', string[]> = {
  agents: [
    'name',
    'specialty',
    'instructions',
    'knowledge',
    'enabled',
    'confidence_threshold',
    'use_scenarios',
  ],
  models: ['name', 'specialty', 'questions'],
};
export async function restoreVersion(ctx: Context, input: unknown) {
  permit(ctx, managers);
  const d = z
    .object({
      resource: z.enum(['agents', 'models']),
      id: z.uuid(),
      version: z.number().int().positive(),
    })
    .strict()
    .parse(input);
  const [v] = await query(
    'SELECT snapshot FROM record_versions WHERE tenant_id=$1 AND entity_type=$2 AND entity_id=$3 AND version=$4',
    [ctx.tenantId, d.resource, d.id, d.version],
  );
  if (!v) throw new ApiError(404, 'Versão não encontrada.');
  const [cur] = await query(
    `SELECT version FROM ${d.resource === 'agents' ? 'agents' : 'assessment_models'} WHERE tenant_id=$1 AND id=$2`,
    [ctx.tenantId, d.id],
  );
  if (!cur) throw new ApiError(404, 'Registro não encontrado.');
  if (cur.version === d.version) throw new ApiError(422, 'Esta já é a versão atual.');
  const data = Object.fromEntries(
    restorable[d.resource]
      .filter((k) => v.snapshot[k] !== undefined)
      .map((k) => [k, v.snapshot[k]]),
  );
  return update(ctx, d.resource, d.id, {
    version: cur.version,
    data,
    reason: `Restaurada a versão ${d.version}`,
  });
}
export async function archiveRecord(ctx: Context, input: unknown) {
  permit(ctx, managers);
  const d = z
    .object({
      resource: z.enum(['agents', 'models']),
      id: z.uuid(),
      archived: z.boolean(),
      reason: reason.optional(),
    })
    .strict()
    .parse(input);
  if (d.archived && !d.reason) throw new ApiError(422, 'Explique o motivo do arquivamento.');
  const table = d.resource === 'agents' ? 'agents' : 'assessment_models';
  return transaction(async (c) => {
    const {
      rows: [row],
    } = await c.query(
      `UPDATE ${table} SET archived_at=CASE WHEN $3 THEN now() ELSE NULL END${d.resource === 'agents' ? ',enabled=CASE WHEN $3 THEN false ELSE enabled END' : ''} WHERE tenant_id=$1 AND id=$2 RETURNING *`,
      [ctx.tenantId, d.id, d.archived],
    );
    if (!row) throw new ApiError(404, 'Registro não encontrado.');
    await audit(
      c,
      ctx,
      `${d.resource}.${d.archived ? 'archived' : 'unarchived'}`,
      d.resource,
      d.id,
      null,
      { reason: d.reason },
    );
    return row;
  });
}

// Lançamento em aberto: cancelar com motivo (baixados seguem pelo estorno). Lançamentos de repasse saem pelo repasse.
async function payoutLinked(c: import('pg').PoolClient, ctx: Context, id: string) {
  return !!(
    await c.query(
      'SELECT 1 FROM payout_items WHERE tenant_id=$1 AND ledger_id=$2 UNION SELECT 1 FROM payout_adjustments WHERE tenant_id=$1 AND ledger_id=$2 LIMIT 1',
      [ctx.tenantId, id],
    )
  ).rowCount;
}
export async function assertLedgerEditable(c: import('pg').PoolClient, ctx: Context, row: any) {
  if (row.status !== 'OPEN')
    throw new ApiError(
      422,
      row.status === 'SETTLED'
        ? 'Lançamento baixado: use o estorno para corrigir.'
        : 'Lançamento cancelado não pode ser alterado.',
    );
  if (await payoutLinked(c, ctx, row.id))
    throw new ApiError(422, 'Este lançamento veio do repasse. Corrija pelo fluxo de repasse.');
}
export async function cancelLedger(ctx: Context, input: unknown) {
  permit(ctx, financeRoles);
  const d = z
    .object({ id: z.uuid(), version: z.number().int().positive(), reason })
    .strict()
    .parse(input);
  return transaction(async (c) => {
    const row = await scopeRow(c, ctx, 'ledger', d.id, true);
    if (row.version !== d.version)
      throw new ApiError(409, 'O lançamento mudou. Atualize antes de continuar.');
    await assertLedgerEditable(c, ctx, row);
    const {
      rows: [l],
    } = await c.query(
      "UPDATE ledger SET status='CANCELLED',cancelled_at=now(),cancelled_by=$3,cancel_reason=$4,version=version+1 WHERE tenant_id=$1 AND id=$2 RETURNING *",
      [ctx.tenantId, d.id, ctx.userId, d.reason],
    );
    await c.query(
      "INSERT INTO record_versions(tenant_id,entity_type,entity_id,version,snapshot,reason,created_by) VALUES($1,'ledger',$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING",
      [ctx.tenantId, d.id, l.version, JSON.stringify(l), 'Cancelado: ' + d.reason, ctx.userId],
    );
    await audit(c, ctx, 'ledger.cancelled', 'ledger', d.id, l.unit_id, {
      reason: d.reason,
      amount: l.amount,
    });
    return l;
  });
}

// Ausência cancelada: devolve à agenda as sessões que ela cancelou, se o horário continua livre e o crédito de reposição
// gerado por ela ainda não foi usado. O resto fica listado para a recepção resolver.
export async function cancelAbsence(ctx: Context, input: unknown) {
  permit(ctx, receptionRoles);
  const d = z.object({ id: z.uuid(), reason }).strict().parse(input);
  return transaction(async (c) => {
    const {
      rows: [ab],
    } = await c.query(
      'SELECT * FROM professional_absences WHERE tenant_id=$1 AND id=$2 FOR UPDATE',
      [ctx.tenantId, d.id],
    );
    if (!ab) throw new ApiError(404, 'Ausência não encontrada.');
    assertUnit(ctx, ab.unit_id);
    if (ab.status !== 'ACTIVE') throw new ApiError(409, 'Esta ausência já foi cancelada.');
    let restored = 0;
    const kept: { when: string; reason: string }[] = [];
    for (const id of ab.cancelled_appointment_ids as string[]) {
      const {
        rows: [a],
      } = await c.query('SELECT * FROM appointments WHERE tenant_id=$1 AND id=$2 FOR UPDATE', [
        ctx.tenantId,
        id,
      ]);
      if (!a) continue;
      const when = formatDateTime(a.starts_at, await unitTimezone(ctx.tenantId, a.unit_id, c));
      if (a.status !== 'CANCELLED' || a.absence_kind !== 'PROFESSIONAL') {
        kept.push({ when, reason: 'sessão já foi alterada' });
        continue;
      }
      if (new Date(a.starts_at) <= new Date()) {
        kept.push({ when, reason: 'horário já passou' });
        continue;
      }
      const {
        rows: [credit],
      } = await c.query(
        'SELECT id,status FROM session_credits WHERE tenant_id=$1 AND source_appointment_id=$2 FOR UPDATE',
        [ctx.tenantId, id],
      );
      if (credit && credit.status !== 'OPEN') {
        kept.push({ when, reason: 'crédito de reposição já usado' });
        continue;
      }
      const {
        rows: [busy],
      } = await c.query(
        "SELECT count(*)::int AS n FROM appointments WHERE tenant_id=$1 AND id<>$2 AND status NOT IN('CANCELLED','ABSENT') AND starts_at<$4 AND ends_at>$3 AND (patient_id=$5 OR professional_id=$6)",
        [ctx.tenantId, id, a.starts_at, a.ends_at, a.patient_id, a.professional_id],
      );
      if (busy.n) {
        kept.push({ when, reason: 'horário já ocupado por outra sessão' });
        continue;
      }
      if (credit)
        await c.query(
          "UPDATE session_credits SET status='CANCELLED' WHERE tenant_id=$1 AND id=$2",
          [ctx.tenantId, credit.id],
        );
      await c.query(
        "UPDATE appointments SET status='SCHEDULED',absence_kind=DEFAULT,reason=NULL,version=version+1 WHERE tenant_id=$1 AND id=$2",
        [ctx.tenantId, id],
      );
      restored++;
    }
    await c.query(
      "UPDATE professional_absences SET status='CANCELLED',cancelled_at=now(),cancelled_by=$3,cancel_reason=$4 WHERE tenant_id=$1 AND id=$2",
      [ctx.tenantId, d.id, ctx.userId, d.reason],
    );
    await audit(
      c,
      ctx,
      'professional.absence_cancelled',
      'professional_absences',
      d.id,
      ab.unit_id,
      { reason: d.reason, restored, kept },
    );
    return { restored, kept };
  });
}

// Lista de espera: editar preferências enquanto o pedido está aberto.
export async function updateWaitlist(ctx: Context, input: unknown) {
  permit(ctx, receptionRoles);
  const d = z
    .object({
      id: z.uuid(),
      specialty: specialtyCode,
      preferred_days: z.array(z.number().int().min(1).max(6)).max(6),
      preferred_period: z.enum(['ANY', 'MORNING', 'AFTERNOON']),
      priority: z.enum(['NORMAL', 'HIGH']),
      notes: z.string().trim().max(1000).default(''),
    })
    .strict()
    .parse(input);
  await assertSpecialties(ctx.tenantId, [d.specialty]);
  return transaction(async (c) => {
    const {
      rows: [w],
    } = await c.query('SELECT * FROM waitlist WHERE tenant_id=$1 AND id=$2 FOR UPDATE', [
      ctx.tenantId,
      d.id,
    ]);
    if (!w) throw new ApiError(404, 'Pedido não encontrado.');
    assertUnit(ctx, w.unit_id);
    if (!['WAITING', 'OFFERED'].includes(w.status))
      throw new ApiError(422, 'Só pedidos em aberto podem ser editados.');
    const {
      rows: [row],
    } = await c.query(
      'UPDATE waitlist SET specialty=$3,preferred_days=$4,preferred_period=$5,priority=$6,notes=$7 WHERE tenant_id=$1 AND id=$2 RETURNING *',
      [ctx.tenantId, d.id, d.specialty, d.preferred_days, d.preferred_period, d.priority, d.notes],
    );
    await audit(c, ctx, 'waitlist.updated', 'waitlist', d.id, w.unit_id, {
      before: {
        specialty: w.specialty,
        days: w.preferred_days,
        period: w.preferred_period,
        priority: w.priority,
      },
      after: {
        specialty: d.specialty,
        days: d.preferred_days,
        period: d.preferred_period,
        priority: d.priority,
      },
    });
    return row;
  });
}

// Lote TISS ainda não enviado: cancelar inteiro ou tirar um atendimento. Os atendimentos voltam para "prontos para faturar".
export async function cancelBatch(ctx: Context, input: unknown) {
  permit(ctx, auditRoles);
  const d = z.object({ id: z.uuid(), reason }).strict().parse(input);
  return transaction(async (c) => {
    const {
      rows: [b],
    } = await c.query('SELECT * FROM billing_batches WHERE tenant_id=$1 AND id=$2 FOR UPDATE', [
      ctx.tenantId,
      d.id,
    ]);
    if (!b) throw new ApiError(404, 'Lote não encontrado.');
    assertUnit(ctx, b.unit_id);
    if (b.status !== 'PREPARED')
      throw new ApiError(422, 'Só lotes ainda não enviados podem ser cancelados.');
    const { rowCount } = await c.query(
      'DELETE FROM billing_items WHERE tenant_id=$1 AND batch_id=$2',
      [ctx.tenantId, d.id],
    );
    await c.query(
      "UPDATE billing_batches SET status='CANCELLED',cancelled_at=now(),cancelled_by=$3,cancel_reason=$4 WHERE tenant_id=$1 AND id=$2",
      [ctx.tenantId, d.id, ctx.userId, d.reason],
    );
    await audit(c, ctx, 'billing.batch_cancelled', 'billing_batches', d.id, b.unit_id, {
      reason: d.reason,
      number: b.number,
      items: rowCount,
      amount: b.amount,
    });
    return { cancelled: true, released: rowCount };
  });
}
export async function removeBatchItem(ctx: Context, input: unknown) {
  permit(ctx, auditRoles);
  const d = z
    .object({ batch_id: z.uuid(), appointment_id: z.uuid(), reason })
    .strict()
    .parse(input);
  return transaction(async (c) => {
    const {
      rows: [b],
    } = await c.query('SELECT * FROM billing_batches WHERE tenant_id=$1 AND id=$2 FOR UPDATE', [
      ctx.tenantId,
      d.batch_id,
    ]);
    if (!b) throw new ApiError(404, 'Lote não encontrado.');
    assertUnit(ctx, b.unit_id);
    if (b.status !== 'PREPARED')
      throw new ApiError(422, 'Só lotes ainda não enviados podem ser alterados.');
    const {
      rows: [item],
    } = await c.query(
      'DELETE FROM billing_items WHERE tenant_id=$1 AND batch_id=$2 AND appointment_id=$3 RETURNING amount',
      [ctx.tenantId, d.batch_id, d.appointment_id],
    );
    if (!item) throw new ApiError(404, 'Atendimento não está neste lote.');
    const {
      rows: [left],
    } = await c.query(
      'SELECT count(*)::int AS n,coalesce(sum(amount),0) AS total FROM billing_items WHERE tenant_id=$1 AND batch_id=$2',
      [ctx.tenantId, d.batch_id],
    );
    if (left.n)
      await c.query('UPDATE billing_batches SET amount=$3 WHERE tenant_id=$1 AND id=$2', [
        ctx.tenantId,
        d.batch_id,
        left.total,
      ]);
    else
      await c.query(
        "UPDATE billing_batches SET status='CANCELLED',cancelled_at=now(),cancelled_by=$3,cancel_reason=$4 WHERE tenant_id=$1 AND id=$2",
        [ctx.tenantId, d.batch_id, ctx.userId, 'Último atendimento retirado: ' + d.reason],
      );
    await audit(c, ctx, 'billing.item_removed', 'billing_batches', d.batch_id, b.unit_id, {
      appointmentId: d.appointment_id,
      amount: item.amount,
      reason: d.reason,
      batchCancelled: !left.n,
    });
    return { remaining: left.n, amount: Number(left.total) };
  });
}

// Ajuste de repasse: estorno é um lançamento oposto ligado ao original, enquanto o ajuste não entrou em conta a pagar
// e o espelho do profissional não foi aprovado.
export async function reverseAdjustment(ctx: Context, input: unknown) {
  permit(ctx, financeRoles);
  const d = z.object({ id: z.uuid(), reason }).strict().parse(input);
  return transaction(async (c) => {
    const {
      rows: [a],
    } = await c.query('SELECT * FROM payout_adjustments WHERE tenant_id=$1 AND id=$2 FOR UPDATE', [
      ctx.tenantId,
      d.id,
    ]);
    if (!a) throw new ApiError(404, 'Ajuste não encontrado.');
    assertUnit(ctx, a.unit_id);
    if (a.reverses_id) throw new ApiError(422, 'Este lançamento já é um estorno.');
    if (
      (
        await c.query('SELECT 1 FROM payout_adjustments WHERE tenant_id=$1 AND reverses_id=$2', [
          ctx.tenantId,
          d.id,
        ])
      ).rowCount
    )
      throw new ApiError(409, 'Este ajuste já foi estornado.');
    if (a.ledger_id)
      throw new ApiError(422, 'O ajuste já entrou em uma conta a pagar. Corrija pelo financeiro.');
    if (
      (
        await c.query(
          "SELECT 1 FROM payout_reviews WHERE tenant_id=$1 AND unit_id=$2 AND professional_id=$3 AND status='APPROVED'",
          [ctx.tenantId, a.unit_id, a.professional_id],
        )
      ).rowCount
    )
      throw new ApiError(409, 'Espelho aprovado não recebe estornos.');
    const {
      rows: [r],
    } = await c.query(
      'INSERT INTO payout_adjustments(tenant_id,unit_id,professional_id,amount,reason,created_by,period_from,period_to,reverses_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *',
      [
        ctx.tenantId,
        a.unit_id,
        a.professional_id,
        -Number(a.amount),
        'Estorno: ' + d.reason,
        ctx.userId,
        a.period_from,
        a.period_to,
        a.id,
      ],
    );
    await audit(
      c,
      ctx,
      'payout.adjustment_reversed',
      'professionals',
      a.professional_id,
      a.unit_id,
      { adjustmentId: a.id, amount: a.amount, reason: d.reason },
    );
    return r;
  });
}

// Encaminhamento manual (laudo trazido em papel, pedido por telefone): mesma classificação da IA, sem passar pela IA.
const manualItem = z
  .object({
    servico: z.string().trim().min(3).max(400),
    specialty: specialtyCode.nullable(),
    competencies: z.array(z.string().trim().min(1).max(200)).max(12).default([]),
    carga: z.string().trim().max(200).default(''),
    weekly_hours: z.number().min(0).max(80).nullable().default(null),
    modality: z.enum(['CLINIC', 'HOME', 'ONLINE']).nullable().default(null),
  })
  .strict();
export async function createManualReferral(ctx: Context, input: unknown) {
  permit(ctx, receptionRoles);
  const d = z
    .object({
      patient_id: z.uuid(),
      notes: z.string().trim().max(1000).default(''),
      items: z.array(manualItem).min(1).max(20),
    })
    .strict()
    .parse(input);
  const p = await transaction((c) => scopeRow(c, ctx, 'patients', d.patient_id));
  if (p.active === false)
    throw new ApiError(422, 'Paciente com alta. Reative o cadastro antes de encaminhar.');
  const age = (Date.now() - new Date(p.birth_date).getTime()) / (365.25 * 86400000);
  const scope = {
    tenantId: ctx.tenantId,
    unitId: p.unit_id,
    patientId: p.id,
    includeClinical: false,
    requestedBy: ctx.userId,
    knownProfessionalIds: new Set<string>(),
  };
  const plan = await buildPlan(scope, {
    patient_first_name: p.name.split(' ')[0],
    age_years: Math.round(age * 10) / 10,
    notes: d.notes,
    items: d.items,
  });
  return transaction(async (c) => {
    // Cada encaminhamento manual fica numa conversa local do paciente, para poder propor horários pelo fluxo de sempre.
    const {
      rows: [conv],
    } = await c.query(
      "INSERT INTO conversations(tenant_id,unit_id,patient_id,guardian,channel,status,summary) VALUES($1,$2,$3,$4,'LOCAL','WAITING','Encaminhamento manual registrado pela equipe.') RETURNING *",
      [ctx.tenantId, p.unit_id, p.id, p.guardian],
    );
    const planId = await persistPlan(
      c,
      {
        tenant_id: ctx.tenantId,
        unit_id: p.unit_id,
        conversation_id: conv.id,
        id: null as unknown as string,
        requested_by: ctx.userId,
      },
      conv,
      plan,
    );
    await audit(c, ctx, 'referral.manual_created', 'referral_plans', planId, p.unit_id, {
      items: plan.items.length,
      patientId: p.id,
    });
    return {
      plan_id: planId,
      items: plan.items.map((i) => ({
        service_text: i.service_text,
        match_status: i.match_status,
        professional_name: i.professional_name,
      })),
    };
  });
}
export async function editReferralItem(ctx: Context, input: unknown) {
  permit(ctx, receptionRoles);
  const d = z
    .object({
      id: z.uuid(),
      version: z.number().int().positive(),
      service_text: z.string().trim().min(3).max(400),
      load_text: z.string().trim().max(200),
      weekly_hours: z.number().min(0).max(80).nullable(),
      modality: z.enum(['CLINIC', 'HOME', 'ONLINE']).nullable(),
    })
    .strict()
    .parse(input);
  return transaction(async (c) => {
    const {
      rows: [i],
    } = await c.query('SELECT * FROM referral_items WHERE tenant_id=$1 AND id=$2 FOR UPDATE', [
      ctx.tenantId,
      d.id,
    ]);
    if (!i) throw new ApiError(404, 'Encaminhamento não encontrado.');
    assertUnit(ctx, i.unit_id);
    if (i.version !== d.version)
      throw new ApiError(409, 'Este encaminhamento mudou. Atualize a lista.');
    if (!(i.state === 'PENDING' || (i.state === 'ACCEPTED' && !i.proposal_id)))
      throw new ApiError(422, 'Só itens ainda sem horários propostos podem ser editados.');
    const changed = Object.entries({
      service_text: d.service_text,
      load_text: d.load_text,
      weekly_hours: d.weekly_hours,
      modality: d.modality,
    })
      .filter(([k, v]) => String(i[k] ?? '') !== String(v ?? ''))
      .map(([k]) => k);
    const {
      rows: [row],
    } = await c.query(
      'UPDATE referral_items SET service_text=$3,load_text=$4,weekly_hours=$5,modality=$6,version=version+1,updated_at=now(),history=history||$7::jsonb WHERE tenant_id=$1 AND id=$2 RETURNING id,version',
      [
        ctx.tenantId,
        d.id,
        d.service_text,
        d.load_text,
        d.weekly_hours,
        d.modality,
        JSON.stringify([
          {
            at: new Date().toISOString(),
            action: 'EDITED',
            by: ctx.name,
            note: 'Alterado: ' + changed.join(', '),
          },
        ]),
      ],
    );
    await audit(c, ctx, 'referral.item_edited', 'referral_items', d.id, i.unit_id, { changed });
    return row;
  });
}
export const actions: Record<string, (ctx: Context, input: unknown) => Promise<unknown>> = {
  'restore-version': restoreVersion,
  archive: archiveRecord,
  'ledger-cancel': cancelLedger,
  'absence-cancel': cancelAbsence,
  'waitlist-update': updateWaitlist,
  'batch-cancel': cancelBatch,
  'batch-remove-item': removeBatchItem,
  'adjustment-reverse': reverseAdjustment,
  'referral-create': createManualReferral,
  'referral-item-edit': editReferralItem,
};
