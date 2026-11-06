'use client';
import { fromLocalInput } from '@/lib/timezone';
import { viewTimezone } from '@/lib/view-timezone';
import { useState } from 'react';
import { z } from 'zod';
import { post } from '@/lib/client';
import type { Entity } from '@/lib/types';
import { useNotices } from '@/stores/workspace';
import { Button } from '../atoms/button';
import { SchemaForm } from './schema-form';
import { useClinicRules } from '@/hooks/use-clinic-rules';
export function AppointmentOperations({
  row,
  role,
  onSaved,
  onClose,
}: {
  row: Entity;
  role: string;
  onSaved: () => void;
  onClose: () => void;
}) {
  const [mode, setMode] = useState('');
  const rules = useClinicRules(row.unit_id);
  const add = useNotices((s) => s.add),
    canEdit = ['ADMIN', 'MANAGEMENT', 'RECEPTION'].includes(role);
  if (!canEdit) return null;
  async function save(operation: string, data: Record<string, any>) {
    await post('operations', {
      operation,
      unit_id: row.unit_id,
      appointment_id: row.id,
      version: row.version,
      ...data,
    });
    add('Registro salvo.');
    onSaved();
    onClose();
  }
  return (
    <div className="sub-card">
      <div className="actions wrap">
        {['SCHEDULED', 'ARRIVED'].includes(row.status) && (
          <Button variant="secondary" onClick={() => setMode('reschedule')}>
            Remarcar sessão
          </Button>
        )}
        {row.status === 'COMPLETED' && (!row.contested_at || row.contest_resolved_at) && (
          <Button variant="danger" onClick={() => setMode('contest')}>
            Registrar contestação
          </Button>
        )}
      </div>
      {mode === 'contest' && (
        <SchemaForm
          schema={z.object({ reason: z.string().min(10) })}
          fields={[{ name: 'reason', label: 'Motivo informado pela família', type: 'textarea' }]}
          defaults={{ reason: '' }}
          label="Confirmar contestação e bloquear"
          onSubmit={(d) => save('CONTEST', d)}
        />
      )}
      {mode === 'reschedule' && (
        <SchemaForm
          schema={z
            .object({
              professional_id: z.uuid(),
              local_start: z.string().min(16),
              duration: z.coerce.number().int().min(15).max(rules.max_home_duration),
              reason: z.string().min(10),
            })
            .transform(({ local_start, ...v }) => ({
              ...v,
              starts_at: fromLocalInput(local_start, viewTimezone()).toISOString(),
            }))}
          fields={[
            {
              name: 'professional_id',
              label: 'Profissional para remarcação',
              type: 'directory',
              directoryKind: 'professionals',
              unitId: row.unit_id,
            },
            {
              name: 'local_start',
              label: 'Novo horário (horário da unidade)',
              type: 'datetime-local',
            },
            {
              name: 'duration',
              label: 'Duração da sessão',
              type: 'select',
              options: Array.from(
                {
                  length: Math.floor(
                    (row.location === 'HOME'
                      ? rules.max_home_duration
                      : rules.max_clinic_duration) / rules.slot_minutes,
                  ),
                },
                (_, i) => (i + 1) * rules.slot_minutes,
              ).map((m) => ({ value: String(m), label: m + ' minutos' })),
            },
            { name: 'reason', label: 'Justificativa da remarcação', type: 'textarea' },
          ]}
          defaults={{
            professional_id: row.professional_id,
            duration: Math.round(
              (new Date(row.ends_at).getTime() - new Date(row.starts_at).getTime()) / 60000,
            ),
            local_start: '',
            reason: '',
          }}
          label="Confirmar remarcação"
          onSubmit={(d) => save('RESCHEDULE', d)}
        />
      )}
    </div>
  );
}
