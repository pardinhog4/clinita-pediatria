import { unitTimezone } from './clinic-rules';
import { localDate } from '@/lib/timezone';
import { resolveRules } from '@/lib/clinic-rules';
import { query } from '@/lib/db';
import { mergeTemplates } from './message-templates';
import { assertUnit, permit, type Context } from '@/lib/security';
import { auditRoles, financeRoles, receptionRoles, managers } from './repository';
import { authorizationType, evidenceGaps, requiredTokens } from './session-evidence';
import { referralCount } from './referrals';
type OperationalSession = Record<string, any> & {
  id: string;
  version: number;
  gaps: string[];
  authorization_type: string;
  required_tokens: number;
};
export async function operationalSessions(
  ctx: Context,
  unit: string,
): Promise<OperationalSession[]> {
  assertUnit(ctx, unit);
  const rows = await query<OperationalSession>(
    `SELECT a.id,a.version,a.status,a.starts_at,a.ends_at,a.patient_id,a.professional_id,a.arrived_at,a.authorization_status,a.authorization_evidence,a.signature_evidence,a.audit_status,a.reason,a.token_count,a.authorization_expires::text,a.token_requested_at,a.signature_requested_at,a.contested_at,a.contest_reason,a.contest_resolved_at,a.contest_resolution,a.financial_hold,a.absence_kind,a.appointment_kind,a.assistant_names,(a.evolution IS NOT NULL) AS evolution_recorded,(a.starts_at AT TIME ZONE unit_tz(a.tenant_id,a.unit_id))::date::text AS session_date,extract(epoch FROM(a.ends_at-a.starts_at))/60 AS duration,p.name AS patient_name,p.guardian,p.phone,p.card_number,p.insurer_id,pr.name AS professional_name,pr.specialty,i.name AS insurer_name,i.rules,bi.batch_id,bb.number AS batch_number,bi.status AS billing_status,bi.paid_amount,bi.denial_reason,round(session_amount(a.tenant_id,i.id,pr.specialty,extract(epoch FROM(a.ends_at-a.starts_at))/60,i.rules),2)::float AS amount FROM appointments a JOIN patients p ON p.id=a.patient_id AND p.tenant_id=a.tenant_id JOIN professionals pr ON pr.id=a.professional_id AND pr.tenant_id=a.tenant_id JOIN insurers i ON i.id=p.insurer_id AND i.tenant_id=p.tenant_id LEFT JOIN billing_items bi ON bi.appointment_id=a.id AND bi.tenant_id=a.tenant_id LEFT JOIN billing_batches bb ON bb.id=bi.batch_id AND bb.tenant_id=a.tenant_id WHERE a.tenant_id=$1 AND a.unit_id=$2 ORDER BY a.starts_at DESC LIMIT 2000`,
    [ctx.tenantId, unit],
  );
  return rows.map(
    (r) =>
      ({
        ...r,
        duration: Number(r.duration),
        amount: Number(r.amount),
        authorization_type: authorizationType(r.rules, r.insurer_name),
        required_tokens: requiredTokens(r.rules, Number(r.duration)),
        gaps: evidenceGaps(r),
      }) as OperationalSession,
  );
}
export async function guides(ctx: Context, unit: string) {
  permit(ctx, [...receptionRoles, 'AUDIT']);
  const sessions = await operationalSessions(ctx, unit);
  const base = sessions.filter(
    (a) =>
      a.authorization_type !== 'PRIVATE' &&
      a.authorization_type !== 'QUOTA' &&
      a.status !== 'CANCELLED',
  );
  const tz = await unitTimezone(ctx.tenantId, unit),
    today = localDate(new Date(), tz);
  const pending = base.filter(
    (a) =>
      a.status !== 'ABSENT' &&
      (a.arrived_at ||
        a.session_date <= today ||
        a.token_requested_at ||
        a.signature_requested_at) &&
      ((a.authorization_type === 'TOKEN' &&
        (a.authorization_status !== 'MANUAL' ||
          Number(a.token_count) < a.required_tokens ||
          (!!a.authorization_expires && a.authorization_expires < a.session_date))) ||
        (a.authorization_type === 'GUIDE' && !a.signature_evidence)),
  );
  const validated = base.filter(
    (a) =>
      a.status !== 'ABSENT' &&
      !a.financial_hold &&
      (a.authorization_type === 'TOKEN'
        ? a.authorization_status === 'MANUAL' &&
          Number(a.token_count) >= a.required_tokens &&
          (!a.authorization_expires || a.authorization_expires >= a.session_date)
        : !!a.signature_evidence),
  );
  const contested = sessions.filter((a) => a.contested_at && !a.contest_resolved_at);
  const credits = await query(
    `SELECT c.*,p.name AS patient_name,p.guardian,i.name AS insurer_name,i.rules->>'contract_end' AS contract_end FROM session_credits c JOIN patients p ON p.id=c.patient_id AND p.tenant_id=c.tenant_id JOIN insurers i ON i.id=c.insurer_id AND i.tenant_id=c.tenant_id WHERE c.tenant_id=$1 AND c.unit_id=$2 AND c.status IN('OPEN','RESERVED') ORDER BY c.created_at`,
    [ctx.tenantId, unit],
  );
  const requests = await operationRequests(ctx, unit);
  return {
    pending,
    validated,
    contested,
    credits,
    requests: requests.data,
    summary: {
      pending: pending.length,
      risk: pending.reduce((s, a) => s + Number(a.amount), 0),
      requested_today: sessions.filter(
        (a) => a.token_requested_at && localDate(a.token_requested_at, tz) === today,
      ).length,
      credits: credits.length,
      contested: contested.length,
    },
    monitor: {
      connected: false,
      last_check: null,
      message:
        'Operadoras sem conector configurado. A validação é manual; nenhuma consulta automática é simulada.',
    },
  };
}
export async function billing(ctx: Context, unit: string) {
  permit(ctx, [...auditRoles, 'FINANCE']);
  const sessions = (await operationalSessions(ctx, unit)).filter(
    (a) =>
      a.authorization_type !== 'PRIVATE' &&
      new Date(a.starts_at) <= new Date() &&
      a.status !== 'CANCELLED',
  );
  const ready = sessions.filter(
    (a) => !a.batch_id && !a.gaps.length && a.audit_status === 'APPROVED',
  );
  const pending = sessions.filter(
    (a) =>
      !a.batch_id &&
      !['ABSENT'].includes(a.status) &&
      a.audit_status !== 'RETURNED' &&
      (a.gaps.length || a.audit_status !== 'APPROVED'),
  );
  const returned = sessions.filter((a) => !a.batch_id && a.audit_status === 'RETURNED');
  const absent = sessions.filter((a) => a.status === 'ABSENT');
  const in_batch = sessions.filter((a) => a.batch_id);
  const batches = await query(
    `SELECT b.*,i.name AS insurer_name,u.name AS author,count(bi.id)::int AS items,count(*) FILTER(WHERE bi.status='PAID')::int AS paid,count(*) FILTER(WHERE bi.status IN('PARTIAL','DENIED'))::int AS denied,coalesce(sum(bi.paid_amount),0)::float AS received,coalesce(sum(bi.amount-bi.paid_amount) FILTER(WHERE bi.status IN('PARTIAL','DENIED')),0)::float AS denied_amount FROM billing_batches b JOIN insurers i ON i.id=b.insurer_id AND i.tenant_id=b.tenant_id JOIN users u ON u.id=b.created_by LEFT JOIN billing_items bi ON bi.batch_id=b.id AND bi.tenant_id=b.tenant_id WHERE b.tenant_id=$1 AND b.unit_id=$2 GROUP BY b.id,i.name,u.name ORDER BY b.created_at DESC`,
    [ctx.tenantId, unit],
  );
  const items = await query(
    `SELECT bi.id,bi.batch_id,bi.appointment_id,bi.amount::float,bi.paid_amount::float,bi.status,bi.denial_reason,bi.snapshot,b.number AS batch_number FROM billing_items bi JOIN billing_batches b ON b.id=bi.batch_id AND b.tenant_id=bi.tenant_id WHERE bi.tenant_id=$1 AND b.unit_id=$2 ORDER BY b.created_at DESC`,
    [ctx.tenantId, unit],
  );
  return {
    ready,
    pending,
    returned,
    absent,
    in_batch,
    batches,
    items,
    summary: {
      ready: ready.length,
      ready_amount: ready.reduce((s, a) => s + Number(a.amount), 0),
      pending: pending.length,
      risk: pending.reduce((s, a) => s + Number(a.amount), 0),
      absent: absent.length,
      in_batch: in_batch.length,
      denied: items.filter((i) => ['PARTIAL', 'DENIED'].includes(i.status)).length,
    },
    xml: {
      available: false,
      message:
        'XML para envio depende da parametrização do prestador, dos procedimentos e da validação no XSD oficial da operadora. A relação CSV é para conferência e não substitui o XML TISS.',
    },
  };
}
export async function operationRequests(ctx: Context, unit: string) {
  permit(ctx, [...receptionRoles, 'AUDIT', 'FINANCE']);
  assertUnit(ctx, unit);
  return {
    data: await query(
      `SELECT r.*,p.name AS patient_name,pr.name AS professional_name FROM operation_requests r LEFT JOIN appointments a ON a.id=r.appointment_id AND a.tenant_id=r.tenant_id LEFT JOIN patients p ON p.id=a.patient_id AND p.tenant_id=a.tenant_id LEFT JOIN professionals pr ON pr.id=r.professional_id AND pr.tenant_id=r.tenant_id WHERE r.tenant_id=$1 AND r.unit_id=$2 AND (r.kind<>'PAYOUT' OR $3::boolean) ORDER BY r.created_at DESC LIMIT 300`,
      [ctx.tenantId, unit, financeRoles.includes(ctx.role)],
    ),
  };
}
export async function waitlist(ctx: Context, unit: string) {
  permit(ctx, receptionRoles);
  assertUnit(ctx, unit);
  const data = await query(
    `SELECT w.*,p.name AS patient_name,p.guardian,p.phone FROM waitlist w JOIN patients p ON p.id=w.patient_id AND p.tenant_id=w.tenant_id WHERE w.tenant_id=$1 AND w.unit_id=$2 AND w.status<>'CANCELLED' ORDER BY CASE WHEN w.priority='HIGH' THEN 0 ELSE 1 END,w.created_at`,
    [ctx.tenantId, unit],
  );
  const sessions = await operationalSessions(ctx, unit);
  return {
    data,
    absent: sessions.filter((a) => a.status === 'ABSENT' || a.absence_kind === 'PROFESSIONAL'),
    credits: await query(
      "SELECT * FROM session_credits WHERE tenant_id=$1 AND unit_id=$2 AND status IN('OPEN','RESERVED')",
      [ctx.tenantId, unit],
    ),
    absences: await query(
      `SELECT pa.*,p.name AS professional_name FROM professional_absences pa JOIN professionals p ON p.id=pa.professional_id AND p.tenant_id=pa.tenant_id WHERE pa.tenant_id=$1 AND pa.unit_id=$2 ORDER BY pa.starts_at DESC LIMIT 100`,
      [ctx.tenantId, unit],
    ),
  };
}
export const defaultSettings = {
  automations: [
    { id: 'reminder', name: 'Lembrete na véspera', enabled: true, minutes_before: 1440 },
    {
      id: 'token',
      name: 'Solicitação de token antes da sessão',
      enabled: true,
      minutes_before: 30,
    },
    { id: 'absence', name: 'Alerta de duas faltas seguidas', enabled: true, minutes_before: 0 },
    {
      id: 'reschedule',
      name: 'Proposta de reagendamento após recusa',
      enabled: true,
      minutes_before: 0,
    },
    {
      id: 'vacancy',
      name: 'Oferta de vagas para a lista de espera',
      enabled: false,
      minutes_before: 0,
    },
    {
      id: 'response',
      name: 'Resposta da IA nos canais de agendamento',
      enabled: true,
      minutes_before: 0,
    },
  ],
  templates: [
    {
      id: 'welcome',
      name: 'Acolhimento',
      content: 'Olá, {responsavel}! Como podemos ajudar no atendimento de {paciente}?',
    },
    {
      id: 'reminder',
      name: 'Lembrete de sessão',
      content:
        'Olá, {responsavel}! A sessão de {paciente} está marcada para {data} às {hora}. Você confirma?',
    },
    {
      id: 'token',
      name: 'Pedido de token',
      content:
        'Olá, {responsavel}! Por favor, libere a autorização de {paciente} para a sessão de {data} às {hora}.',
    },
    {
      id: 'signature',
      name: 'Assinatura de guia',
      content: 'Olá, {responsavel}! Confira e assine a guia do atendimento de {paciente}: {link}.',
    },
  ],
  channels: [
    {
      id: 'official',
      name: 'Número oficial · agendamentos',
      description: 'Novos pacientes de todas as unidades',
    },
    { id: 'corporate', name: 'Número corporativo', description: 'Canal legado da clínica' },
    { id: 'unit', name: 'WhatsApp da unidade', description: 'Pacientes já agendados' },
  ],
};
export async function settings(ctx: Context) {
  permit(ctx, managers);
  const [row] = await query('SELECT value,version FROM clinic_settings WHERE tenant_id=$1', [
    ctx.tenantId,
  ]);
  const value = { ...defaultSettings, ...row?.value };
  return {
    value: {
      ...value,
      templates: mergeTemplates(value.templates),
      rules: resolveRules(value.rules),
    },
    version: row?.version || 1,
    transport_connected: false,
  };
}
export async function navigationCounts(ctx: Context, unit: string) {
  assertUnit(ctx, unit);
  const [r] = await query(
    `SELECT (SELECT count(*)::int FROM conversations WHERE tenant_id=$1 AND unit_id=$2 AND sandbox=false AND deleted_at IS NULL AND status<>'DONE') AS atendimento,(SELECT count(*)::int FROM payout_reviews pr JOIN professionals p ON p.id=pr.professional_id AND p.tenant_id=pr.tenant_id WHERE pr.tenant_id=$1 AND pr.unit_id=$2 AND pr.status='CONFIRMED' AND ($3::text IS NULL OR p.metadata->>'user_id'=$3)) AS repasses`,
    [ctx.tenantId, unit, ctx.role === 'CLINICIAN' ? ctx.userId : null],
  );
  let guias = 0,
    faturamento = 0;
  if ([...receptionRoles, 'AUDIT'].includes(ctx.role))
    guias = (await guides(ctx, unit)).pending.length;
  if ([...auditRoles, 'FINANCE'].includes(ctx.role)) {
    const b = await billing(ctx, unit);
    faturamento = b.ready.length + b.pending.length + b.returned.length;
  }
  return { ...r, guias, faturamento, encaminhamentos: await referralCount(ctx, unit) };
}
