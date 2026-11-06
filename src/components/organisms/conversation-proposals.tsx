'use client';
import { viewTimezone } from '@/lib/view-timezone';
import { useEffect, useState } from 'react';
import { z } from 'zod';
import Link from 'next/link';
import { api, post, fetchAll } from '@/lib/client';
import { dateLabel, timeLabel, type Entity } from '@/lib/types';
import { useNotices } from '@/stores/workspace';
import { DataTable } from '../molecules/data-table';
import { Dialog } from '../molecules/dialog';
import { Badge } from '../atoms/badge';
import { Button } from '../atoms/button';
import { SchemaForm } from './schema-form';
export function ConversationProposals({ unitId }: { unitId: string }) {
  const [rows, setRows] = useState<Entity[]>([]),
    [profs, setProfs] = useState<Entity[]>([]),
    [selected, setSelected] = useState<{
      row: Entity;
      action: 'ACCEPT' | 'APPROVE' | 'REJECT';
    } | null>(null),
    [error, setError] = useState('');
  const add = useNotices((s) => s.add);
  async function load() {
    const r = await api<{ data: Entity[] }>('conversation-proposals?unit=' + unitId);
    setRows(r.data);
  }
  useEffect(() => {
    void load().catch((e) => setError(e.message));
    fetchAll<Entity>('professionals?unit=' + unitId)
      .then((r) => setProfs(r.data))
      .catch((e) => setError(e.message));
  }, [unitId]);
  return (
    <>
      <div className="note">
        Propostas não reservam horários. Primeiro registre o aceite da família; depois a equipe
        confirma a identidade e aprova a reserva. Todas as sessões são validadas juntas.
      </div>
      {error && <p className="error-banner">{error}</p>}
      <Button variant="secondary" onClick={() => void load().catch((e) => setError(e.message))}>
        Atualizar propostas
      </Button>
      <DataTable
        rows={rows}
        total={rows.length}
        page={1}
        columns={[
          {
            key: 'guardian',
            label: 'Família',
            render: (r) => (
              <>
                <strong>{r.guardian}</strong>
                <small>{r.patient_name || 'Paciente ainda não identificado'}</small>
                {r.sandbox && <Badge value="CONFIRMED" label="Sandbox" />}
              </>
            ),
          },
          {
            key: 'appointments',
            label: 'Horários propostos',
            render: (r) => (
              <>
                {r.appointments.map((a: any, index: number) => (
                  <div className="small" key={index}>
                    {dateLabel(a.starts_at)} {timeLabel(a.starts_at)} ·{' '}
                    {profs.find((p) => p.id === a.professional_id)?.name ||
                      'Profissional cadastrado'}
                    {a.occurrences > 1 && <> · toda semana, {a.occurrences} sessões</>}
                  </div>
                ))}
              </>
            ),
          },
          {
            key: 'status',
            label: 'Etapa',
            render: (r) => (
              <Badge
                value={
                  r.status === 'APPROVED'
                    ? 'APPROVED'
                    : r.status === 'REJECTED'
                      ? 'REJECTED'
                      : r.status === 'ACCEPTED'
                        ? 'CONFIRMED'
                        : 'PENDING'
                }
                label={
                  {
                    DRAFT: 'Aguardando aceite da família',
                    ACCEPTED: 'Aceita · falta aprovação',
                    APPROVED: 'Sessões reservadas',
                    REJECTED: 'Recusada',
                  }[r.status as string] || r.status
                }
              />
            ),
          },
          {
            key: 'action',
            label: 'Ações',
            render: (r) => (
              <div className="actions wrap">
                {r.status === 'DRAFT' && (
                  <Button
                    variant="secondary"
                    onClick={() => setSelected({ row: r, action: 'ACCEPT' })}
                  >
                    Registrar aceite da família
                  </Button>
                )}
                {r.status === 'ACCEPTED' && (
                  <Button onClick={() => setSelected({ row: r, action: 'APPROVE' })}>
                    Aprovar e reservar
                  </Button>
                )}
                {['DRAFT', 'ACCEPTED'].includes(r.status) && (
                  <Button variant="ghost" onClick={() => setSelected({ row: r, action: 'REJECT' })}>
                    Recusar proposta
                  </Button>
                )}
                {r.status === 'APPROVED' && (
                  <Link
                    className="button secondary"
                    href={
                      '/agenda?view=day&date=' +
                      new Date(r.appointments[0].starts_at).toLocaleDateString('sv-SE', {
                        timeZone: viewTimezone(),
                      })
                    }
                  >
                    Ver na agenda
                  </Link>
                )}
              </div>
            ),
          },
        ]}
      />
      {selected && (
        <Dialog
          title={
            selected.action === 'APPROVE'
              ? 'Aprovar proposta e reservar'
              : selected.action === 'ACCEPT'
                ? 'Registrar aceite da família'
                : 'Recusar proposta'
          }
          onClose={() => setSelected(null)}
        >
          <SchemaForm
            schema={z
              .object({
                reason: z.string().min(10),
                patient_id: z.string().default(''),
                identity_confirmed: z.boolean().default(false),
              })
              .superRefine((d, ctx) => {
                if (selected.action === 'APPROVE' && (!d.patient_id || !d.identity_confirmed))
                  ctx.addIssue({
                    code: 'custom',
                    message: 'Selecione o paciente e confirme a conferência de identidade.',
                    path: ['identity_confirmed'],
                  });
              })}
            fields={[
              ...(selected.action === 'APPROVE'
                ? [
                    {
                      name: 'patient_id',
                      label: 'Paciente confirmado pela equipe',
                      type: 'directory' as const,
                      directoryKind: 'patients',
                      unitId,
                    },
                    {
                      name: 'identity_confirmed',
                      label: 'Conferi a identidade e o vínculo com o responsável',
                      type: 'checkbox' as const,
                    },
                  ]
                : []),
              {
                name: 'reason',
                label:
                  selected.action === 'ACCEPT'
                    ? 'Referência do aceite informado pela família'
                    : 'Justificativa da decisão',
                type: 'textarea',
              },
            ]}
            defaults={{
              reason: '',
              patient_id: selected.row.patient_id || '',
              identity_confirmed: false,
            }}
            label={
              selected.action === 'APPROVE'
                ? 'Confirmar aprovação e reserva'
                : selected.action === 'ACCEPT'
                  ? 'Confirmar aceite'
                  : 'Confirmar recusa'
            }
            onSubmit={async (d) => {
              const result = await post('operations', {
                operation: 'PROPOSAL_DECIDE',
                unit_id: unitId,
                proposal_id: selected.row.id,
                action: selected.action,
                reason: d.reason,
                identity_confirmed: d.identity_confirmed,
                ...(d.patient_id ? { patient_id: d.patient_id } : {}),
              });
              setSelected(null);
              await load();
              add(result.count ? result.count + ' sessões reservadas.' : 'Proposta atualizada.');
            }}
          />
        </Dialog>
      )}
    </>
  );
}
