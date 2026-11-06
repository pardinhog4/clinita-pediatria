'use client';
import { viewTimezone } from '@/lib/view-timezone';
import { useState } from 'react';
import { z } from 'zod';
import { post } from '@/lib/client';
import { currency, dateLabel, type Entity } from '@/lib/types';
import { labels, specialtyOptions, specialtyCode } from '@/lib/schemas';
import { Badge } from '../atoms/badge';
import { Button } from '../atoms/button';
import { DataTable } from '../molecules/data-table';
import { SchemaForm } from './schema-form';
export function PatientOperations({
  record,
  tab,
  onSaved,
}: {
  record: Entity;
  tab: string;
  onSaved: () => Promise<void>;
}) {
  const [adding, setAdding] = useState(false),
    [progress, setProgress] = useState<Entity | null>(null),
    [month, setMonth] = useState(
      new Date().toLocaleDateString('sv-SE', { timeZone: viewTimezone() }).slice(0, 7),
    );
  if (tab === 'care')
    return (
      <>
        <h3>Equipe terapêutica</h3>
        {record.care_team?.map((p: Entity) => (
          <div className="timeline-item actions between" key={p.id}>
            <div>
              <strong>{p.name}</strong>
              <small>{labels[p.specialty]}</small>
            </div>
            <Badge
              value={p.active ? 'APPROVED' : 'EMPTY'}
              label={p.active ? 'Equipe ativa' : 'Histórico preservado'}
            />
          </div>
        ))}
        {!record.care_team?.length && (
          <p className="empty">A equipe será formada pelos profissionais dos atendimentos.</p>
        )}
        <h3 className="section-title">Pedido e preferências</h3>
        <p>
          Pedido válido até{' '}
          {record.metadata.order_expires
            ? dateLabel(record.metadata.order_expires)
            : 'data não informada'}
          .
        </p>
        <div className="tags">
          {record.metadata.interventions?.map((v: string) => (
            <span className="tag" key={v}>
              {v}
            </span>
          ))}
        </div>
        <p>
          Quantitativo semanal:{' '}
          {Object.entries(record.metadata.weekly_limits || {})
            .filter(([, v]) => Number(v) > 0)
            .map(([k, v]) => (labels[k] || k) + ': ' + v)
            .join(' · ') || 'não informado'}
          .
        </p>
      </>
    );
  if (tab === 'credits')
    return (
      <>
        <h3>Créditos e reposições</h3>
        {record.credits?.map((c: Entity) => (
          <div className="timeline-item actions between" key={c.id}>
            <div>
              <strong>{c.insurer_name}</strong>
              <small>{c.reason}</small>
              {c.contract_end && (
                <small className="payout-retained">
                  Plano termina em {dateLabel(c.contract_end)}
                </small>
              )}
            </div>
            <Badge
              value={
                c.status === 'USED' ? 'APPROVED' : c.status === 'RESERVED' ? 'CONFIRMED' : 'PENDING'
              }
              label={
                {
                  OPEN: 'Disponível',
                  RESERVED: 'Reposição agendada',
                  USED: 'Reposição realizada',
                  CANCELLED: 'Cancelado',
                }[c.status as string] || c.status
              }
            />
          </div>
        ))}
        {!record.credits?.length && <p className="empty">Nenhum crédito de sessão registrado.</p>}
      </>
    );
  if (tab === 'copayment') {
    const cp = record.copayment;
    const items = (cp?.items || []).filter((i: Entity) =>
      new Date(i.snapshot.starts_at)
        .toLocaleDateString('sv-SE', { timeZone: viewTimezone() })
        .startsWith(month),
    );
    return (
      <>
        <h3>Extrato de coparticipação</h3>
        {!cp?.enabled || !cp?.rate ? (
          <p className="note">Este paciente não possui coparticipação configurada no plano.</p>
        ) : (
          <>
            <label className="field">
              Competência do extrato
              <input
                className="input"
                type="month"
                value={month}
                onChange={(e) => setMonth(e.target.value)}
              />
            </label>
            <div className="mini-metrics">
              <div>
                <strong>{cp.rate}%</strong>
                <small>Regra cadastrada do plano</small>
              </div>
              <div>
                <strong>{items.length}</strong>
                <small>Sessões já incluídas em lote</small>
              </div>
              <div>
                <strong>
                  {currency(
                    items.reduce(
                      (s: number, i: Entity) => s + (Number(i.amount) * cp.rate) / 100,
                      0,
                    ),
                  )}
                </strong>
                <small>Coparticipação estimada</small>
              </div>
            </div>
            <p className="note">
              Extrato de conferência baseado nas sessões faturadas e na regra cadastrada. Valores
              efetivamente cobrados dependem do demonstrativo da operadora.
            </p>
            <DataTable
              rows={items}
              total={items.length}
              page={1}
              columns={[
                {
                  key: 'date',
                  label: 'Atendimento',
                  render: (r) => dateLabel(r.snapshot.starts_at),
                },
                {
                  key: 'professional',
                  label: 'Profissional',
                  render: (r) => r.snapshot.professional_name,
                },
                {
                  key: 'proof',
                  label: 'Provas',
                  render: (r) => (
                    <Badge value="APPROVED" label="Presença, autorização e evolução conferidas" />
                  ),
                },
                { key: 'batch_number', label: 'Lote' },
                {
                  key: 'amount',
                  label: 'Coparticipação',
                  render: (r) => currency((Number(r.amount) * cp.rate) / 100),
                },
              ]}
            />
          </>
        )}
      </>
    );
  }
  if (tab === 'evaluations')
    return !record.clinical_access ? (
      <p className="note">Avaliações são restritas à equipe de cuidado autorizada.</p>
    ) : (
      <>
        <div className="actions between">
          <h3>Processos de avaliação</h3>
          <Button
            onClick={() => {
              setAdding(!adding);
              setProgress(null);
            }}
          >
            Iniciar processo de avaliação
          </Button>
        </div>
        {adding && (
          <SchemaForm
            schema={z.object({
              specialty: specialtyCode,
              target_sessions: z.coerce.number().int().min(1).max(100),
              notes: z.string().max(3000),
            })}
            fields={[
              {
                name: 'specialty',
                label: 'Área da avaliação',
                type: 'select',
                options: specialtyOptions().map(([value, label]) => ({ value, label })),
              },
              { name: 'target_sessions', label: 'Quantidade prevista de sessões', type: 'number' },
              { name: 'notes', label: 'Objetivo e observações', type: 'textarea' },
            ]}
            defaults={{
              specialty: record.metadata.specialties?.[0] || 'fono',
              target_sessions: 10,
              notes: '',
            }}
            label="Registrar processo de avaliação"
            onSubmit={async (d) => {
              await post('operations', {
                operation: 'ASSESSMENT_START',
                unit_id: record.unit_id,
                patient_id: record.id,
                ...d,
              });
              setAdding(false);
              await onSaved();
            }}
          />
        )}
        {record.assessments?.map((a: Entity) => (
          <div className="timeline-item" key={a.id}>
            <div className="actions between">
              <strong>
                {labels[a.specialty]} · {a.completed_sessions} de {a.target_sessions} sessões
              </strong>
              <Badge
                value={a.status === 'COMPLETED' ? 'APPROVED' : 'PENDING'}
                label={a.status === 'COMPLETED' ? 'Avaliação concluída' : 'Em avaliação'}
              />
            </div>
            <progress
              className="assessment-progress"
              max={a.target_sessions}
              value={a.completed_sessions}
            />
            {a.status === 'IN_PROGRESS' && (
              <Button
                variant="secondary"
                onClick={() => {
                  setProgress(a);
                  setAdding(false);
                }}
              >
                Atualizar progresso
              </Button>
            )}
          </div>
        ))}
        {progress && (
          <SchemaForm
            schema={z.object({
              completed_sessions: z.coerce.number().int().min(0).max(progress.target_sessions),
              notes: z.string().max(3000),
            })}
            fields={[
              {
                name: 'completed_sessions',
                label: 'Sessões de avaliação concluídas',
                type: 'number',
              },
              { name: 'notes', label: 'Referência do acompanhamento', type: 'textarea' },
            ]}
            defaults={{ completed_sessions: progress.completed_sessions, notes: '' }}
            label="Salvar acompanhamento"
            onSubmit={async (d) => {
              await post('operations', {
                operation: 'ASSESSMENT_PROGRESS',
                unit_id: record.unit_id,
                patient_id: record.id,
                assessment_id: progress.id,
                ...d,
              });
              setProgress(null);
              await onSaved();
            }}
          />
        )}
        {!record.assessments?.length && !adding && (
          <p className="empty">Nenhum processo de avaliação iniciado.</p>
        )}
      </>
    );
  return null;
}
