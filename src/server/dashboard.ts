import { query } from '@/lib/db';
import { dayCapacity, dayWindow, type ClinicRules, type WorkHours } from '@/lib/clinic-rules';
import { unitRules } from './clinic-rules';
import { assertUnit, type Context } from '@/lib/security';
import { financeRoles, clinicRoles } from './repository';
import { payouts } from './payouts';
export async function dashboard(ctx: Context, unit: string) {
  assertUnit(ctx, unit);
  const rules = await unitRules(ctx.tenantId, unit);
  const own = ctx.role === 'CLINICIAN' ? ctx.userId : null;
  const [appointments] = await query(
    `SELECT count(*)::int AS total,count(*) FILTER(WHERE a.status='COMPLETED')::int AS completed,count(*) FILTER(WHERE a.status='ABSENT' AND a.absence_kind='PATIENT')::int AS absent,count(*) FILTER(WHERE a.status='IN_PROGRESS')::int AS in_progress,count(*) FILTER(WHERE a.status='COMPLETED' AND a.audit_status<>'APPROVED')::int AS pending_audit,count(*) FILTER(WHERE a.authorization_status='PENDING' AND i.rules->>'token_required'='true' AND a.status NOT IN('CANCELLED','ABSENT') AND (a.starts_at AT TIME ZONE unit_tz($1,$2))::date=(now() AT TIME ZONE unit_tz($1,$2))::date)::int AS pending_auth,count(*) FILTER(WHERE a.signature_evidence IS NULL AND i.rules->>'signature_required'='true' AND a.status NOT IN('CANCELLED','ABSENT') AND (a.starts_at AT TIME ZONE unit_tz($1,$2))::date=(now() AT TIME ZONE unit_tz($1,$2))::date)::int AS pending_signature,count(*) FILTER(WHERE a.status='SCHEDULED' AND a.starts_at BETWEEN now()-interval '10 minutes' AND now()+make_interval(mins=>$4))::int AS arriving_soon,count(*) FILTER(WHERE a.status='SCHEDULED' AND a.starts_at<now() AND (a.starts_at AT TIME ZONE unit_tz($1,$2))::date=(now() AT TIME ZONE unit_tz($1,$2))::date)::int AS no_arrival,count(*) FILTER(WHERE (a.starts_at AT TIME ZONE unit_tz($1,$2))::date=(now() AT TIME ZONE unit_tz($1,$2))::date AND a.status<>'CANCELLED')::int AS today FROM appointments a JOIN professionals pr ON pr.id=a.professional_id AND pr.tenant_id=a.tenant_id JOIN patients p ON p.id=a.patient_id AND p.tenant_id=a.tenant_id JOIN insurers i ON i.id=p.insurer_id AND i.tenant_id=p.tenant_id WHERE a.tenant_id=$1 AND a.unit_id=$2 AND ($3::text IS NULL OR pr.metadata->>'user_id'=$3 AND pr.active=true)`,
    [ctx.tenantId, unit, own, rules.arrival_window_minutes],
  );
  const [patients] = await query(
    `SELECT count(*)::int AS count FROM patients p WHERE p.tenant_id=$1 AND p.unit_id=$2 AND ($3::text IS NULL OR EXISTS(SELECT 1 FROM appointments a JOIN professionals pr ON pr.id=a.professional_id AND pr.tenant_id=a.tenant_id WHERE a.tenant_id=p.tenant_id AND a.patient_id=p.id AND pr.metadata->>'user_id'=$3 AND pr.active=true))`,
    [ctx.tenantId, unit, own],
  );
  let financial = null;
  if (financeRoles.includes(ctx.role)) {
    [financial] = await query(
      `SELECT coalesce(sum(amount) FILTER(WHERE kind='INCOME' AND status='OPEN'),0)::float AS receivable,coalesce(sum(amount) FILTER(WHERE kind='EXPENSE' AND status='OPEN'),0)::float AS payable,coalesce(sum(CASE WHEN kind='INCOME' THEN amount ELSE -amount END) FILTER(WHERE status='SETTLED'),0)::float AS balance FROM ledger WHERE tenant_id=$1 AND unit_id=$2`,
      [ctx.tenantId, unit],
    );
  }
  const daily = await query(
    `SELECT to_char(a.starts_at AT TIME ZONE unit_tz($1,$2),'DD/MM') AS day,count(*)::int AS count,count(*) FILTER(WHERE a.status='ABSENT' AND a.absence_kind='PATIENT')::int AS absent,min(a.starts_at) AS first_day FROM appointments a JOIN professionals pr ON pr.id=a.professional_id AND pr.tenant_id=a.tenant_id WHERE a.tenant_id=$1 AND a.unit_id=$2 AND ($3::text IS NULL OR pr.metadata->>'user_id'=$3) GROUP BY 1 ORDER BY min(a.starts_at) DESC LIMIT 12`,
    [ctx.tenantId, unit, own],
  );
  daily.reverse();
  const [controls] = await query(
    `SELECT (SELECT count(*)::int FROM session_credits WHERE tenant_id=$1 AND unit_id=$2 AND status IN('OPEN','RESERVED')) AS credits,(SELECT count(*)::int FROM appointments WHERE tenant_id=$1 AND unit_id=$2 AND financial_hold=true) AS contested,(SELECT count(*)::int FROM professionals WHERE tenant_id=$1 AND unit_id=$2 AND contract='PJ' AND active=true AND coalesce((metadata->>'pj_documents_confirmed')::boolean,false)=false) AS pj_pending,(SELECT count(*)::int FROM waitlist WHERE tenant_id=$1 AND unit_id=$2 AND status IN('WAITING','OFFERED')) AS waitlist,(SELECT count(*)::int FROM conversation_proposals WHERE tenant_id=$1 AND unit_id=$2 AND status='ACCEPTED') AS accepted_proposals,(SELECT count(*)::int FROM conversations WHERE tenant_id=$1 AND unit_id=$2 AND deleted_at IS NULL AND status IN('HUMAN','REVIEW') AND (include_clinical_context=false OR $3::boolean)) AS human_queue,(SELECT count(*)::int FROM billing_items bi JOIN billing_batches b ON b.id=bi.batch_id AND b.tenant_id=bi.tenant_id WHERE bi.tenant_id=$1 AND b.unit_id=$2 AND bi.status IN('PARTIAL','DENIED')) AS denied`,
    [ctx.tenantId, unit, clinicRoles.includes(ctx.role)],
  );
  const [risk] = await query(
    `SELECT coalesce(sum(session_amount(a.tenant_id,i.id,pr.specialty,extract(epoch FROM(a.ends_at-a.starts_at))/60,i.rules)),0)::float AS amount FROM appointments a JOIN professionals pr ON pr.id=a.professional_id AND pr.tenant_id=a.tenant_id JOIN patients p ON p.id=a.patient_id AND p.tenant_id=a.tenant_id JOIN insurers i ON i.id=p.insurer_id AND i.tenant_id=p.tenant_id WHERE a.tenant_id=$1 AND a.unit_id=$2 AND a.starts_at<=now() AND a.status NOT IN('CANCELLED','ABSENT') AND (i.rules->>'token_required'='true' AND a.authorization_status='PENDING' OR i.rules->>'signature_required'='true' AND a.signature_evidence IS NULL)`,
    [ctx.tenantId, unit],
  );
  const [occupancy] = await query(
    `WITH ranges AS(SELECT a.professional_id,range_agg(tstzrange(a.starts_at,a.ends_at,'[)')) AS hours FROM appointments a WHERE a.tenant_id=$1 AND a.unit_id=$2 AND a.status NOT IN('CANCELLED','ABSENT') AND date_trunc('week',a.starts_at AT TIME ZONE unit_tz($1,$2))=date_trunc('week',now() AT TIME ZONE unit_tz($1,$2)) GROUP BY a.professional_id) SELECT coalesce((SELECT sum(extract(epoch FROM(upper(r)-lower(r)))/60) FROM ranges CROSS JOIN LATERAL unnest(hours) r),0)::float AS occupied`,
    [ctx.tenantId, unit],
  );
  // Capacidade da semana: expediente configurado da unidade em cada dia de atendimento do
  // profissional (menos o intervalo), recortado pelo horário próprio dele quando houver.
  occupancy.capacity = (
    await query(
      "SELECT coalesce(metadata->'work_days','[1,2,3,4,5,6]'::jsonb) AS work_days,metadata->'work_hours' AS work_hours FROM professionals WHERE tenant_id=$1 AND unit_id=$2 AND active=true",
      [ctx.tenantId, unit],
    )
  ).reduce(
    (total, p) =>
      total +
      (p.work_days as number[]).reduce(
        (sum, day) => sum + professionalDayCapacity(rules, Number(day), p.work_hours),
        0,
      ),
    0,
  );
  const [next] = own
    ? await query(
        `SELECT a.starts_at,p.name AS patient_name FROM appointments a JOIN professionals pr ON pr.id=a.professional_id AND pr.tenant_id=a.tenant_id JOIN patients p ON p.id=a.patient_id AND p.tenant_id=a.tenant_id WHERE a.tenant_id=$1 AND a.unit_id=$2 AND pr.metadata->>'user_id'=$3 AND a.status IN('SCHEDULED','ARRIVED') AND a.ends_at>now() ORDER BY a.starts_at LIMIT 1`,
        [ctx.tenantId, unit, own],
      )
    : [];
  const payout =
    financeRoles.includes(ctx.role) || ctx.role === 'CLINICIAN'
      ? (await payouts(ctx, unit)).summary
      : null;
  const [inbox] = await query(
    `SELECT count(*) FILTER(WHERE c.status='WAITING')::int AS waiting,count(*) FILTER(WHERE c.status='WAITING' AND c.created_at<now()-make_interval(mins=>$3))::int AS overdue FROM conversations c WHERE c.tenant_id=$1 AND c.unit_id=$2 AND c.sandbox=false AND c.deleted_at IS NULL`,
    [ctx.tenantId, unit, rules.inbox_overdue_minutes],
  );
  return {
    appointments,
    patients: patients.count,
    financial,
    daily,
    controls,
    payout,
    next: next || null,
    inbox,
    occupancy: occupancy.capacity
      ? Math.min(100, Math.round((occupancy.occupied / occupancy.capacity) * 100))
      : 0,
    absence_rate: Math.round(
      (appointments.absent / Math.max(1, appointments.completed + appointments.absent)) * 100,
    ),
    risk: ctx.role === 'CLINICIAN' ? null : risk.amount,
  };
}

/** Minutos de atendimento do profissional no dia: expediente da unidade, menos intervalo. */
function professionalDayCapacity(rules: ClinicRules, day: number, workHours: WorkHours | null) {
  if (!workHours?.[String(day)]) return dayCapacity(rules, day);
  const w = dayWindow(rules, day, false, workHours);
  if (!w) return 0;
  const lunch =
    w.breakStart !== null
      ? Math.max(0, Math.min(w.close, w.breakEnd!) - Math.max(w.open, w.breakStart))
      : 0;
  return w.close - w.open - lunch;
}
