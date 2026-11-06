import { tenantRules, unitTimezone } from './clinic-rules';
import { formatDateTime } from '@/lib/timezone';
import { deliverSoon, mailMode, queueEmail } from './mail';
import { createHash } from 'node:crypto';
import { renderTemplate, settingsValue } from './message-templates';
import { z } from 'zod';
import type { PoolClient } from 'pg';
import { query, transaction } from '@/lib/db';
import { ApiError } from '@/lib/errors';
import { assertUnit, permit, type Context } from '@/lib/security';
import { financeRoles, scopeRow, audit } from './repository';
const eligible =
  "a.audit_status='APPROVED' AND a.evolution IS NOT NULL AND a.arrived_at IS NOT NULL AND a.financial_hold=false";
export type PayoutPeriod = { from?: string | null; to?: string | null };
function period(input: PayoutPeriod = {}) {
  if (!input.from && !input.to) return { from: null, to: null };
  const d = z.object({ from: z.iso.date(), to: z.iso.date() }).parse(input);
  if (d.to < d.from) throw new ApiError(422, 'Período de repasse inválido.');
  return d;
}
export async function payoutRows(
  ctx: Context,
  unit: string,
  c?: PoolClient,
  range: PayoutPeriod = {},
) {
  permit(ctx, [...financeRoles, 'CLINICIAN']);
  assertUnit(ctx, unit);
  const dates = period(range);
  const sql = `SELECT p.id,p.name,p.specialty,p.hourly_rate,p.metadata,coalesce(adj.total,0)::float AS adjustment_amount,coalesce(adj.items,'[]'::jsonb) AS adjustments,coalesce(t.sessions,0)::int AS sessions,coalesce(t.sessions_60,0)::int AS sessions_60,coalesce(t.sessions_30,0)::int AS sessions_30,coalesce(t.retained_sessions,0)::int AS retained_sessions,coalesce(t.amount,0)::float AS amount,coalesce(t.retained_amount,0)::float AS retained_amount,coalesce(t.snapshot,'[]'::jsonb) AS eligible_snapshot,r.snapshot AS reviewed_snapshot,r.status AS saved_review_status
 FROM professionals p LEFT JOIN LATERAL(SELECT count(*) FILTER(WHERE ${eligible}) AS sessions,
 count(*) FILTER(WHERE ${eligible} AND extract(epoch FROM(a.ends_at-a.starts_at))=3600) AS sessions_60,
 count(*) FILTER(WHERE ${eligible} AND extract(epoch FROM(a.ends_at-a.starts_at))=$6::int*60) AS sessions_30,
 count(*) FILTER(WHERE NOT(${eligible})) AS retained_sessions,
 round(sum(CASE WHEN extract(epoch FROM(a.ends_at-a.starts_at))=$6::int*60 THEN coalesce(nullif((p.metadata->>'session_rate_30')::numeric,0),p.hourly_rate*$6::int/60) ELSE extract(epoch FROM(a.ends_at-a.starts_at))/3600*p.hourly_rate END) FILTER(WHERE ${eligible}),2) AS amount,
 round(sum(CASE WHEN extract(epoch FROM(a.ends_at-a.starts_at))=$6::int*60 THEN coalesce(nullif((p.metadata->>'session_rate_30')::numeric,0),p.hourly_rate*$6::int/60) ELSE extract(epoch FROM(a.ends_at-a.starts_at))/3600*p.hourly_rate END) FILTER(WHERE NOT(${eligible})),2) AS retained_amount,
 jsonb_agg(jsonb_build_array(a.id,a.starts_at,a.ends_at,p.hourly_rate,p.metadata->>'session_rate_30') ORDER BY a.id) FILTER(WHERE ${eligible}) AS snapshot
 FROM appointments a WHERE a.tenant_id=p.tenant_id AND a.unit_id=p.unit_id AND a.professional_id=p.id AND a.status='COMPLETED' AND ($3::date IS NULL OR (a.starts_at AT TIME ZONE unit_tz(a.tenant_id,a.unit_id))::date BETWEEN $3 AND $4) AND NOT EXISTS(SELECT 1 FROM payout_items pi WHERE pi.tenant_id=a.tenant_id AND pi.appointment_id=a.id))t ON true
 LEFT JOIN LATERAL(SELECT sum(ad.amount) AS total,jsonb_agg(jsonb_build_object('id',ad.id,'amount',ad.amount,'reason',ad.reason,'created_at',ad.created_at,'reverses_id',ad.reverses_id,'reversed',EXISTS(SELECT 1 FROM payout_adjustments rv WHERE rv.reverses_id=ad.id)) ORDER BY ad.created_at) AS items FROM payout_adjustments ad WHERE ad.tenant_id=p.tenant_id AND ad.unit_id=p.unit_id AND ad.professional_id=p.id AND ad.ledger_id IS NULL AND ($3::date IS NULL OR ad.period_from=$3 AND ad.period_to=$4))adj ON true
 LEFT JOIN payout_reviews r ON r.tenant_id=p.tenant_id AND r.unit_id=p.unit_id AND r.professional_id=p.id
 WHERE p.tenant_id=$1 AND p.unit_id=$2 AND p.contract='PJ' AND p.active=true AND ($5::text IS NULL OR p.metadata->>'user_id'=$5) ORDER BY p.name`;
  const args = [
    ctx.tenantId,
    unit,
    dates.from,
    dates.to,
    ctx.role === 'CLINICIAN' ? ctx.userId : null,
    (await tenantRules(ctx.tenantId, c)).half_session_minutes,
  ];
  const rows = c ? (await c.query(sql, args)).rows : await query(sql, args);
  return rows.map((r) => {
    const snapshot = createHash('sha256')
      .update(
        JSON.stringify({
          sessions: r.eligible_snapshot,
          adjustments: r.adjustments,
          period: dates,
        }),
      )
      .digest('hex');
    const review_status =
      r.sessions > 0 && Number(r.hourly_rate) > 0
        ? snapshot === r.reviewed_snapshot
          ? r.saved_review_status
          : 'INTERNAL'
        : 'EMPTY';
    const { eligible_snapshot, reviewed_snapshot, saved_review_status, ...rest } = r;
    return {
      ...rest,
      base_amount: r.amount,
      amount: Math.round((Number(r.amount) + Number(r.adjustment_amount)) * 100) / 100,
      snapshot,
      review_status,
      period_from: dates.from,
      period_to: dates.to,
    };
  });
}
export async function payouts(ctx: Context, unit: string, range: PayoutPeriod = {}) {
  const data = await payoutRows(ctx, unit, undefined, range);
  const sum = (key: string) =>
    Math.round(data.reduce((total, r) => total + Number(r[key]), 0) * 100) / 100;
  return {
    data,
    period: period(range),
    summary: {
      total_amount: sum('amount'),
      retained_amount: sum('retained_amount'),
      retained_sessions: sum('retained_sessions'),
      eligible_sessions: sum('sessions'),
      confirmed: data.filter((r) => r.review_status === 'CONFIRMED').length,
      approved: data.filter((r) => r.review_status === 'APPROVED').length,
      professionals: data.length,
    },
  };
}
export async function reviewPayout(ctx: Context, id: string, input: unknown) {
  permit(ctx, [...financeRoles, 'CLINICIAN']);
  const d = z
    .object({
      action: z.enum(['SEND', 'CONFIRM', 'CONTEST', 'APPROVE', 'ADJUST']),
      amount: z.number().min(-1000000).max(1000000).optional(),
      period_from: z.iso.date().optional(),
      period_to: z.iso.date().optional(),
      snapshot: z.string().regex(/^[a-f0-9]{64}$/),
      reason: z.string().trim().min(10).max(1000),
    })
    .strict()
    .parse(input);
  return transaction(async (c) => {
    const p = await scopeRow(c, ctx, 'professionals', z.uuid().parse(id), true);
    const row = (
      await payoutRows(ctx, p.unit_id, c, { from: d.period_from, to: d.period_to })
    ).find((r) => r.id === id);
    if (!row || !row.sessions || Number(row.hourly_rate) <= 0)
      throw new ApiError(422, 'Não há sessões elegíveis para conferência.');
    if (row.snapshot !== d.snapshot)
      throw new ApiError(409, 'As sessões ou valores mudaram. Atualize e confira novamente.');
    if (
      ctx.role === 'CLINICIAN' &&
      (!['CONFIRM', 'CONTEST'].includes(d.action) || p.metadata.user_id !== ctx.userId)
    )
      throw new ApiError(403, 'O profissional só confere ou contesta o próprio espelho.');
    if (d.action === 'APPROVE' && !p.metadata.pj_documents_confirmed)
      throw new ApiError(422, 'Documentos PJ pendentes: confira CNPJ e conta PJ antes de aprovar.');
    if (d.action === 'ADJUST') {
      if (!d.amount || Math.abs(d.amount * 100 - Math.round(d.amount * 100)) > 0.00001)
        throw new ApiError(422, 'Informe um ajuste não nulo com até duas casas decimais.');
      if (row.review_status === 'APPROVED')
        throw new ApiError(409, 'Espelho aprovado não recebe ajustes.');
      await c.query(
        'INSERT INTO payout_adjustments(tenant_id,unit_id,professional_id,amount,reason,created_by,period_from,period_to) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
        [
          ctx.tenantId,
          p.unit_id,
          id,
          d.amount,
          d.reason,
          ctx.userId,
          d.period_from || null,
          d.period_to || null,
        ],
      );
      await audit(c, ctx, 'payout.adjusted', 'professionals', id, p.unit_id, {
        amount: d.amount,
        reason: d.reason,
        periodFrom: d.period_from || null,
        periodTo: d.period_to || null,
      });
      return { status: 'INTERNAL' };
    }
    if (d.action === 'SEND') {
      if (row.review_status === 'APPROVED') throw new ApiError(409, 'Espelho já aprovado.');
      await c.query(
        "INSERT INTO payout_reviews(tenant_id,unit_id,professional_id,snapshot,status,sent_by,sent_at,reason) VALUES($1,$2,$3,$4,'SENT',$5,now(),$6) ON CONFLICT(tenant_id,unit_id,professional_id) DO UPDATE SET snapshot=EXCLUDED.snapshot,status='SENT',sent_by=EXCLUDED.sent_by,sent_at=now(),confirmed_by=NULL,confirmed_at=NULL,approved_by=NULL,approved_at=NULL,contest_reason=NULL,reason=EXCLUDED.reason",
        [ctx.tenantId, p.unit_id, id, d.snapshot, ctx.userId, d.reason],
      );
      await c.query(
        "INSERT INTO operation_requests(tenant_id,unit_id,professional_id,kind,message,created_by) VALUES($1,$2,$3,'PAYOUT',$4,$5)",
        [
          ctx.tenantId,
          p.unit_id,
          id,
          renderTemplate(await settingsValue(c, ctx.tenantId), 'payout_mirror', {
            profissional: p.name,
            sessoes: String(row.sessions),
            valor: 'R$ ' + Number(row.amount).toFixed(2).replace('.', ','),
          }),
          ctx.userId,
        ],
      );
    } else if (d.action === 'CONTEST') {
      if (!['SENT', 'CONFIRMED'].includes(row.review_status))
        throw new ApiError(409, 'O espelho deve estar disponível para conferência.');
      await c.query(
        "UPDATE payout_reviews SET status='CONTESTED',contest_reason=$4,reason=$4,approved_by=NULL,approved_at=NULL WHERE tenant_id=$1 AND unit_id=$2 AND professional_id=$3",
        [ctx.tenantId, p.unit_id, id, d.reason],
      );
    } else if (d.action === 'CONFIRM') {
      if (row.review_status !== 'SENT')
        throw new ApiError(409, 'Disponibilize o espelho para conferência antes de confirmar.');
      if (row.review_status === 'APPROVED') throw new ApiError(409, 'O espelho já está aprovado.');
      await c.query(
        "INSERT INTO payout_reviews(tenant_id,unit_id,professional_id,snapshot,status,confirmed_by,reason) VALUES($1,$2,$3,$4,'CONFIRMED',$5,$6) ON CONFLICT(tenant_id,unit_id,professional_id) DO UPDATE SET snapshot=EXCLUDED.snapshot,status='CONFIRMED',confirmed_by=EXCLUDED.confirmed_by,confirmed_at=now(),approved_by=NULL,approved_at=NULL,reason=EXCLUDED.reason",
        [ctx.tenantId, p.unit_id, id, d.snapshot, ctx.userId, d.reason],
      );
    } else {
      if (Number(row.amount) <= 0) throw new ApiError(422, 'O total do espelho deve ser positivo.');
      if (row.review_status !== 'CONFIRMED')
        throw new ApiError(409, 'Registre a conferência do profissional antes de aprovar.');
      await c.query(
        "UPDATE payout_reviews SET status='APPROVED',approved_by=$4,approved_at=now(),reason=$5 WHERE tenant_id=$1 AND unit_id=$2 AND professional_id=$3",
        [ctx.tenantId, p.unit_id, id, ctx.userId, d.reason],
      );
    }
    await audit(
      c,
      ctx,
      (
        {
          SEND: 'payout.prepared_for_confirmation',
          CONFIRM: 'payout.professional_confirmation',
          CONTEST: 'payout.contested',
          APPROVE: 'payout.approved',
        } as Record<string, string>
      )[d.action],
      'professionals',
      id,
      p.unit_id,
      { snapshot: d.snapshot, reason: d.reason, amount: row.amount, sessions: row.sessions },
    );
    return {
      status: (
        { SEND: 'SENT', CONFIRM: 'CONFIRMED', CONTEST: 'CONTESTED', APPROVE: 'APPROVED' } as Record<
          string,
          string
        >
      )[d.action],
    };
  });
}
export async function requireApprovedPayout(
  c: PoolClient,
  ctx: Context,
  id: string,
  unit: string,
  range: PayoutPeriod = {},
) {
  const row = (await payoutRows(ctx, unit, c, range)).find((r) => r.id === id);
  if (!row?.metadata.pj_documents_confirmed) throw new ApiError(422, 'Documentos PJ pendentes.');
  if (row?.review_status !== 'APPROVED')
    throw new ApiError(409, 'Confira e aprove o espelho atual antes de gerar a conta a pagar.');
  return row;
}
export async function payoutDetails(ctx: Context, id: string, range: PayoutPeriod = {}) {
  permit(ctx, [...financeRoles, 'CLINICIAN']);
  return transaction(async (c) => {
    const p = await scopeRow(c, ctx, 'professionals', z.uuid().parse(id));
    const current = (await payoutRows(ctx, p.unit_id, c, range)).find((r) => r.id === id);
    if (!current) throw new ApiError(404, 'Espelho não encontrado.');
    const dates = period(range);
    const half = (await tenantRules(ctx.tenantId, c)).half_session_minutes;
    const sessions = (
      await c.query(
        `SELECT a.id,a.starts_at,a.ends_at,a.status,a.audit_status,a.financial_hold,a.reason,p.name AS patient_name,round(CASE WHEN extract(epoch FROM(a.ends_at-a.starts_at))=$7::int*60 THEN $6::numeric ELSE extract(epoch FROM(a.ends_at-a.starts_at))/3600*$3::numeric END,2)::float AS amount FROM appointments a JOIN patients p ON p.id=a.patient_id AND p.tenant_id=a.tenant_id WHERE a.tenant_id=$1 AND a.professional_id=$2 AND a.status='COMPLETED' AND ($4::date IS NULL OR (a.starts_at AT TIME ZONE unit_tz(a.tenant_id,a.unit_id))::date BETWEEN $4 AND $5) AND NOT EXISTS(SELECT 1 FROM payout_items pi WHERE pi.tenant_id=a.tenant_id AND pi.appointment_id=a.id) ORDER BY a.starts_at`,
        [
          ctx.tenantId,
          id,
          p.hourly_rate,
          dates.from,
          dates.to,
          Number(p.metadata.session_rate_30) || (Number(p.hourly_rate) * half) / 60,
          half,
        ],
      )
    ).rows;
    const history = (
      await c.query(
        `SELECT f.id,f.description,f.amount::float,f.status,f.due_date,f.created_at,(SELECT pe.paid_date FROM payment_events pe WHERE pe.tenant_id=f.tenant_id AND pe.ledger_id=f.id AND pe.kind='SETTLEMENT' ORDER BY pe.created_at DESC LIMIT 1) AS paid_date FROM ledger f WHERE f.tenant_id=$1 AND f.unit_id=$2 AND EXISTS(SELECT 1 FROM payout_items pi JOIN appointments a ON a.id=pi.appointment_id AND a.tenant_id=pi.tenant_id WHERE pi.tenant_id=f.tenant_id AND pi.ledger_id=f.id AND a.professional_id=$3) ORDER BY f.created_at DESC`,
        [ctx.tenantId, p.unit_id, id],
      )
    ).rows;
    const review =
      (
        await c.query(
          'SELECT status,confirmed_at,approved_at,sent_at,contest_reason,reason FROM payout_reviews WHERE tenant_id=$1 AND unit_id=$2 AND professional_id=$3',
          [ctx.tenantId, p.unit_id, id],
        )
      ).rows[0] || null;
    return { current, sessions, history, review };
  });
}

const brl = (v: unknown) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(v) || 0);
const dayLabel = (d: string) => d.split('-').reverse().join('/');

/**
 * Envia o espelho de repasse por e-mail ao profissional (para o e-mail do acesso vinculado a ele).
 * Pacientes aparecem só pelo primeiro nome.
 */
export async function sendPayoutMirror(ctx: Context, id: string, range: PayoutPeriod = {}) {
  permit(ctx, financeRoles);
  const details = await payoutDetails(ctx, id, range);
  const [p] = await query(
    "SELECT p.name,p.unit_id,u.email,t.name AS tenant_name FROM professionals p JOIN tenants t ON t.id=p.tenant_id LEFT JOIN users u ON u.id::text=p.metadata->>'user_id' WHERE p.tenant_id=$1 AND p.id=$2",
    [ctx.tenantId, id],
  );
  if (!p?.email)
    throw new ApiError(
      422,
      'Este profissional ainda não tem acesso com e-mail. Cadastre o acesso em Usuários e vincule o profissional.',
    );
  const tz = await unitTimezone(ctx.tenantId, p.unit_id),
    dates = period(range),
    current = details.current as Record<string, any>;
  const lines = (details.sessions as Record<string, any>[]).map(
    (a) =>
      `- ${formatDateTime(a.starts_at, tz)} · ${String(a.patient_name).split(' ')[0]} · ${brl(a.amount)}${a.financial_hold ? ' (bloqueada)' : ''}`,
  );
  const body = [
    `Olá, ${p.name.split(' ')[0]}!`,
    '',
    `Segue o espelho de repasse da ${p.tenant_name}` +
      (dates.from && dates.to
        ? ` de ${dayLabel(dates.from)} a ${dayLabel(dates.to)}.`
        : ' (sessões ainda não pagas).'),
    '',
    'Sessões:',
    ...(lines.length ? lines : ['- Nenhuma sessão no período.']),
    '',
    `Sessões elegíveis: ${brl(current.base_amount)}`,
    `Ajustes justificados: ${brl(current.adjustment_amount)}`,
    `Total do espelho: ${brl(current.amount)}`,
    '',
    'Se algo não conferir, responda pela plataforma em Repasses (contestar o espelho).',
  ].join('\n');
  const mailId = await transaction(async (c) => {
    const mail = await queueEmail(c, {
      tenantId: ctx.tenantId,
      kind: 'PAYOUT_MIRROR',
      to: p.email,
      toName: p.name,
      subject: `Espelho de repasse · ${p.tenant_name}`,
      body,
      createdBy: ctx.userId,
    });
    await audit(c, ctx, 'payout.mirror_emailed', 'professionals', id, p.unit_id, {
      to: p.email,
      period: dates,
      amount: current.amount,
    });
    return mail;
  });
  await deliverSoon(mailId);
  return { ok: true, to: p.email, mode: mailMode() };
}
