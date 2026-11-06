import { z } from 'zod';
import { query, transaction } from '@/lib/db';
import { ApiError } from '@/lib/errors';
import { permit, type Context } from '@/lib/security';
import { audit, receptionRoles } from './repository';
import {
  addDaysTo,
  localDate,
  localMinutes,
  localTime,
  localWeekday,
  weekdayOf,
  zonedInstant,
} from '@/lib/timezone';
import {
  clock,
  dayTimes,
  homeBlocks,
  outsideHoursMessage,
  sessionsPerWeek,
  weekdayNames,
  type ClinicRules,
} from '@/lib/clinic-rules';
import { unitRules } from './clinic-rules';
// Agendamento a partir do plano: para cada item aceito, encontra horários semanais que se repetem por N semanas
// sem conflito de profissional, sala ou paciente, e transforma a escolha em proposta (aceite da família + aprovação da equipe).
const DAY = 86400000;
export const prefsSchema = z
  .object({
    period: z.enum(['MORNING', 'AFTERNOON', 'ANY']),
    weekdays: z.array(z.number().int().min(0).max(6)).min(1).max(7),
    start_date: z.iso.date(),
    weeks: z.number().int().min(1).max(12),
    duration: z.union([z.literal(30), z.literal(60)]),
    item_ids: z.array(z.uuid()).max(20).optional(),
  })
  .strict();
// Datas e horas no fuso da unidade do plano (rules.timezone).
const at = (date: string, minutes: number, tz: string) => zonedInstant(date, clock(minutes), tz);
const dow = weekdayOf;
const addDays = addDaysTo;
const overlaps = (a: { s: number; e: number }, b: { s: number; e: number }) =>
  a.s < b.e && a.e > b.s;
const plan_ = (rules: ClinicRules, i: any, d: { duration: number; weekdays: number[] }) => {
  const wh = i.weekly_hours === null ? null : Number(i.weekly_hours);
  return i.modality === 'HOME'
    ? { home: true, ...homeBlocks(rules, wh, d.weekdays.length) }
    : {
        home: false,
        needed: sessionsPerWeek(wh, d.duration, d.weekdays.length),
        minutes: d.duration,
      };
};
async function loadPlan(ctx: Context, planId: string, lock?: import('pg').PoolClient) {
  z.uuid().parse(planId);
  const run = lock ? (t: string, v: unknown[]) => lock.query(t, v).then((r) => r.rows) : query;
  const [plan] = await run(
    `SELECT rp.*,c.patient_id AS conversation_patient_id,c.deleted_at,c.status AS conversation_status,c.guardian FROM referral_plans rp JOIN conversations c ON c.id=rp.conversation_id AND c.tenant_id=rp.tenant_id WHERE rp.tenant_id=$1 AND rp.id=$2 AND rp.status='ACTIVE'${lock ? ' FOR UPDATE OF rp' : ''}`,
    [ctx.tenantId, planId],
  );
  if (!plan || !ctx.unitIds.includes(plan.unit_id) || plan.deleted_at)
    throw new ApiError(404, 'Plano de encaminhamento não encontrado.');
  const items = await run(
    `SELECT i.*,p.name AS professional_name,p.specialty,p.room_id,p.metadata AS professional_metadata,p.active AS professional_active,r.capacity,coalesce((SELECT s.shared_room FROM specialties s WHERE s.tenant_id=p.tenant_id AND s.code=p.specialty),false) AS shared_room FROM referral_items i JOIN professionals p ON p.id=i.professional_id AND p.tenant_id=i.tenant_id JOIN rooms r ON r.id=p.room_id AND r.tenant_id=p.tenant_id WHERE i.tenant_id=$1 AND i.plan_id=$2 AND i.state='ACCEPTED' AND i.route='PROFESSIONAL' AND i.proposal_id IS NULL ORDER BY i.position${lock ? ' FOR UPDATE OF i' : ''}`,
    [ctx.tenantId, planId],
  );
  return {
    plan,
    items,
    patientId: (plan.conversation_patient_id || plan.patient_id) as string | null,
  };
}
type Chosen = { item: any; s: number; e: number };
// Carrega a agenda do horizonte uma vez e devolve o motivo de conflito de um horário (ou null se livre em todas as semanas).
async function checker(
  ctx: Context,
  plan: any,
  patientId: string | null,
  items: any[],
  startDate: string,
  weeks: number,
) {
  const rules = await unitRules(ctx.tenantId, plan.unit_id);
  const horizonEnd = addDays(startDate, 7 * weeks + 14),
    profIds = [...new Set(items.map((i) => i.professional_id))],
    roomIds = [...new Set(items.map((i) => i.room_id))];
  const busy: any[] = (
    await query(
      `SELECT professional_id,room_id,patient_id,location,starts_at,ends_at FROM appointments WHERE tenant_id=$1 AND status NOT IN('CANCELLED','ABSENT') AND starts_at<$3::date::timestamptz AND ends_at>$2::date::timestamptz AND (professional_id=ANY($4::uuid[]) OR room_id=ANY($5::uuid[]) OR patient_id=$6)`,
      [ctx.tenantId, startDate, horizonEnd, profIds, roomIds, patientId],
    )
  ).map((a) => ({ ...a, s: new Date(a.starts_at).getTime(), e: new Date(a.ends_at).getTime() }));
  const absences = (
    await query(
      'SELECT professional_id,starts_at,ends_at FROM professional_absences WHERE tenant_id=$1 AND professional_id=ANY($2::uuid[]) AND status=\x27ACTIVE\x27 AND starts_at<$4::date::timestamptz AND ends_at>$3::date::timestamptz',
      [ctx.tenantId, profIds, startDate, horizonEnd],
    )
  ).map((a) => ({
    professional_id: a.professional_id,
    s: new Date(a.starts_at).getTime(),
    e: new Date(a.ends_at).getTime(),
  }));
  // Propostas em aberto da mesma família ainda não reservaram a agenda, mas a criança já tem esses horários oferecidos.
  const offered = (
    await query(
      "SELECT appointments FROM conversation_proposals WHERE tenant_id=$1 AND conversation_id=$2 AND status IN('DRAFT','ACCEPTED')",
      [ctx.tenantId, plan.conversation_id],
    )
  ).flatMap((p) =>
    (p.appointments as any[]).flatMap((a) =>
      Array.from({ length: a.occurrences || 1 }, (_, k) => {
        const s = new Date(a.starts_at).getTime() + k * 7 * DAY;
        return { s, e: s + a.duration * 60000 };
      }),
    ),
  );
  const age = plan.age_years === null ? null : Number(plan.age_years),
    now = Date.now();
  return (item: any, s: number, e: number, chosen: Chosen[]): string | null => {
    const home = item.modality === 'HOME',
      meta = item.professional_metadata || {},
      limit = home ? 1 : item.shared_room ? item.capacity : 1,
      minutes = localMinutes(s, rules.timezone),
      dur = (e - s) / 60000,
      wd = localWeekday(s, rules.timezone);
    if (!dayTimes(rules, wd, dur, 'ANY', home).includes(minutes))
      return outsideHoursMessage(rules, wd, home).replace(/.$/, '').toLowerCase();
    if (!dayTimes(rules, wd, dur, 'ANY', home, meta.work_hours).includes(minutes))
      return 'fora do horário de trabalho do profissional';
    if (meta.work_days?.length && !meta.work_days.includes(wd))
      return 'o profissional não atende neste dia';
    if (age !== null && (age < Number(meta.min_age || 0) || age >= Number(meta.max_age ?? 120) + 1))
      return 'idade fora da faixa do profissional';
    // Todas as sessões desta proposta são do mesmo paciente e se repetem nas mesmas semanas: não podem se sobrepor.
    if (chosen.some((c) => overlaps(c, { s, e }))) return 'sobrepõe outra sessão desta proposta';
    for (let k = 0; k < weeks; k++) {
      const w = { s: s + k * 7 * DAY, e: e + k * 7 * DAY },
        when = k ? ` na semana ${k + 1}` : '';
      if (w.s <= now) return 'horário já passou';
      if (absences.some((a) => a.professional_id === item.professional_id && overlaps(a, w)))
        return 'profissional ausente' + when;
      const here = busy.filter((a) => overlaps(a, w));
      if (patientId && here.some((a) => a.patient_id === patientId))
        return 'o paciente já tem sessão neste horário' + when;
      if (offered.some((o) => overlaps(o, w)))
        return 'conflita com horários já propostos a esta família' + when;
      if (here.filter((a) => a.professional_id === item.professional_id).length >= limit)
        return 'profissional ocupado' + when;
      if (
        !home &&
        here.filter((a) => a.room_id === item.room_id && a.location === 'CLINIC').length >=
          item.capacity
      )
        return 'sala sem vaga' + when;
    }
    return null;
  };
}
export async function suggestSchedule(ctx: Context, planId: string, input: unknown) {
  permit(ctx, receptionRoles);
  const d = prefsSchema.parse(input);
  const { plan, items: all, patientId } = await loadPlan(ctx, planId);
  const rules = await unitRules(ctx.tenantId, plan.unit_id),
    tz = rules.timezone;
  if (d.start_date < localDate(new Date(), tz))
    throw new ApiError(422, 'Escolha uma data de início a partir de hoje.');
  const items = all.filter((i) => !d.item_ids || d.item_ids.includes(i.id));
  if (!items.length) throw new ApiError(422, 'Nenhum item aceito aguardando horário neste plano.');
  const skipped = items
    .filter((i) => !i.professional_active)
    .map((i) => ({
      item_id: i.id,
      service_text: i.service_text,
      reason: 'Profissional inativo. Redistribua o item.',
    }));
  const schedulable = items.filter((i) => i.professional_active);
  const conflict = await checker(ctx, plan, patientId, schedulable, d.start_date, d.weeks),
    chosen: Chosen[] = [];
  const firstDates = Object.fromEntries(
    d.weekdays.map((w) => [w, addDays(d.start_date, (w - dow(d.start_date) + 7) % 7)]),
  );
  const results = [];
  // Domicílio (blocos longos) e itens com mais sessões escolhem primeiro; os dias são equilibrados para a criança não ter tudo no mesmo dia.
  const order = [...schedulable].sort(
    (a, b) =>
      (b.modality === 'HOME' ? 1 : 0) - (a.modality === 'HOME' ? 1 : 0) ||
      plan_(rules, b, d).needed - plan_(rules, a, d).needed ||
      a.position - b.position,
  );
  for (const item of order) {
    const rule = plan_(rules, item, d),
      slots: { starts_at: string; weekday: string; time: string; duration: number }[] = [];
    let preferred: number | null = null;
    const days = [...d.weekdays].sort(
      (a, b) =>
        chosen.filter((c) => localDate(c.s, tz) === firstDates[a]).length -
          chosen.filter((c) => localDate(c.s, tz) === firstDates[b]).length || a - b,
    );
    for (const w of days) {
      if (slots.length >= rule.needed) break;
      const times = dayTimes(
          rules,
          w,
          rule.minutes,
          d.period,
          rule.home,
          item.professional_metadata?.work_hours,
        ),
        seq: number[] =
          preferred === null ? times : [preferred, ...times.filter((t) => t !== preferred)];
      for (const m of seq) {
        if (!times.includes(m)) continue;
        const s = at(firstDates[w], m, tz).getTime(),
          e = s + rule.minutes * 60000;
        if (!conflict(item, s, e, chosen)) {
          chosen.push({ item, s, e });
          preferred ??= m;
          slots.push({
            starts_at: new Date(s).toISOString(),
            weekday: weekdayNames[w],
            time: localTime(s, tz),
            duration: rule.minutes,
          });
          break;
        }
      }
    }
    slots.sort((a, b) => a.starts_at.localeCompare(b.starts_at));
    results.push({
      item_id: item.id,
      position: item.position,
      service_text: item.service_text,
      professional_id: item.professional_id,
      professional_name: item.professional_name,
      specialty: item.specialty,
      location: rule.home ? 'HOME' : 'CLINIC',
      duration: rule.minutes,
      needed: rule.needed,
      slots,
      missing: rule.needed - slots.length,
    });
  }
  results.sort((a, b) => a.position - b.position);
  return {
    plan: { id: plan.id, patient_label: plan.patient_label, age_years: plan.age_years },
    start_date: d.start_date,
    duration: d.duration,
    weeks: d.weeks,
    items: results,
    skipped,
  };
}
const slotsSchema = z.object({
  weeks: z.number().int().min(1).max(12),
  duration: z.union([z.literal(30), z.literal(60)]),
  appointments: z
    .array(
      z
        .object({
          referral_item_id: z.uuid(),
          starts_at: z.iso.datetime({ offset: true }),
          duration: z.number().int().min(30).max(240).optional(),
        })
        .strict(),
    )
    .min(1)
    .max(30),
});
// Confere uma lista de horários (sugeridos ou editados à mão) contra a agenda e entre si.
async function validate(
  ctx: Context,
  plan: any,
  patientId: string | null,
  items: any[],
  d: z.infer<typeof slotsSchema>,
) {
  const first = d.appointments
    .map((a) => new Date(a.starts_at))
    .sort((a, b) => a.getTime() - b.getTime())[0];
  const rules = await unitRules(ctx.tenantId, plan.unit_id);
  const conflict = await checker(
      ctx,
      plan,
      patientId,
      items,
      localDate(first, rules.timezone),
      d.weeks,
    ),
    chosen: Chosen[] = [];
  return d.appointments.map((a, index) => {
    const item = items.find((i) => i.id === a.referral_item_id);
    if (!item)
      throw new ApiError(
        409,
        'Um dos itens não está mais aceito ou já tem proposta. Atualize a tela.',
      );
    const home = item.modality === 'HOME',
      duration = home
        ? (a.duration ??
          homeBlocks(rules, item.weekly_hours === null ? null : Number(item.weekly_hours), 6)
            .minutes)
        : d.duration;
    if (home && duration % rules.slot_minutes)
      throw new ApiError(422, `Blocos em domicílio em múltiplos de ${rules.slot_minutes} minutos.`);
    const s = new Date(a.starts_at).getTime(),
      e = s + duration * 60000,
      reason = conflict(item, s, e, chosen);
    chosen.push({ item, s, e });
    return {
      index,
      item,
      starts_at: a.starts_at,
      duration,
      location: home ? 'HOME' : 'CLINIC',
      reason,
      label: `${weekdayNames[localWeekday(s, rules.timezone)]} ${localTime(s, rules.timezone)}`,
    };
  });
}
export async function checkSlots(ctx: Context, planId: string, input: unknown) {
  permit(ctx, receptionRoles);
  const d = slotsSchema.parse(input);
  const { plan, items, patientId } = await loadPlan(ctx, planId);
  return {
    conflicts: (await validate(ctx, plan, patientId, items, d))
      .filter((r) => r.reason)
      .map((r) => ({ index: r.index, reason: r.reason })),
  };
}
const proposalSchema = slotsSchema.extend({ request_id: z.uuid() }).strict();
export async function createReferralProposal(ctx: Context, planId: string, input: unknown) {
  permit(ctx, receptionRoles);
  const d = proposalSchema.parse(input);
  return transaction(async (c) => {
    const { plan, items, patientId } = await loadPlan(ctx, planId, c);
    const {
      rows: [existing],
    } = await c.query(
      'SELECT * FROM conversation_proposals WHERE tenant_id=$1 AND conversation_id=$2 AND request_id=$3',
      [ctx.tenantId, plan.conversation_id, d.request_id],
    );
    if (existing) return { proposal: existing, idempotent: true };
    if (plan.conversation_status === 'DONE')
      throw new ApiError(
        422,
        'A conversa deste plano foi encerrada. Reabra o atendimento para propor horários.',
      );
    const checked = await validate(ctx, plan, patientId, items, d),
      bad = checked.find((r) => r.reason);
    if (bad)
      throw new ApiError(
        409,
        `Conflito em ${bad.label} (${bad.item.professional_name}): ${bad.reason}.`,
      );
    const appointments = checked.map((r) => ({
      professional_id: r.item.professional_id,
      starts_at: r.starts_at,
      duration: r.duration,
      occurrences: d.weeks,
      location: r.location,
      referral_item_id: r.item.id,
    }));
    const ids = [...new Set(appointments.map((a) => a.referral_item_id))];
    const {
      rows: [proposal],
    } = await c.query(
      'INSERT INTO conversation_proposals(tenant_id,unit_id,conversation_id,patient_id,appointments,request_id,created_by,referral_item_ids) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *',
      [
        ctx.tenantId,
        plan.unit_id,
        plan.conversation_id,
        patientId,
        JSON.stringify(appointments),
        d.request_id,
        ctx.userId,
        ids,
      ],
    );
    for (const id of ids) {
      const count = appointments.filter((a) => a.referral_item_id === id).length;
      await c.query(
        'UPDATE referral_items SET proposal_id=$3,version=version+1,updated_at=now(),history=history||$4::jsonb WHERE tenant_id=$1 AND id=$2',
        [
          ctx.tenantId,
          id,
          proposal.id,
          JSON.stringify([
            {
              at: new Date().toISOString(),
              action: 'PROPOSED',
              by: ctx.name,
              note: `${count} ${count === 1 ? 'horário semanal' : 'horários semanais'} por ${d.weeks} ${d.weeks === 1 ? 'semana' : 'semanas'}. Aguarda aceite da família.`,
            },
          ]),
        ],
      );
    }
    await c.query(
      "UPDATE conversations SET stage='PROPOSAL',version=version+1 WHERE tenant_id=$1 AND id=$2",
      [ctx.tenantId, plan.conversation_id],
    );
    await audit(
      c,
      ctx,
      'referral.proposal_created',
      'conversation_proposals',
      proposal.id,
      plan.unit_id,
      {
        planId,
        items: ids.length,
        sessionsPerWeek: appointments.length,
        weeks: d.weeks,
        reserved: false,
      },
    );
    return { proposal, idempotent: false };
  });
}
// Chamado na decisão da proposta: atualiza os itens do plano e o histórico.
export async function onProposalDecided(
  c: import('pg').PoolClient,
  ctx: Context,
  proposal: any,
  status: string,
  patientId: string | null,
) {
  if (!proposal.referral_item_ids?.length) return;
  const ids = proposal.referral_item_ids,
    entry = (action: string, note: string) =>
      JSON.stringify([{ at: new Date().toISOString(), action, by: ctx.name, note }]);
  if (status === 'ACCEPTED')
    await c.query(
      'UPDATE referral_items SET history=history||$3::jsonb,updated_at=now() WHERE tenant_id=$1 AND id=ANY($2::uuid[]) AND proposal_id=$4',
      [ctx.tenantId, ids, entry('FAMILY_ACCEPTED', 'Família aceitou os horários.'), proposal.id],
    );
  if (status === 'REJECTED')
    await c.query(
      'UPDATE referral_items SET proposal_id=NULL,version=version+1,updated_at=now(),history=history||$3::jsonb WHERE tenant_id=$1 AND id=ANY($2::uuid[]) AND proposal_id=$4',
      [
        ctx.tenantId,
        ids,
        entry('PROPOSAL_REJECTED', 'Proposta recusada. O item volta a aguardar horário.'),
        proposal.id,
      ],
    );
  if (status === 'APPROVED') {
    await c.query(
      "UPDATE referral_items SET state='SCHEDULED',scheduled_at=now(),version=version+1,updated_at=now(),decided_by=$5,decided_at=now(),history=history||$3::jsonb WHERE tenant_id=$1 AND id=ANY($2::uuid[]) AND proposal_id=$4",
      [
        ctx.tenantId,
        ids,
        entry('SCHEDULED', 'Sessões reservadas na agenda.'),
        proposal.id,
        ctx.userId,
      ],
    );
    if (patientId)
      await c.query(
        'UPDATE referral_plans SET patient_id=$3 WHERE tenant_id=$1 AND id IN(SELECT plan_id FROM referral_items WHERE tenant_id=$1 AND id=ANY($2::uuid[]))',
        [ctx.tenantId, ids, patientId],
      );
  }
}
// O laudo é o pedido médico: a especialidade dos itens entra no cadastro do paciente antes da reserva.
export async function addPlanSpecialties(
  c: import('pg').PoolClient,
  ctx: Context,
  proposal: any,
  patientId: string,
) {
  if (!proposal.referral_item_ids?.length) return;
  const { rows } = await c.query(
    'SELECT DISTINCT p.specialty FROM professionals p WHERE p.tenant_id=$1 AND p.id=ANY($2::uuid[])',
    [ctx.tenantId, proposal.appointments.map((a: any) => a.professional_id)],
  );
  const {
    rows: [pat],
  } = await c.query('SELECT metadata FROM patients WHERE tenant_id=$1 AND id=$2 FOR UPDATE', [
    ctx.tenantId,
    patientId,
  ]);
  const current: string[] = pat?.metadata?.specialties || [],
    added = rows.map((r) => r.specialty).filter((s) => !current.includes(s));
  if (!added.length) return;
  await c.query(
    "UPDATE patients SET metadata=metadata||jsonb_build_object('specialties',$3::jsonb) WHERE tenant_id=$1 AND id=$2",
    [ctx.tenantId, patientId, JSON.stringify([...current, ...added])],
  );
  await audit(
    c,
    ctx,
    'patient.specialties_from_referral',
    'patients',
    patientId,
    proposal.unit_id,
    { added, proposalId: proposal.id },
  );
}
