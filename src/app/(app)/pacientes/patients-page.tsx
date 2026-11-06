'use client';
import { useState } from 'react';
import { Plus } from 'lucide-react';
import { labels, specialtyOptions } from '@/lib/schemas';
import { dateLabel, type Entity } from '@/lib/types';
import { canOperateFrontDesk } from '@/lib/navigation';
import { Button } from '@/components/atoms/button';
import type { Column } from '@/components/molecules/data-table';
import { EditorHost, type EditorState } from '@/components/organisms/editor-host';
import { PageFrame } from '@/components/organisms/page-frame';
import { PatientRecord } from '@/components/organisms/patient-record';
import { FilterSelect, RecordsTable } from '@/components/organisms/records-table';
import { useWorkspaceContext } from '@/components/templates/workspace-context';
import { useRecords } from '@/hooks/use-records';

// Lista de pacientes da unidade, com filtros e acesso ao prontuário.
export function PatientsPage() {
  const { meta, role, lookups, lookupsReady, notifyChange } = useWorkspaceContext();
  const patients = useRecords('patients');
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [patient, setPatient] = useState<Entity | null>(null);

  const columns: Column[] = [
    {
      key: 'name',
      label: 'Paciente',
      render: (r) => (
        <div className="identity">
          <span className="avatar">
            {r.name
              .split(' ')
              .slice(0, 2)
              .map((v: string) => v[0])
              .join('')}
          </span>
          <div>
            <strong>{r.name}</strong>
            <small>{dateLabel(r.birth_date)}</small>
          </div>
        </div>
      ),
    },
    {
      key: 'guardian',
      label: 'Responsável',
      render: (r) => (
        <>
          <span>{r.guardian}</span>
          <small>{r.phone}</small>
        </>
      ),
    },
    {
      key: 'insurer_id',
      label: 'Convênio',
      render: (r) => lookups.insurers.find((i) => i.id === r.insurer_id)?.name || 'Convênio',
    },
    {
      key: 'metadata',
      label: 'Especialidades',
      render: (r) => (
        <div className="tags">
          {r.metadata.specialties?.map((v: string) => (
            <span className="tag" key={v}>
              {labels[v] || v}
            </span>
          ))}
        </div>
      ),
    },
    {
      key: 'order',
      label: 'Pedido válido até',
      render: (r) =>
        r.metadata.order_expires ? dateLabel(r.metadata.order_expires) : 'Não informado',
    },
  ];

  return (
    <PageFrame
      section="pacientes"
      loading={patients.loading}
      error={patients.error}
      onRetry={patients.reload}
      actions={
        canOperateFrontDesk(role) && (
          <Button
            disabled={!lookupsReady || patients.loading}
            onClick={() => setEditor({ resource: 'patients' })}
          >
            <Plus size={17} />
            Cadastrar paciente
          </Button>
        )
      }
    >
      <RecordsTable
        records={patients}
        columns={columns}
        onRow={setPatient}
        filters={
          <>
            <FilterSelect
              records={patients}
              name="specialty"
              label="Especialidade"
              allLabel="Todas as especialidades"
              options={specialtyOptions()}
            />
            <FilterSelect
              records={patients}
              name="insurer_id"
              label="Convênio"
              allLabel="Todos os convênios"
              options={lookups.insurers.map((i) => [i.id, i.name])}
            />
            <FilterSelect
              records={patients}
              name="active"
              label="Situação"
              allLabel="Todos"
              options={[
                ['true', 'Em atendimento'],
                ['false', 'Com alta'],
              ]}
            />
          </>
        }
      />

      {patient && (
        <PatientRecord
          patient={patient}
          role={role}
          units={meta.units}
          onClose={() => setPatient(null)}
          onEdit={() => {
            setEditor({ resource: 'patients', entity: patient });
            setPatient(null);
          }}
          onChanged={notifyChange}
        />
      )}
      <EditorHost editor={editor} onClose={() => setEditor(null)} />
    </PageFrame>
  );
}
