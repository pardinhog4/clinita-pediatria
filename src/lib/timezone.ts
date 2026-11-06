// Datas e horas no fuso da unidade (ex.: Manaus é UTC−4, Brasília é UTC−3).
// O banco guarda instantes (timestamptz); a conversão para "dia e hora locais" sempre passa por aqui,
// com o fuso explícito. Usa Intl, então horário de verão e mudanças de regra são respeitados.

export const DEFAULT_TIMEZONE = 'America/Sao_Paulo';

/** Fusos do Brasil oferecidos na configuração da unidade. */
export const brazilTimezones: { id: string; label: string }[] = [
  { id: 'America/Sao_Paulo', label: 'Brasília · SP, RJ, MG, Sul, GO, DF (UTC−3)' },
  { id: 'America/Bahia', label: 'Bahia (UTC−3)' },
  { id: 'America/Fortaleza', label: 'CE, RN, PB, PI, MA (UTC−3)' },
  { id: 'America/Recife', label: 'Pernambuco (UTC−3)' },
  { id: 'America/Maceio', label: 'Alagoas e Sergipe (UTC−3)' },
  { id: 'America/Belem', label: 'Pará e Amapá (UTC−3)' },
  { id: 'America/Araguaina', label: 'Tocantins (UTC−3)' },
  { id: 'America/Manaus', label: 'Amazonas · Manaus (UTC−4)' },
  { id: 'America/Cuiaba', label: 'Mato Grosso (UTC−4)' },
  { id: 'America/Campo_Grande', label: 'Mato Grosso do Sul (UTC−4)' },
  { id: 'America/Porto_Velho', label: 'Rondônia (UTC−4)' },
  { id: 'America/Boa_Vista', label: 'Roraima (UTC−4)' },
  { id: 'America/Rio_Branco', label: 'Acre (UTC−5)' },
  { id: 'America/Noronha', label: 'Fernando de Noronha (UTC−2)' },
];
export const timezoneIds = brazilTimezones.map((t) => t.id) as [string, ...string[]];

type Instant = Date | string | number;
const toDate = (d: Instant) => (d instanceof Date ? d : new Date(d));

const formatters = new Map<string, Intl.DateTimeFormat>();
function parts(d: Instant, tz: string) {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      weekday: 'short',
      hourCycle: 'h23',
    });
    formatters.set(tz, f);
  }
  const out: Record<string, string> = {};
  for (const p of f.formatToParts(toDate(d))) out[p.type] = p.value;
  return out;
}

const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Dia local (AAAA-MM-DD) do instante no fuso. */
export function localDate(d: Instant, tz: string) {
  const p = parts(d, tz);
  return `${p.year}-${p.month}-${p.day}`;
}
/** Hora local (HH:MM) do instante no fuso. */
export function localTime(d: Instant, tz: string) {
  const p = parts(d, tz);
  return `${p.hour}:${p.minute}`;
}
/** Minutos desde a meia-noite local. */
export function localMinutes(d: Instant, tz: string) {
  const p = parts(d, tz);
  return Number(p.hour) * 60 + Number(p.minute);
}
/** Dia da semana local (0 = domingo). */
export function localWeekday(d: Instant, tz: string) {
  return weekdays.indexOf(parts(d, tz).weekday);
}
/** Dia da semana de uma data de calendário (AAAA-MM-DD), sem depender de fuso. */
export function weekdayOf(date: string) {
  return new Date(date + 'T12:00:00Z').getUTCDay();
}
/** Soma dias a uma data de calendário. */
export function addDaysTo(date: string, n: number) {
  const d = new Date(date + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Diferença (min) entre o relógio local do fuso e UTC naquele instante. Ex.: Brasília = −180. */
export function offsetMinutes(d: Instant, tz: string) {
  const p = parts(d, tz);
  const asUtc = Date.UTC(
    Number(p.year),
    Number(p.month) - 1,
    Number(p.day),
    Number(p.hour),
    Number(p.minute),
    Number(p.second),
  );
  const ms = toDate(d).getTime();
  return Math.round((asUtc - (ms - (ms % 1000))) / 60000);
}

/** Instante correspondente a uma data e hora locais no fuso ("2026-11-10", "09:30"). */
export function zonedInstant(date: string, time: string, tz: string) {
  const naive = Date.parse(`${date}T${time.length === 5 ? time + ':00' : time}Z`);
  // Duas passadas resolvem a virada de horário de verão.
  let ms = naive - offsetMinutes(naive, tz) * 60000;
  ms = naive - offsetMinutes(ms, tz) * 60000;
  return new Date(ms);
}
/** Valor de um campo datetime-local ("AAAA-MM-DDTHH:MM") interpretado no fuso. */
export function fromLocalInput(value: string, tz: string) {
  return zonedInstant(value.slice(0, 10), value.slice(11, 16), tz);
}
/** Instante formatado para um campo datetime-local no fuso. */
export function toLocalInput(d: Instant, tz: string) {
  return localDate(d, tz) + 'T' + localTime(d, tz);
}
/** "UTC−3", "UTC−4"… para rótulos. */
export function offsetLabel(tz: string, at: Instant = Date.now()) {
  const m = offsetMinutes(at, tz),
    h = Math.abs(m) / 60;
  return 'UTC' + (m < 0 ? '−' : '+') + (Number.isInteger(h) ? h : h.toFixed(1));
}

/** "10/11/2026, 09:30" no fuso (para mensagens às famílias e à equipe). */
export function formatDateTime(d: Instant, tz: string) {
  return toDate(d).toLocaleString('pt-BR', {
    timeZone: tz,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
