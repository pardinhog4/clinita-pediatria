'use client';
import { localMinutes, localWeekday, zonedInstant } from '@/lib/timezone';
import { viewTimezone } from '@/lib/view-timezone';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { CalendarDays, Copy, Check, AlertTriangle, Home, Plus, X } from 'lucide-react';
import { post } from '@/lib/client';
import { dayTimes, weekdayNames, clock } from '@/lib/clinic-rules';
import { useClinicRules } from '@/hooks/use-clinic-rules';
import { useNotices } from '@/stores/workspace';
import { Button } from '../atoms/button';
import { Dialog } from '../molecules/dialog';
import { specialtyText } from '../molecules/referral-plan';
type Slot = { starts_at: string; weekday: string; time: string; duration: number };
type Item = {
  item_id: string;
  service_text: string;
  professional_name: string;
  specialty: string;
  location: 'CLINIC' | 'HOME';
  duration: number;
  needed: number;
  slots: Slot[];
  missing: number;
};
type Suggestion = {
  start_date: string;
  duration: number;
  weeks: number;
  items: Item[];
  skipped: { item_id: string; service_text: string; reason: string }[];
};
// Horário editável: dia da semana e minuto do dia; a data real é a primeira desse dia a partir do início.
type Row = {
  key: string;
  item_id: string;
  weekday: number;
  minutes: number;
  duration: number;
  on: boolean;
};
const allDays: [number, string][] = [
  [1, 'Seg'],
  [2, 'Ter'],
  [3, 'Qua'],
  [4, 'Qui'],
  [5, 'Sex'],
  [6, 'Sáb'],
  [0, 'Dom'],
];
const nextMonday = () => {
  const d = new Date();
  d.setDate(d.getDate() + ((8 - d.getDay()) % 7 || 7));
  return d.toLocaleDateString('sv-SE');
};
const firstDate = (start: string, weekday: number) => {
  const d = new Date(start + 'T12:00:00');
  d.setDate(d.getDate() + ((weekday - d.getDay() + 7) % 7));
  return d.toLocaleDateString('sv-SE');
};
const startsAt = (start: string, r: Row) =>
  zonedInstant(firstDate(start, r.weekday), clock(r.minutes), viewTimezone()).toISOString();
const fromSlot = (item: Item, s: Slot): Row => {
  const tz = viewTimezone();
  return {
    key: crypto.randomUUID(),
    item_id: item.item_id,
    weekday: localWeekday(s.starts_at, tz),
    minutes: localMinutes(s.starts_at, tz),
    duration: s.duration,
    on: true,
  };
};
const list = (v: string[]) => (v.length > 1 ? v.slice(0, -1).join(', ') + ' e ' + v.at(-1) : v[0]);
// Monta horários semanais para os itens aceitos de um plano e cria a proposta que segue o fluxo de aceite da família e aprovação.
export function ReferralSchedule({
  planId,
  label,
  notes,
  onClose,
  onDone,
}: {
  planId: string;
  label: string;
  notes: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const add = useNotices((s) => s.add);
  const rules = useClinicRules();
  // Só os dias em que a unidade atende (na clínica ou em domicílio), conforme Configurações.
  const days = allDays.filter(([n]) => rules.business_hours[n] || rules.home_hours[n]);
  const lower = (notes || '').toLowerCase();
  const [prefs, setPrefs] = useState({
    period: lower.includes('manhã') ? 'MORNING' : lower.includes('tarde') ? 'AFTERNOON' : 'ANY',
    weekdays: [1, 2, 3, 4, 5].filter((n) => rules.business_hours[n]),
    start_date: nextMonday(),
    weeks: 4,
    duration: 60,
  });
  const [suggestion, setSuggestion] = useState<Suggestion | null>(null),
    [rows, setRows] = useState<Row[]>([]),
    [conflicts, setConflicts] = useState<Record<string, string>>({}),
    [checking, setChecking] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [created, setCreated] = useState<string | null>(null),
    [copied, setCopied] = useState(false),
    [requestId] = useState(() => crypto.randomUUID());
  const set = (k: string, v: unknown) => {
    setPrefs((p) => ({ ...p, [k]: v }));
    setSuggestion(null);
  };
  const active = useMemo(() => rows.filter((r) => r.on), [rows]);
  const payload = () => ({
    weeks: suggestion!.weeks,
    duration: suggestion!.duration,
    appointments: active.map((r) => ({
      referral_item_id: r.item_id,
      starts_at: startsAt(suggestion!.start_date, r),
      duration: r.duration,
    })),
  });
  async function search() {
    setBusy(true);
    setError('');
    try {
      const r = await post<Suggestion>('referral-plans/' + planId + '/schedule', prefs);
      setSuggestion(r);
      setRows(r.items.flatMap((i) => i.slots.map((s) => fromSlot(i, s))));
      setConflicts({});
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  // Cada edição é conferida no servidor contra a agenda real de todas as semanas.
  useEffect(() => {
    if (!suggestion || !active.length) {
      setConflicts({});
      return;
    }
    let live = true;
    setChecking(true);
    const t = setTimeout(() => {
      post<{ conflicts: { index: number; reason: string }[] }>(
        'referral-plans/' + planId + '/check',
        payload(),
      )
        .then((r) => {
          if (live)
            setConflicts(
              Object.fromEntries(r.conflicts.map((c) => [active[c.index].key, c.reason])),
            );
        })
        .catch((e) => {
          if (live) setError((e as Error).message);
        })
        .finally(() => {
          if (live) setChecking(false);
        });
    }, 250);
    return () => {
      live = false;
      clearTimeout(t);
    }; // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, suggestion]);
  const update = (key: string, patch: Partial<Row>) =>
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const message = () => {
    if (!suggestion) return '';
    const items = suggestion.items
      .map((i) => ({
        ...i,
        rows: active
          .filter((r) => r.item_id === i.item_id)
          .sort((a, b) => a.weekday - b.weekday || a.minutes - b.minutes),
      }))
      .filter((i) => i.rows.length);
    if (!items.length) return '';
    const first = active
      .map((r) => firstDate(suggestion.start_date, r.weekday))
      .sort()[0]
      .split('-')
      .reverse()
      .slice(0, 2)
      .join('/');
    return `Olá! Separamos estes horários${label ? ' para ' + label.split(' ')[0] : ''}, toda semana, a partir de ${first}:\n${items
      .map((i) => {
        const name = specialtyText([i.specialty]) + (i.location === 'HOME' ? ' em casa' : ''),
          span = (r: Row) =>
            i.location === 'HOME'
              ? `das ${clock(r.minutes)} às ${clock(r.minutes + r.duration)}`
              : `às ${clock(r.minutes)}`,
          same = new Set(i.rows.map(span)).size === 1;
        return (
          '• ' +
          name +
          ': ' +
          (same
            ? list(i.rows.map((r) => weekdayNames[r.weekday])) + ', ' + span(i.rows[0])
            : list(i.rows.map((r) => weekdayNames[r.weekday] + ' ' + span(r))))
        );
      })
      .join('\n')}\nEsses horários funcionam para vocês?`;
  };
  async function create() {
    if (!suggestion) return;
    setBusy(true);
    setError('');
    try {
      await post('referral-plans/' + planId + '/proposal', { request_id: requestId, ...payload() });
      setCreated(message());
      add('Proposta de horários criada. Falta o aceite da família.');
      onDone();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (created !== null)
    return (
      <Dialog title="Proposta criada" onClose={onClose}>
        <div className="form">
          <p className="muted">
            Os horários <strong>não estão reservados</strong>. Envie a mensagem para a família; com
            o aceite, registre e aprove em Encaminhamentos para as sessões entrarem na agenda.
          </p>
          <pre className="schedule-message">{created}</pre>
          <div className="form-footer">
            <Link className="button secondary" href="/atendimento#propostas">
              Abrir propostas
            </Link>
            <Button
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(created);
                  setCopied(true);
                } catch {
                  setError('Não foi possível copiar. Selecione o texto e copie manualmente.');
                }
              }}
            >
              {copied ? <Check size={15} /> : <Copy size={15} />}
              {copied ? 'Copiado' : 'Copiar mensagem'}
            </Button>
          </div>
          {error && <p className="field-error">{error}</p>}
        </div>
      </Dialog>
    );
  const blocked = Object.keys(conflicts).length > 0;
  return (
    <Dialog
      title="Montar horários"
      onClose={() => {
        if (!busy) onClose();
      }}
      wide
    >
      <div className="form schedule-form">
        <p className="muted">
          {label} · horários semanais para os serviços aceitos, sem conflito de agenda, sala ou do
          próprio paciente.
        </p>
        <div className="schedule-prefs">
          <div className="field">
            <span>Período</span>
            <div className="segmented" role="group" aria-label="Período">
              {[
                ['MORNING', 'Manhã'],
                ['AFTERNOON', 'Tarde'],
                ['ANY', 'Qualquer'],
              ].map(([k, l]) => (
                <Button
                  key={k}
                  type="button"
                  variant={prefs.period === k ? 'primary' : 'ghost'}
                  aria-pressed={prefs.period === k}
                  onClick={() => set('period', k)}
                >
                  {l}
                </Button>
              ))}
            </div>
          </div>
          <div className="field">
            <span>Dias</span>
            <div className="segmented" role="group" aria-label="Dias da semana">
              {days.map(([n, l]) => (
                <Button
                  key={n}
                  type="button"
                  variant={prefs.weekdays.includes(n) ? 'primary' : 'ghost'}
                  aria-pressed={prefs.weekdays.includes(n)}
                  onClick={() =>
                    set(
                      'weekdays',
                      prefs.weekdays.includes(n)
                        ? prefs.weekdays.filter((x) => x !== n)
                        : [...prefs.weekdays, n].sort(),
                    )
                  }
                >
                  {l}
                </Button>
              ))}
            </div>
          </div>
          <label className="field">
            Início
            <input
              className="input"
              type="date"
              value={prefs.start_date}
              min={new Date().toLocaleDateString('sv-SE')}
              onChange={(e) => set('start_date', e.target.value)}
            />
          </label>
          <label className="field">
            Repetir por
            <select
              className="input"
              value={prefs.weeks}
              onChange={(e) => set('weeks', Number(e.target.value))}
            >
              {[1, 2, 4, 8, 12].map((n) => (
                <option key={n} value={n}>
                  {n} {n === 1 ? 'semana' : 'semanas'}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            Sessão na clínica
            <select
              className="input"
              value={prefs.duration}
              onChange={(e) => set('duration', Number(e.target.value))}
            >
              <option value={60}>60 min</option>
              <option value={30}>30 min</option>
            </select>
          </label>
        </div>
        {!suggestion && (
          <div className="form-footer">
            <small className="muted">
              A duração precisa seguir o contrato do convênio do paciente. Em domicílio, blocos de
              até {rules.max_home_duration / 60} h.
            </small>
            <Button
              type="button"
              disabled={busy || !prefs.weekdays.length || !prefs.start_date}
              onClick={() => void search()}
            >
              <CalendarDays size={15} />
              {busy ? 'Buscando…' : 'Buscar horários'}
            </Button>
          </div>
        )}
        {suggestion && (
          <>
            <ul className="schedule-items">
              {suggestion.items.map((i) => {
                const mine = rows.filter((r) => r.item_id === i.item_id),
                  on = mine.filter((r) => r.on).length,
                  home = i.location === 'HOME';
                return (
                  <li key={i.item_id}>
                    <div className="schedule-item-head">
                      <div>
                        <strong>
                          {specialtyText([i.specialty])} · {i.professional_name}
                          {home && (
                            <span className="tag">
                              <Home size={11} />
                              &nbsp;Domicílio
                            </span>
                          )}
                        </strong>
                        <small>{i.service_text}</small>
                      </div>
                      <span className={'tag' + (on < i.needed ? ' warn' : '')}>
                        {on} de {i.needed} por semana
                        {home ? ` · blocos de ${i.duration / 60} h` : ''}
                      </span>
                    </div>
                    <div className="schedule-rows">
                      {mine.map((r) => {
                        const times = dayTimes(rules, r.weekday, r.duration, 'ANY', home),
                          reason = r.on ? conflicts[r.key] : undefined;
                        return (
                          <div
                            key={r.key}
                            className={
                              'schedule-row' + (r.on ? '' : ' off') + (reason ? ' bad' : '')
                            }
                          >
                            <input
                              type="checkbox"
                              aria-label="Incluir horário"
                              checked={r.on}
                              onChange={(e) => update(r.key, { on: e.target.checked })}
                            />
                            <select
                              className="input"
                              aria-label="Dia da semana"
                              value={r.weekday}
                              disabled={!r.on}
                              onChange={(e) => {
                                const w = Number(e.target.value),
                                  t = dayTimes(rules, w, r.duration, 'ANY', home);
                                update(r.key, {
                                  weekday: w,
                                  minutes: t.includes(r.minutes) ? r.minutes : t[0],
                                });
                              }}
                            >
                              {days.map(([n]) => (
                                <option key={n} value={n}>
                                  {weekdayNames[n]}
                                </option>
                              ))}
                            </select>
                            <select
                              className="input"
                              aria-label="Horário"
                              value={r.minutes}
                              disabled={!r.on}
                              onChange={(e) => update(r.key, { minutes: Number(e.target.value) })}
                            >
                              {times.map((m) => (
                                <option key={m} value={m}>
                                  {home ? `${clock(m)}–${clock(m + r.duration)}` : clock(m)}
                                </option>
                              ))}
                            </select>
                            <small>
                              desde{' '}
                              {firstDate(suggestion.start_date, r.weekday)
                                .split('-')
                                .reverse()
                                .slice(0, 2)
                                .join('/')}
                            </small>
                            <Button
                              type="button"
                              variant="ghost"
                              aria-label="Remover horário"
                              onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}
                            >
                              <X size={14} />
                            </Button>
                            {reason && (
                              <p className="schedule-conflict">
                                <AlertTriangle size={13} />
                                {reason}
                              </p>
                            )}
                          </div>
                        );
                      })}
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      className="schedule-add"
                      onClick={() => {
                        const used = mine.map((r) => r.weekday),
                          w =
                            prefs.weekdays.find((x) => !used.includes(x)) || prefs.weekdays[0] || 1,
                          t = dayTimes(rules, w, i.duration, prefs.period as 'ANY', home);
                        setRows((rs) => [
                          ...rs,
                          {
                            key: crypto.randomUUID(),
                            item_id: i.item_id,
                            weekday: w,
                            minutes: t[0] ?? dayTimes(rules, w, i.duration, 'ANY', home)[0],
                            duration: i.duration,
                            on: true,
                          },
                        ]);
                      }}
                    >
                      <Plus size={14} />
                      Adicionar horário
                    </Button>
                    {i.missing > 0 && on < i.needed && (
                      <p className="schedule-missing">
                        <AlertTriangle size={13} />
                        {i.slots.length
                          ? `A busca achou ${i.slots.length} de ${i.needed} sessões semanais. Adicione um horário à mão ou amplie dias e período.`
                          : 'Sem horário livre com estas preferências. Adicione um horário à mão ou amplie dias e período.'}
                      </p>
                    )}
                  </li>
                );
              })}
              {suggestion.skipped.map((s) => (
                <li key={s.item_id} className="schedule-skipped">
                  <AlertTriangle size={14} />
                  <div>
                    <strong>{s.service_text}</strong>
                    <small>{s.reason}</small>
                  </div>
                </li>
              ))}
            </ul>
            {error && <p className="field-error">{error}</p>}
            <div className="form-footer">
              <Button
                type="button"
                variant="secondary"
                disabled={busy}
                onClick={() => setSuggestion(null)}
              >
                Mudar preferências
              </Button>
              <Button
                type="button"
                disabled={busy || checking || blocked || !active.length}
                onClick={() => void create()}
              >
                {busy
                  ? 'Criando…'
                  : checking
                    ? 'Conferindo agenda…'
                    : blocked
                      ? 'Resolva os conflitos'
                      : `Criar proposta · ${active.length} ${active.length === 1 ? 'horário semanal' : 'horários semanais'}`}
              </Button>
            </div>
          </>
        )}
        {!suggestion && error && <p className="field-error">{error}</p>}
      </div>
    </Dialog>
  );
}
