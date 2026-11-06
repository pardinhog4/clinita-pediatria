'use client';
import { weekdayNames, type WorkHours } from '@/lib/clinic-rules';

// Horário próprio por dia da semana (ex.: profissional que só atende das 13h às 18h na terça).
// Dia sem horário próprio segue o expediente da unidade.

const order = [1, 2, 3, 4, 5, 6, 0];

export function WeekHoursInput({
  id,
  value,
  onChange,
}: {
  id: string;
  value: WorkHours | undefined;
  onChange: (value: WorkHours | undefined) => void;
}) {
  const current = value || {};
  function set(day: number, hours: { start: string; end: string } | null) {
    const next: WorkHours = { ...current };
    if (hours) next[String(day)] = hours;
    else delete next[String(day)];
    onChange(Object.keys(next).length ? next : undefined);
  }
  return (
    <div className="week-hours" id={id}>
      {order.map((day) => {
        const h = current[String(day)];
        return (
          <div className="week-hours-row" key={day}>
            <label>
              <input
                type="checkbox"
                checked={!!h}
                onChange={(e) =>
                  set(day, e.target.checked ? { start: '08:00', end: '18:00' } : null)
                }
              />
              {weekdayNames[day]}
            </label>
            {h ? (
              <>
                <input
                  type="time"
                  className="input"
                  aria-label={'Início · ' + weekdayNames[day]}
                  step={300}
                  value={h.start}
                  onChange={(e) => set(day, { ...h, start: e.target.value })}
                />
                <span className="muted">às</span>
                <input
                  type="time"
                  className="input"
                  aria-label={'Fim · ' + weekdayNames[day]}
                  step={300}
                  value={h.end}
                  onChange={(e) => set(day, { ...h, end: e.target.value })}
                />
              </>
            ) : (
              <small className="muted">Expediente da unidade</small>
            )}
          </div>
        );
      })}
    </div>
  );
}
