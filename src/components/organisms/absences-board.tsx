'use client';
import { fromLocalInput } from '@/lib/timezone';
import { viewTimezone } from '@/lib/view-timezone';
import { useEffect, useState } from 'react';
import { ReasonButton, WaitlistEdit } from './record-lifecycle';
import { z } from 'zod';
import { api, post } from '@/lib/client';
import { labels, specialtyOptions, specialtyCode } from '@/lib/schemas';
import { dateLabel, timeLabel, type Entity } from '@/lib/types';
import { useNotices } from '@/stores/workspace';
import { Dialog } from '../molecules/dialog';
import { DataTable } from '../molecules/data-table';
import { Button } from '../atoms/button';
import { Badge } from '../atoms/badge';
import { SchemaForm } from './schema-form';
export function AbsencesBoard({
  unitId,
  professionals,
  onBook,
}: {
  unitId: string;
  professionals: Entity[];
  onBook: (preset: Record<string, any>) => void;
}) {
  const [data, setData] = useState<any>(null),
    [tab, setTab] = useState('absent'),
    [form, setForm] = useState<{ kind: string; row?: Entity } | null>(null),
    [error, setError] = useState('');
  const add = useNotices((s) => s.add);
  async function load() {
    try {
      setData(await api('waitlist?unit=' + unitId));
      setError('');
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => {
    void load();
  }, [unitId]);
  async function save(operation: string, d: Record<string, any>) {
    await post('operations', { operation, unit_id: unitId, ...d });
    setForm(null);
    await load();
    add('Registro salvo.');
  }
  return (
    <>
      {error && <p className="error-banner">{error}</p>}
      <div className="toolbar">
        <div className="tabs">
          <button className={tab === 'absent' ? 'active' : ''} onClick={() => setTab('absent')}>
            Faltas e reposições
          </button>
          <button className={tab === 'waitlist' ? 'active' : ''} onClick={() => setTab('waitlist')}>
            Lista de espera ({data?.data.length || 0})
          </button>
          <button
            className={tab === 'professionals' ? 'active' : ''}
            onClick={() => setTab('professionals')}
          >
            Ausências profissionais
          </button>
        </div>
        <div className="actions wrap">
          <Button variant="secondary" onClick={() => setForm({ kind: 'waitlist' })}>
            Adicionar à lista de espera
          </Button>
          <Button variant="secondary" onClick={() => setForm({ kind: 'absence' })}>
            Registrar ausência do profissional
          </Button>
        </div>
      </div>
      {!data ? (
        <p className="loading">Carregando faltas e reposições…</p>
      ) : tab === 'waitlist' ? (
        <DataTable
          rows={data.data}
          total={data.data.length}
          page={1}
          columns={[
            {
              key: 'patient_name',
              label: 'Paciente',
              render: (r) => (
                <>
                  <strong>{r.patient_name}</strong>
                  <small>
                    {r.guardian} · {r.phone}
                  </small>
                </>
              ),
            },
            { key: 'specialty', label: 'Área', render: (r) => labels[r.specialty] },
            {
              key: 'preferred_period',
              label: 'Preferência',
              render: (r) => (
                <>
                  {
                    { ANY: 'Qualquer período', MORNING: 'Manhã', AFTERNOON: 'Tarde' }[
                      r.preferred_period as string
                    ]
                  }
                  <small>
                    {r.preferred_days
                      .map((d: number) => ['', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'][d])
                      .join(', ')}
                  </small>
                </>
              ),
            },
            {
              key: 'status',
              label: 'Situação',
              render: (r) => (
                <Badge
                  value={
                    r.status === 'SCHEDULED'
                      ? 'APPROVED'
                      : r.status === 'OFFERED'
                        ? 'CONFIRMED'
                        : 'PENDING'
                  }
                  label={
                    {
                      WAITING: 'Aguardando vaga',
                      OFFERED: 'Oferta preparada',
                      SCHEDULED: 'Agendado',
                    }[r.status as string] || r.status
                  }
                />
              ),
            },
            {
              key: 'action',
              label: 'Ações',
              render: (r) =>
                r.status === 'SCHEDULED' ? (
                  <span>Reserva registrada</span>
                ) : (
                  <div className="actions wrap">
                    <WaitlistEdit row={r} onDone={() => void load()} />
                    <Button variant="secondary" onClick={() => setForm({ kind: 'offer', row: r })}>
                      Preparar oferta
                    </Button>
                    <Button
                      variant="secondary"
                      onClick={() => onBook({ patient_id: r.patient_id, waitlist_id: r.id })}
                    >
                      Agendar
                    </Button>
                    <Button variant="ghost" onClick={() => setForm({ kind: 'cancel', row: r })}>
                      Retirar da fila
                    </Button>
                  </div>
                ),
            },
          ]}
        />
      ) : tab === 'professionals' ? (
        <DataTable
          rows={data.absences}
          total={data.absences.length}
          page={1}
          columns={[
            { key: 'professional_name', label: 'Profissional' },
            {
              key: 'starts_at',
              label: 'Início',
              render: (r) => dateLabel(r.starts_at) + ' ' + timeLabel(r.starts_at),
            },
            {
              key: 'ends_at',
              label: 'Fim',
              render: (r) => dateLabel(r.ends_at) + ' ' + timeLabel(r.ends_at),
            },
            { key: 'reason', label: 'Motivo' },
            {
              key: 'status',
              label: 'Situação',
              render: (r) =>
                r.status === 'CANCELLED' ? (
                  <Badge value="neutral" label="Cancelada" />
                ) : (
                  <Badge
                    value="PENDING"
                    label={
                      r.cancelled_appointment_ids?.length
                        ? r.cancelled_appointment_ids.length + ' sessão(ões) cancelada(s)'
                        : 'Ativa'
                    }
                  />
                ),
            },
            {
              key: 'actions',
              label: 'Ações',
              render: (r) =>
                r.status !== 'CANCELLED' && (
                  <ReasonButton
                    label="Cancelar ausência"
                    title={'Cancelar ausência · ' + r.professional_name}
                    description="As sessões que esta ausência cancelou voltam para a agenda se o horário continuar livre e o crédito de reposição ainda não tiver sido usado. As demais ficam listadas para a recepção resolver."
                    action="absence-cancel"
                    payload={{ id: r.id }}
                    done={(x: any) =>
                      x.restored +
                      ' sessão(ões) devolvida(s) à agenda' +
                      (x.kept.length
                        ? '; ' +
                          x.kept.length +
                          ' para resolver: ' +
                          x.kept.map((k: any) => k.when + ' (' + k.reason + ')').join(', ')
                        : '') +
                      '.'
                    }
                    onDone={() => void load()}
                  />
                ),
            },
          ]}
        />
      ) : (
        <>
          <div className="note">
            Ausência do profissional não conta como falta do paciente. Reposições com crédito
            precisam seguir as regras de autorização do plano.
          </div>
          <DataTable
            rows={data.absent}
            total={data.absent.length}
            page={1}
            columns={[
              {
                key: 'starts_at',
                label: 'Sessão',
                render: (r) => dateLabel(r.starts_at) + ' ' + timeLabel(r.starts_at),
              },
              { key: 'patient_name', label: 'Paciente' },
              { key: 'professional_name', label: 'Profissional' },
              {
                key: 'absence_kind',
                label: 'Ocorrência',
                render: (r) => (
                  <Badge
                    value={r.absence_kind === 'PROFESSIONAL' ? 'PENDING' : 'REJECTED'}
                    label={
                      r.absence_kind === 'PROFESSIONAL'
                        ? 'Ausência do profissional'
                        : 'Falta do paciente'
                    }
                  />
                ),
              },
              { key: 'reason', label: 'Justificativa' },
              {
                key: 'action',
                label: 'Reposição',
                render: (r) => {
                  const credit = data.credits.find((c: Entity) => c.source_appointment_id === r.id);
                  return (
                    <Button
                      variant="secondary"
                      disabled={credit?.status === 'RESERVED'}
                      onClick={() =>
                        onBook({
                          patient_id: r.patient_id,
                          professional_id: r.professional_id,
                          appointment_kind: 'REPLACEMENT',
                          ...(credit ? { replacement_credit_id: credit.id } : {}),
                        })
                      }
                    >
                      {credit?.status === 'RESERVED'
                        ? 'Reposição já agendada'
                        : credit
                          ? 'Usar crédito e agendar'
                          : 'Agendar nova sessão'}
                    </Button>
                  );
                },
              },
            ]}
          />
        </>
      )}
      {form && (
        <Dialog
          title={
            form.kind === 'waitlist'
              ? 'Adicionar à lista de espera'
              : form.kind === 'absence'
                ? 'Ausência do profissional'
                : form.kind === 'offer'
                  ? 'Preparar oferta de vaga'
                  : 'Retirar da lista de espera'
          }
          onClose={() => setForm(null)}
          wide
        >
          {form.kind === 'waitlist' ? (
            <SchemaForm
              schema={z.object({
                patient_id: z.uuid(),
                specialty: specialtyCode,
                preferred_days: z.array(z.coerce.number().int()).default([]),
                preferred_period: z.enum(['ANY', 'MORNING', 'AFTERNOON']),
                priority: z.enum(['NORMAL', 'HIGH']),
                notes: z.string().max(1000),
              })}
              fields={[
                {
                  name: 'patient_id',
                  label: 'Paciente da lista de espera',
                  type: 'directory',
                  directoryKind: 'patients',
                  unitId,
                },
                {
                  name: 'specialty',
                  label: 'Especialidade solicitada',
                  type: 'select',
                  options: specialtyOptions().map(([value, label]) => ({ value, label })),
                },
                {
                  name: 'preferred_days',
                  label: 'Dias disponíveis',
                  type: 'multiselect',
                  options: ['Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'].map(
                    (label, i) => ({ value: String(i + 1), label }),
                  ),
                },
                {
                  name: 'preferred_period',
                  label: 'Período',
                  type: 'select',
                  options: [
                    { value: 'ANY', label: 'Qualquer período' },
                    { value: 'MORNING', label: 'Manhã' },
                    { value: 'AFTERNOON', label: 'Tarde' },
                  ],
                },
                {
                  name: 'priority',
                  label: 'Prioridade',
                  type: 'select',
                  options: [
                    { value: 'NORMAL', label: 'Normal' },
                    { value: 'HIGH', label: 'Alta' },
                  ],
                },
                { name: 'notes', label: 'Observações da família', type: 'textarea' },
              ]}
              defaults={{
                patient_id: '',
                specialty: 'fono',
                preferred_days: [],
                preferred_period: 'ANY',
                priority: 'NORMAL',
                notes: '',
              }}
              label="Salvar na lista de espera"
              onSubmit={(d) => save('WAITLIST_ADD', d)}
            />
          ) : form.kind === 'absence' ? (
            <SchemaForm
              schema={z
                .object({
                  professional_id: z.uuid(),
                  start: z.string().min(16),
                  end: z.string().min(16),
                  reason: z.string().min(10),
                })
                .transform(({ start, end, ...v }) => ({
                  ...v,
                  starts_at: fromLocalInput(start, viewTimezone()).toISOString(),
                  ends_at: fromLocalInput(end, viewTimezone()).toISOString(),
                }))}
              fields={[
                {
                  name: 'professional_id',
                  label: 'Profissional ausente',
                  type: 'select',
                  options: professionals
                    .filter((p) => p.active)
                    .map((p) => ({ value: p.id, label: p.name })),
                },
                {
                  name: 'start',
                  label: 'Início da ausência (horário da unidade)',
                  type: 'datetime-local',
                },
                {
                  name: 'end',
                  label: 'Fim da ausência (horário da unidade)',
                  type: 'datetime-local',
                },
                { name: 'reason', label: 'Justificativa da ausência', type: 'textarea' },
              ]}
              defaults={{ professional_id: '', start: '', end: '', reason: '' }}
              label="Confirmar ausência e gerar reposições"
              onSubmit={(d) => save('PROF_ABSENCE', d)}
            />
          ) : (
            <SchemaForm
              schema={z.object({ reason: z.string().min(10) })}
              fields={[
                {
                  name: 'reason',
                  label:
                    form.kind === 'offer'
                      ? 'Horário oferecido e observação para a família'
                      : 'Justificativa da retirada',
                  type: 'textarea',
                },
              ]}
              defaults={{ reason: '' }}
              label={form.kind === 'offer' ? 'Preparar mensagem de oferta' : 'Confirmar retirada'}
              onSubmit={(d) =>
                save(form.kind === 'offer' ? 'WAITLIST_OFFER' : 'WAITLIST_CANCEL', {
                  waitlist_id: form.row!.id,
                  ...d,
                })
              }
            />
          )}
        </Dialog>
      )}
    </>
  );
}
