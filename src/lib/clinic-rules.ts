import { z } from 'zod';
import { DEFAULT_TIMEZONE, timezoneIds } from './timezone';

// Regras operacionais configuráveis da clínica (Configurações → Horários e regras).
// Ficam em clinic_settings.value.rules; cada unidade pode ter o próprio horário de funcionamento
// (units.business_hours). Este arquivo é usado pelo servidor e pelas telas, para que a grade
// mostrada seja exatamente a validada.

const time = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use o formato HH:MM.')
  .refine((v) => Number(v.slice(3)) % 5 === 0, 'Use minutos múltiplos de 5.');

const dayHoursSchema = z
  .object({
    open: time,
    close: time,
    break_start: time.nullish(),
    break_end: time.nullish(),
  })
  .strict()
  .superRefine((d, ctx) => {
    if (minutes(d.close) <= minutes(d.open))
      ctx.addIssue({ code: 'custom', message: 'O fechamento precisa ser depois da abertura.' });
    if (!!d.break_start !== !!d.break_end)
      ctx.addIssue({ code: 'custom', message: 'Informe início e fim do intervalo.' });
    if (
      d.break_start &&
      d.break_end &&
      (minutes(d.break_start) <= minutes(d.open) ||
        minutes(d.break_end) >= minutes(d.close) ||
        minutes(d.break_end) <= minutes(d.break_start))
    )
      ctx.addIssue({ code: 'custom', message: 'O intervalo precisa ficar dentro do expediente.' });
  });

/** Domingo (0) a sábado (6). null = fechado. */
export const weekHoursSchema = z.array(dayHoursSchema.nullable()).length(7);

export const clinicRulesSchema = z
  .object({
    business_hours: weekHoursSchema,
    home_hours: weekHoursSchema,
    slot_minutes: z.union([z.literal(15), z.literal(30), z.literal(60)]),
    max_clinic_duration: z.number().int().min(15).max(480),
    max_home_duration: z.number().int().min(30).max(480),
    early_start_minutes: z.number().int().min(0).max(120),
    payout_closing_day: z.number().int().min(1).max(28),
    payout_due_day: z.number().int().min(1).max(28),
    half_session_minutes: z.number().int().min(15).max(60),
    signature_link_hours: z.number().int().min(1).max(720),
    upload_max_pages: z.number().int().min(1).max(100),
    /** Tamanho máximo por anexo, até o teto do banco (UPLOAD_CEILING_MB). */
    upload_max_mb: z.number().int().min(1).max(10),
    /** Painel: "chegando agora" = sessões que começam nos próximos N minutos. */
    arrival_window_minutes: z.number().int().min(15).max(240),
    /** Painel: conversa aguardando há mais de N minutos conta como atrasada. */
    inbox_overdue_minutes: z.number().int().min(10).max(1440),
    /** Fuso padrão da clínica; cada unidade pode ter o seu (units.timezone). */
    timezone: z.enum(timezoneIds),
  })
  .strict();

export type DayHours = z.infer<typeof dayHoursSchema>;
export type WeekHours = (DayHours | null)[];
export type ClinicRules = z.infer<typeof clinicRulesSchema>;
/** Horário de trabalho do profissional por dia (professionals.metadata.work_hours). */
export type WorkHours = Partial<Record<string, { start: string; end: string }>>;

const weekday = { open: '08:00', close: '18:00', break_start: '12:00', break_end: '13:00' };
const home = { open: '07:00', close: '20:00' };

/** Valores iniciais: os mesmos que estavam fixos no código antes da Fase 2. */
export const defaultRules: ClinicRules = {
  business_hours: [
    null,
    weekday,
    weekday,
    weekday,
    weekday,
    weekday,
    { open: '08:00', close: '12:00' },
  ],
  home_hours: [null, home, home, home, home, home, home],
  slot_minutes: 30,
  max_clinic_duration: 180,
  max_home_duration: 240,
  early_start_minutes: 15,
  payout_closing_day: 20,
  payout_due_day: 20,
  half_session_minutes: 30,
  signature_link_hours: 24,
  upload_max_pages: 20,
  upload_max_mb: 2,
  arrival_window_minutes: 75,
  inbox_overdue_minutes: 60,
  timezone: DEFAULT_TIMEZONE,
};

export const workHoursSchema = z
  .record(
    z.string().regex(/^[0-6]$/),
    z
      .object({ start: time, end: time })
      .strict()
      .refine((h) => minutes(h.end) > minutes(h.start), 'O fim precisa ser depois do início.'),
  )
  .optional();

export function minutes(hhmm: string) {
  return Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
}
export const clock = (m: number) =>
  String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
export const weekdayNames = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];

/** Junta o que está salvo com os valores iniciais; o que estiver inválido volta ao valor inicial. */
export function resolveRules(
  stored?: unknown,
  unitHours?: unknown,
  unitTimezone?: unknown,
): ClinicRules {
  const base = { ...defaultRules };
  if (stored && typeof stored === 'object')
    for (const [key, value] of Object.entries(stored)) {
      const field = clinicRulesSchema.shape[key as keyof ClinicRules];
      if (field?.safeParse(value).success) (base as Record<string, unknown>)[key] = value;
    }
  const unit = weekHoursSchema.safeParse(unitHours);
  if (unit.success) base.business_hours = unit.data;
  const tz = clinicRulesSchema.shape.timezone.safeParse(unitTimezone);
  if (tz.success) base.timezone = tz.data;
  return base;
}

type Window = { open: number; close: number; breakStart: number | null; breakEnd: number | null };

/** Janela do dia (clínica ou domicílio), recortada pelo horário do profissional quando houver. */
export function dayWindow(
  rules: ClinicRules,
  day: number,
  isHome = false,
  workHours?: WorkHours | null,
): Window | null {
  const h = (isHome ? rules.home_hours : rules.business_hours)[day];
  if (!h) return null;
  let open = minutes(h.open),
    close = minutes(h.close);
  const own = workHours?.[String(day)];
  if (own) {
    open = Math.max(open, minutes(own.start));
    close = Math.min(close, minutes(own.end));
  }
  if (close <= open) return null;
  return {
    open,
    close,
    breakStart: h.break_start ? minutes(h.break_start) : null,
    breakEnd: h.break_end ? minutes(h.break_end) : null,
  };
}

/** O atendimento cabe no expediente do dia, sem invadir o intervalo? */
export function fitsDay(
  rules: ClinicRules,
  day: number,
  start: number,
  duration: number,
  isHome = false,
  workHours?: WorkHours | null,
) {
  const w = dayWindow(rules, day, isHome, workHours);
  if (!w || start < w.open || start + duration > w.close) return false;
  return !(w.breakStart !== null && start < w.breakEnd! && start + duration > w.breakStart);
}

export type Period = 'MORNING' | 'AFTERNOON' | 'ANY';

/** Horários de início possíveis no dia, na grade configurada (ex.: de 30 em 30 min). */
export function dayTimes(
  rules: ClinicRules,
  day: number,
  duration: number,
  period: Period = 'ANY',
  isHome = false,
  workHours?: WorkHours | null,
) {
  const w = dayWindow(rules, day, isHome, workHours);
  if (!w) return [];
  const noon = w.breakStart ?? 720,
    afternoon = w.breakEnd ?? 780;
  const first = Math.ceil(w.open / rules.slot_minutes) * rules.slot_minutes;
  const times: number[] = [];
  for (let m = first; m + duration <= w.close; m += rules.slot_minutes)
    if (
      fitsDay(rules, day, m, duration, isHome, workHours) &&
      (period === 'ANY' ||
        (period === 'MORNING' && m + duration <= noon) ||
        (period === 'AFTERNOON' && m >= afternoon))
    )
      times.push(m);
  return times;
}

/** Linhas da grade do dia (todas as faixas do expediente, inclusive o intervalo). */
export function dayRows(rules: ClinicRules, day: number) {
  const w = dayWindow(rules, day);
  if (!w) return [];
  const rows: number[] = [];
  const first = Math.floor(w.open / rules.slot_minutes) * rules.slot_minutes;
  for (let m = first; m < w.close; m += rules.slot_minutes) rows.push(m);
  return rows;
}

/** Faixa dentro do intervalo do dia (almoço)? */
export function inBreak(rules: ClinicRules, day: number, m: number) {
  const w = dayWindow(rules, day);
  return !!w && w.breakStart !== null && m >= w.breakStart && m < w.breakEnd!;
}

/** Minutos de atendimento disponíveis no dia (expediente menos intervalo). */
export function dayCapacity(rules: ClinicRules, day: number) {
  const w = dayWindow(rules, day);
  if (!w) return 0;
  return w.close - w.open - (w.breakStart !== null ? w.breakEnd! - w.breakStart : 0);
}

export function hoursLabel(h: DayHours | null | undefined) {
  if (!h) return 'fechado';
  return (
    h.open +
    '–' +
    h.close +
    (h.break_start && h.break_end ? ` (intervalo ${h.break_start}–${h.break_end})` : '')
  );
}

/** Mensagem para um horário fora do expediente. */
export function outsideHoursMessage(rules: ClinicRules, day: number, isHome = false) {
  const h = (isHome ? rules.home_hours : rules.business_hours)[day];
  const place = isHome ? 'Atendimento em domicílio' : 'Atendimento na clínica';
  return h
    ? `${place} na ${weekdayNames[day]}: ${hoursLabel(h)}. Escolha um horário dentro desse período.`
    : `${place} não acontece no(a) ${weekdayNames[day]}.`;
}

/**
 * Período de repasse do mês: do dia seguinte ao fechamento do mês anterior até o fechamento deste
 * mês (ex.: fechamento 20 → de 21/10 a 20/11).
 */
export function payoutPeriod(rules: ClinicRules, today = new Date()) {
  const close = rules.payout_closing_day;
  const end = new Date(today.getFullYear(), today.getMonth(), close);
  const start = new Date(today.getFullYear(), today.getMonth() - 1, close + 1);
  const iso = (d: Date) => d.toLocaleDateString('sv-SE');
  return { from: iso(start), to: iso(end) };
}

/** Sessões por semana para cumprir as horas pedidas (no máximo uma por dia escolhido). */
export function sessionsPerWeek(weeklyHours: number | null, duration: number, maxDays: number) {
  return Math.max(
    1,
    Math.min(maxDays, 7, weeklyHours === null ? 1 : Math.round((weeklyHours * 60) / duration)),
  );
}

/** Domicílio em blocos de até max_home_duration (ex.: 20 h/semana viram 5 blocos de 4 h). */
export function homeBlocks(rules: ClinicRules, weeklyHours: number | null, maxDays: number) {
  const hours = weeklyHours || 1,
    blockHours = rules.max_home_duration / 60,
    step = rules.slot_minutes,
    needed = Math.max(1, Math.min(maxDays, Math.ceil(hours / blockHours)));
  return {
    needed,
    minutes: Math.max(
      Math.max(60, step),
      Math.min(rules.max_home_duration, Math.round((hours * 60) / needed / step) * step),
    ),
  };
}

/** Teto fixo de tamanho por anexo garantido pelo banco (migração 026). */
export const UPLOAD_CEILING_MB = 10;
export const megabytes = (mb: number) => mb * 1048576;
