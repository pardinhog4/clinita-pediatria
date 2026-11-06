'use client';
import { useState } from 'react';
import { Plus } from 'lucide-react';
import { labels, specialtyOptions } from '@/lib/schemas';
import { currency, type Entity } from '@/lib/types';
import { canManageClinic } from '@/lib/navigation';
import { Badge } from '@/components/atoms/badge';
import { Button } from '@/components/atoms/button';
import type { Column } from '@/components/molecules/data-table';
import { EditorHost, type EditorState } from '@/components/organisms/editor-host';
import { PageFrame } from '@/components/organisms/page-frame';
import { ProfessionalRecord } from '@/components/organisms/professional-record';
import { FilterSelect, RecordsTable } from '@/components/organisms/records-table';
import { useWorkspaceContext } from '@/components/templates/workspace-context';
import { useRecords } from '@/hooks/use-records';

// Equipe da unidade: especialidade, sala, vínculo, competências e repasse.
export function ProfessionalsPage() {
  const { meta, role, unitId, lookups, lookupsReady, notifyChange } = useWorkspaceContext();
  const professionals = useRecords('professionals');
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [professional, setProfessional] = useState<Entity | null>(null);

  const columns: Column[] = [
    { key: 'name', label: 'Profissional', render: (r) => <strong>{r.name}</strong> },
    { key: 'specialty', label: 'Especialidade', render: (r) => labels[r.specialty] },
    {
      key: 'room_id',
      label: 'Sala',
      render: (r) => lookups.rooms.find((x) => x.id === r.room_id)?.name || 'Sala',
    },
    { key: 'contract', label: 'Vínculo', render: (r) => <Badge value={r.contract} /> },
    {
      key: 'competencies',
      label: 'Competências',
      render: (r) => r.competencies.join(' · ') || 'A conferir',
    },
    { key: 'hourly_rate', label: 'Repasse / hora', render: (r) => currency(r.hourly_rate) },
  ];
  // Valor de repasse só aparece para quem tem acesso ao financeiro.
  const visibleColumns = meta.financial ? columns : columns.filter((c) => c.key !== 'hourly_rate');

  return (
    <PageFrame
      section="profissionais"
      loading={professionals.loading}
      error={professionals.error}
      onRetry={professionals.reload}
      actions={
        canManageClinic(role) && (
          <Button
            disabled={!lookupsReady || professionals.loading}
            onClick={() => setEditor({ resource: 'professionals' })}
          >
            <Plus size={17} />
            Cadastrar profissional
          </Button>
        )
      }
    >
      <RecordsTable
        records={professionals}
        columns={visibleColumns}
        onRow={setProfessional}
        filters={
          <>
            <FilterSelect
              records={professionals}
              name="specialty"
              label="Especialidade"
              allLabel="Todas as especialidades"
              options={specialtyOptions()}
            />
            <FilterSelect
              records={professionals}
              name="active"
              label="Vínculo ativo"
              allLabel="Todos"
              options={[
                ['true', 'Ativos'],
                ['false', 'Desligados'],
              ]}
            />
          </>
        }
      />

      {professional && (
        <ProfessionalRecord
          professional={professional}
          unitId={unitId}
          role={role}
          onClose={() => setProfessional(null)}
          onEdit={(entity) => {
            setEditor({ resource: 'professionals', entity });
            setProfessional(null);
          }}
          onSaved={notifyChange}
        />
      )}
      <EditorHost editor={editor} onClose={() => setEditor(null)} />
    </PageFrame>
  );
}
