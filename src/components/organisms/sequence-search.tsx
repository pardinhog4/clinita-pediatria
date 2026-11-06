'use client';
import { zonedInstant } from '@/lib/timezone';
import { viewTimezone } from '@/lib/view-timezone';
import { useEffect, useState } from 'react';
import { addDays, startOfWeek, format } from 'date-fns';
import { api, post } from '@/lib/client';
import { labels } from '@/lib/schemas';
import { dateLabel, type Entity } from '@/lib/types';
import { useNotices } from '@/stores/workspace';
import { Button } from '../atoms/button';
import { Badge } from '../atoms/badge';
import { DataTable } from '../molecules/data-table';
import { Dialog } from '../molecules/dialog';
export function SequenceSearch({
  unitId,
  patient,
  duration,
}: {
  unitId: string;
  patient: Entity | null;
  duration: number;
}) {
  const [week, setWeek] = useState(
      format(startOfWeek(addDays(new Date(), 7), { weekStartsOn: 1 }), 'yyyy-MM-dd'),
    ),
    [days, setDays] = useState<number[]>([1, 3, 5]),
    [period, setPeriod] = useState('ANY'),
    [needs, setNeeds] = useState<Record<string, number>>({}),
    [plan, setPlan] = useState<Entity[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [confirm, setConfirm] = useState(false);
  const add = useNotices((s) => s.add);
  useEffect(() => {
    setPlan([]);
    setNeeds(
      Object.fromEntries(
        (patient?.metadata.specialties || []).map((s: string) => [
          s,
          Number(patient?.metadata.weekly_limits?.[s]) || 1,
        ]),
      ),
    );
    setDays(patient?.metadata.preferred_days?.length ? patient.metadata.preferred_days : [1, 3, 5]);
    setPeriod(patient?.metadata.preferred_period || 'ANY');
  }, [patient?.id]);
  async function suggest() {
    if (!patient) return;
    setBusy(true);
    setError('');
    setPlan([]);
    try {
      if (!days.length) throw Error('Selecione os dias disponíveis da família.');
      const specialties = Object.keys(needs).filter((s) => needs[s] > 0);
      if (!specialties.length) throw Error('Informe a quantidade de sessões por especialidade.');
      const first = startOfWeek(new Date(week + 'T12:00:00'), { weekStartsOn: 1 }),
        dates = days
          .slice()
          .sort((a, b) => a - b)
          .map((d) => format(addDays(first, d - 1), 'yyyy-MM-dd'));
      const cache = new Map<string, Entity[]>();
      const requests = await Promise.allSettled(
        dates.flatMap((date) =>
          specialties.map(async (specialty) => {
            const r = await api<{ data: Entity[] }>(
              'availability?' +
                new URLSearchParams({
                  unit: unitId,
                  date,
                  specialty,
                  duration: String(duration),
                  patient: patient.id,
                }),
            );
            cache.set(date + ':' + specialty, r.data);
          }),
        ),
      );
      const rejected = requests.find((r) => r.status === 'rejected');
      if (rejected?.status === 'rejected') throw rejected.reason;
      const existing = await api<{ data: Entity[] }>(
        'appointments?' +
          new URLSearchParams({
            unit: unitId,
            from: format(first, 'yyyy-MM-dd'),
            to: format(addDays(first, 6), 'yyyy-MM-dd'),
            patient_id: patient.id,
            limit: '500',
          }),
      );
      for (const specialty of specialties) {
        const count = existing.data.filter(
            (a) => a.specialty === specialty && !['CANCELLED', 'ABSENT'].includes(a.status),
          ).length,
          limit = Number(patient.metadata.weekly_limits?.[specialty] || 0);
        if (limit && count + needs[specialty] > limit)
          throw Error(
            `${labels[specialty]}: já existem ${count} sessões na semana, para um limite de ${limit}. Ajuste a quantidade solicitada.`,
          );
      }
      const remaining = { ...needs },
        result: Entity[] = [];
      for (const date of dates) {
        const areas = specialties.filter((s) => remaining[s] > 0);
        if (!areas.length) break;
        const firstArea = areas[0],
          candidates = (cache.get(date + ':' + firstArea) || []).flatMap((p) =>
            p.slots.filter((s: any) => s.available).map((s: any) => s.time),
          );
        for (const time of [...new Set<string>(candidates)].sort()) {
          let min = Number(time.slice(0, 2)) * 60 + Number(time.slice(3)),
            suggestion: Entity[] = [];
          if ((period === 'MORNING' && min >= 720) || (period === 'AFTERNOON' && min < 780))
            continue;
          for (const specialty of areas) {
            const slot =
              String(Math.floor(min / 60)).padStart(2, '0') +
              ':' +
              String(min % 60).padStart(2, '0');
            const fixed = patient.metadata.fixed_professionals?.[specialty];
            const prof = (cache.get(date + ':' + specialty) || []).find(
              (p) =>
                (!fixed || p.id === fixed) &&
                p.slots.some((s: any) => s.time === slot && s.available),
            );
            if (!prof) {
              suggestion = [];
              break;
            }
            suggestion.push({
              id: date + slot + specialty,
              version: 1,
              date,
              time: slot,
              professional_id: prof.id,
              professional_name: prof.name,
              specialty,
              duration,
              patient_id: patient.id,
            });
            min += duration;
          }
          if (suggestion.length === areas.length) {
            result.push(...suggestion);
            areas.forEach((s) => remaining[s]--);
            break;
          }
        }
      }
      if (Object.values(remaining).some((n) => n > 0))
        throw Error(
          'Não foi possível montar toda a grade em sequência nos dias escolhidos. Amplie os dias ou busque horários individuais.',
        );
      setPlan(result);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="card form">
      <h2>Montar semana sequenciada</h2>
      <p>
        Escolha um paciente cadastrado acima. A grade respeita idade, plano, disponibilidade,
        quantitativo do pedido e preferência por profissional fixo.
      </p>
      {!patient ? (
        <p className="note">Selecione o paciente para carregar o pedido e as preferências.</p>
      ) : (
        <>
          <div className="operational-filters">
            <label className="field">
              Semana de referência
              <input
                className="input"
                type="date"
                value={week}
                onChange={(e) => setWeek(e.target.value)}
              />
            </label>
            <label className="field">
              Período preferido
              <select className="input" value={period} onChange={(e) => setPeriod(e.target.value)}>
                <option value="ANY">Qualquer período</option>
                <option value="MORNING">Manhã</option>
                <option value="AFTERNOON">Tarde</option>
              </select>
            </label>
          </div>
          <div className="check-list">
            {['Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'].map((label, i) => (
              <label key={label}>
                <input
                  type="checkbox"
                  checked={days.includes(i + 1)}
                  onChange={(e) =>
                    setDays(e.target.checked ? [...days, i + 1] : days.filter((d) => d !== i + 1))
                  }
                />
                {label}
              </label>
            ))}
          </div>
          <div className="operational-filters">
            {Object.keys(needs).map((s) => (
              <label className="field" key={s}>
                {labels[s]} · sessões na semana
                <input
                  className="input"
                  type="number"
                  min="0"
                  max="6"
                  value={needs[s]}
                  onChange={(e) =>
                    setNeeds({ ...needs, [s]: Math.min(6, Math.max(0, Number(e.target.value))) })
                  }
                />
              </label>
            ))}
          </div>
          <Button disabled={busy} onClick={() => void suggest()}>
            {busy ? 'Consultando a grade…' : 'Sugerir sequência de horários'}
          </Button>
        </>
      )}
      {error && (
        <p className="error-banner" role="alert">
          {error}
        </p>
      )}
      {plan.length > 0 && (
        <>
          <DataTable
            rows={plan}
            total={plan.length}
            page={1}
            columns={[
              { key: 'date', label: 'Data', render: (r) => dateLabel(r.date) },
              { key: 'time', label: 'Horário' },
              { key: 'specialty', label: 'Área', render: (r) => labels[r.specialty] },
              { key: 'professional_name', label: 'Profissional' },
              { key: 'duration', label: 'Minutos' },
              {
                key: 'status',
                label: 'Situação',
                render: () => <Badge value="PENDING" label="Proposta · ainda não reservada" />,
              },
            ]}
          />
          <Button onClick={() => setConfirm(true)}>Conferir e reservar a grade</Button>
        </>
      )}
      {confirm && (
        <Dialog title="Confirmar reserva da grade" onClose={() => setConfirm(false)}>
          <p>
            {plan.length} sessões de {patient?.name}. Todas serão verificadas novamente na mesma
            transação; se houver conflito, nenhuma sessão será criada.
          </p>
          <div className="actions">
            <Button variant="secondary" onClick={() => setConfirm(false)}>
              Voltar
            </Button>
            <Button
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  const conversationId = new URLSearchParams(window.location.search).get(
                    'conversation',
                  );
                  const r = conversationId
                    ? await post('operations', {
                        operation: 'PROPOSAL_CREATE',
                        unit_id: unitId,
                        conversation_id: conversationId,
                        request_id: crypto.randomUUID(),
                        patient_id: patient!.id,
                        appointments: plan.map((a) => ({
                          professional_id: a.professional_id,
                          starts_at: zonedInstant(a.date, a.time, viewTimezone()).toISOString(),
                          duration: a.duration,
                        })),
                      })
                    : await post('operations', {
                        operation: 'RESERVE_SEQUENCE',
                        unit_id: unitId,
                        appointments: plan.map((a) => ({
                          unit_id: unitId,
                          patient_id: a.patient_id,
                          professional_id: a.professional_id,
                          starts_at: zonedInstant(a.date, a.time, viewTimezone()).toISOString(),
                          duration: a.duration,
                          occurrences: 1,
                          appointment_kind: 'SESSION',
                        })),
                      });
                  setConfirm(false);
                  setPlan([]);
                  add(
                    conversationId
                      ? 'Proposta preparada para aceite e aprovação em WhatsApp → Propostas.'
                      : r.count + ' sessões reservadas na agenda.',
                  );
                } catch (e) {
                  setError((e as Error).message);
                  setConfirm(false);
                } finally {
                  setBusy(false);
                }
              }}
            >
              Confirmar reserva
            </Button>
          </div>
        </Dialog>
      )}
    </div>
  );
}
