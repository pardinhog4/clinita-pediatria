'use client';
import { weekdayOf, zonedInstant } from '@/lib/timezone';
import { viewTimezone } from '@/lib/view-timezone';
import { useEffect, useState } from 'react';
import { addDays, startOfWeek, startOfMonth, addMonths, format } from 'date-fns';
import { api, fetchAll } from '@/lib/client';
import { labels, specialtyOptions, specialtyCode } from '@/lib/schemas';
import { dateLabel, timeLabel, type Entity } from '@/lib/types';
import { Button } from '../atoms/button';
import { Badge } from '../atoms/badge';
import { clock, dayRows, dayTimes, fitsDay, inBreak } from '@/lib/clinic-rules';
import { useClinicRules } from '@/hooks/use-clinic-rules';
export function AgendaBoard({
  unitId,
  mode,
  refreshKey,
  onOpen,
  onBook,
}: {
  unitId: string;
  mode: 'day' | 'week' | 'month';
  refreshKey: number;
  onOpen: (a: Entity) => void;
  onBook: (preset: Record<string, any>) => void;
}) {
  const rules = useClinicRules(unitId);
  const [date, setDate] = useState(
      new Date().toLocaleDateString('sv-SE', { timeZone: viewTimezone() }),
    ),
    [events, setEvents] = useState<Entity[]>([]),
    [professionals, setProfessionals] = useState<Entity[]>([]),
    [rooms, setRooms] = useState<Entity[]>([]),
    [professional, setProfessional] = useState(''),
    [room, setRoom] = useState(''),
    [specialty, setSpecialty] = useState(''),
    [status, setStatus] = useState(''),
    [error, setError] = useState(''),
    [loading, setLoading] = useState(false);
  const anchor = new Date(date + 'T12:00:00'),
    start =
      mode === 'day'
        ? anchor
        : mode === 'week'
          ? startOfWeek(anchor, { weekStartsOn: 1 })
          : startOfWeek(startOfMonth(anchor), { weekStartsOn: 1 }),
    days = Array.from({ length: mode === 'day' ? 1 : mode === 'week' ? 7 : 42 }, (_, i) =>
      addDays(start, i),
    );
  useEffect(() => {
    Promise.all([
      fetchAll<Entity>('professionals?unit=' + unitId),
      fetchAll<Entity>('rooms?unit=' + unitId),
    ])
      .then(([p, r]) => {
        setProfessionals(p.data.filter((p) => p.active));
        setRooms(r.data);
      })
      .catch((e) => setError(e.message));
  }, [unitId]);
  useEffect(() => {
    let active = true;
    setLoading(true);
    const params = new URLSearchParams({
      unit: unitId,
      from: format(start, 'yyyy-MM-dd'),
      to: format(days.at(-1)!, 'yyyy-MM-dd'),
      limit: '500',
      ...(professional ? { professional_id: professional } : {}),
      ...(room ? { room_id: room } : {}),
      ...(specialty ? { specialty } : {}),
      ...(status ? { status } : {}),
    });
    api<{ data: Entity[]; total: number }>('appointments?' + params)
      .then((r) => {
        if (active) {
          setEvents(r.data);
          setError(
            r.total > 500
              ? 'Há mais de 500 sessões neste intervalo. Refine os filtros para consultar a grade.'
              : '',
          );
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [unitId, date, mode, professional, room, specialty, status, refreshKey]);
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    if (/^\d{4}-\d{2}-\d{2}$/.test(q.get('date') || '')) setDate(q.get('date')!);
  }, []);
  function bookable(p: Entity, ds: string, time: string) {
    const at = zonedInstant(ds, time, viewTimezone()),
      day = weekdayOf(ds),
      min = Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
    // Expediente da unidade e horário do profissional, conforme Configurações → Horários e regras.
    return (
      at > new Date() &&
      (!p.metadata?.work_days?.length || p.metadata.work_days.map(Number).includes(day)) &&
      fitsDay(rules, day, min, rules.slot_minutes, false, p.metadata?.work_hours)
    );
  }
  /** Primeiro horário livre do dia na grade, para o atalho "Vago · agendar" da semana. */
  function firstTime(p: Entity, ds: string) {
    const day = weekdayOf(ds);
    const first = dayTimes(rules, day, rules.slot_minutes, 'ANY', false, p.metadata?.work_hours)[0];
    return first === undefined ? null : clock(first);
  }
  const visible = professionals.filter(
    (p) =>
      (!professional || p.id === professional) &&
      (!room || p.room_id === room) &&
      (!specialty || p.specialty === specialty),
  );
  function go(delta: number) {
    setDate(
      format(
        mode === 'month'
          ? addMonths(anchor, delta)
          : addDays(anchor, delta * (mode === 'week' ? 7 : 1)),
        'yyyy-MM-dd',
      ),
    );
  }
  const event = (a: Entity) => (
    <button
      key={a.id}
      className={'panorama-event status-' + a.status.toLowerCase()}
      onClick={() => onOpen(a)}
    >
      <strong>
        {timeLabel(a.starts_at)} · {a.patient_name}
      </strong>
      <small>{a.professional_name}</small>
      <span>
        <Badge value={a.status} />
      </span>
      <div className="evidence-dots">
        <span title="Chegada" className={a.arrived_at ? 'ok' : 'pending'}>
          C
        </span>
        <span
          title="Autorização"
          className={a.authorization_status === 'MANUAL' || a.signature_evidence ? 'ok' : 'pending'}
        >
          A
        </span>
        <span title="Evolução" className={a.status === 'COMPLETED' ? 'ok' : 'pending'}>
          E
        </span>
      </div>
    </button>
  );
  return (
    <>
      <div className="toolbar wrap">
        <div className="actions wrap">
          <Button variant="secondary" onClick={() => go(-1)}>
            ← Anterior
          </Button>
          <label className="field">
            Data da agenda
            <input
              className="input"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </label>
          <Button variant="secondary" onClick={() => go(1)}>
            Próxima →
          </Button>
          <Button
            variant="ghost"
            onClick={() =>
              setDate(new Date().toLocaleDateString('sv-SE', { timeZone: viewTimezone() }))
            }
          >
            Hoje
          </Button>
        </div>
        <small>{events.length} atendimentos no período</small>
      </div>
      <div className="operational-filters">
        <label className="field">
          Profissional
          <select
            className="input"
            value={professional}
            onChange={(e) => setProfessional(e.target.value)}
          >
            <option value="">Todos os profissionais</option>
            {professionals.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Sala
          <select className="input" value={room} onChange={(e) => setRoom(e.target.value)}>
            <option value="">Todas as salas</option>
            {rooms.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Especialidade
          <select
            className="input"
            value={specialty}
            onChange={(e) => setSpecialty(e.target.value)}
          >
            <option value="">Todas as áreas</option>
            {specialtyOptions().map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Situação
          <select className="input" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">Todas as situações</option>
            <option value="SCHEDULED">Agendados</option>
            <option value="ARRIVED">Na recepção</option>
            <option value="IN_PROGRESS">Em atendimento</option>
            <option value="COMPLETED">Realizados</option>
            <option value="ABSENT">Faltas</option>
            <option value="CANCELLED">Cancelados</option>
          </select>
        </label>
      </div>
      {error && <p className="error-banner">{error}</p>}
      {loading && <p className="loading">Atualizando grade…</p>}
      {mode === 'month' ? (
        <div className="calendar-scroll">
          <div className="calendar">
            {['SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SÁB', 'DOM'].map((d) => (
              <div className="calendar-day-label" key={d}>
                {d}
              </div>
            ))}
            {days.map((day) => {
              const items = events.filter(
                (a) =>
                  new Date(a.starts_at).toLocaleDateString('sv-SE', {
                    timeZone: viewTimezone(),
                  }) === format(day, 'yyyy-MM-dd'),
              );
              return (
                <div className="calendar-day" key={day.toISOString()}>
                  <div className="actions between">
                    <strong>{day.getDate()}</strong>
                    <small>{items.length} sessões</small>
                  </div>
                  {items.map(event)}
                </div>
              );
            })}
          </div>
        </div>
      ) : mode === 'week' ? (
        <div className="panorama-scroll">
          <table className="panorama-table">
            <thead>
              <tr>
                <th>Profissional / sala</th>
                {days.map((d) => (
                  <th key={d.toISOString()}>
                    {d.toLocaleDateString('pt-BR', {
                      weekday: 'short',
                      day: '2-digit',
                      month: '2-digit',
                    })}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visible.map((p) => (
                <tr key={p.id}>
                  <th>
                    <strong>{p.name}</strong>
                    <small>
                      {labels[p.specialty]} · {rooms.find((r) => r.id === p.room_id)?.name}
                    </small>
                  </th>
                  {days.map((d) => {
                    const ds = format(d, 'yyyy-MM-dd'),
                      items = events.filter(
                        (a) =>
                          a.professional_id === p.id &&
                          new Date(a.starts_at).toLocaleDateString('sv-SE', {
                            timeZone: viewTimezone(),
                          }) === ds,
                      );
                    return (
                      <td key={ds}>
                        {items.map(event)}
                        {!items.length && (
                          <button
                            className="panorama-free"
                            disabled={!firstTime(p, ds) || !bookable(p, ds, firstTime(p, ds)!)}
                            onClick={() =>
                              onBook({
                                professional_id: p.id,
                                local_start: ds + 'T' + firstTime(p, ds),
                              })
                            }
                          >
                            Vago · agendar
                          </button>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          {!visible.length && <p className="empty">Nenhum profissional corresponde aos filtros.</p>}
        </div>
      ) : (
        <div className="panorama-scroll">
          <table className="panorama-table day">
            <thead>
              <tr>
                <th>Horário</th>
                {visible.map((p) => (
                  <th key={p.id}>
                    {p.name}
                    <small>
                      {labels[p.specialty]} · {rooms.find((r) => r.id === p.room_id)?.name}
                    </small>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {dayRows(rules, weekdayOf(date)).map((min) => {
                const time = clock(min);
                return (
                  <tr key={min}>
                    <th>{time}</th>
                    {visible.map((p) => {
                      const items = events.filter((a) => {
                        const t = timeLabel(a.starts_at),
                          m = Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
                        return (
                          a.professional_id === p.id && m >= min && m < min + rules.slot_minutes
                        );
                      });
                      const occupied = events.some(
                        (a) =>
                          a.professional_id === p.id &&
                          new Date(a.starts_at) < zonedInstant(date, time, viewTimezone()) &&
                          new Date(a.ends_at) > zonedInstant(date, time, viewTimezone()),
                      );
                      return (
                        <td key={p.id}>
                          {items.map(event)}
                          {!items.length &&
                            (inBreak(rules, weekdayOf(date), min) ? (
                              <small>Intervalo</small>
                            ) : occupied ? (
                              <small>Em sessão</small>
                            ) : (
                              <button
                                className="panorama-free"
                                disabled={!bookable(p, date, time)}
                                onClick={() =>
                                  onBook({ professional_id: p.id, local_start: date + 'T' + time })
                                }
                              >
                                Vago
                              </button>
                            ))}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <div className="agenda-legend">
        <span>
          <i className="legend-dot scheduled" />
          Agendado
        </span>
        <span>
          <i className="legend-dot arrived" />
          Na recepção
        </span>
        <span>
          <i className="legend-dot in-progress" />
          Em atendimento
        </span>
        <span>
          <i className="legend-dot completed" />
          Realizado
        </span>
        <span>
          <i className="legend-dot absent" />
          Falta / cancelado
        </span>
      </div>
    </>
  );
}
