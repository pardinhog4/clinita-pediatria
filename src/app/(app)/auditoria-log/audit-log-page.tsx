'use client';
import { useState } from 'react';
import type { Entity } from '@/lib/types';
import type { Column } from '@/components/molecules/data-table';
import { Dialog } from '@/components/molecules/dialog';
import { PageFrame } from '@/components/organisms/page-frame';
import { FilterSelect, RecordsTable } from '@/components/organisms/records-table';
import { useRecords } from '@/hooks/use-records';

// Registro de todas as ações feitas na plataforma: quem, quando, o quê e em qual registro.

const columns: Column[] = [
  { key: 'actor_name', label: 'Quem' },
  {
    key: 'created_at',
    label: 'Quando',
    render: (r) => new Date(r.created_at).toLocaleString('pt-BR'),
  },
  { key: 'action', label: 'Ação' },
  { key: 'entity_type', label: 'Recurso' },
  { key: 'entity_id', label: 'Identificador' },
];

const entityTypes = [
  'appointments',
  'patients',
  'professionals',
  'insurers',
  'conversations',
  'clinical',
  'ledger',
  'billing_batches',
  'payout_reviews',
  'platform',
];

export function AuditLogPage() {
  const audit = useRecords('audit');
  const [detail, setDetail] = useState<Entity | null>(null);

  return (
    <PageFrame
      section="auditoria-log"
      loading={audit.loading}
      error={audit.error}
      onRetry={audit.reload}
    >
      <RecordsTable
        records={audit}
        columns={columns}
        onRow={setDetail}
        filters={
          <>
            {[
              ['from', 'Data inicial'],
              ['to', 'Data final'],
            ].map(([key, label]) => (
              <label className="field" key={key}>
                {label}
                <input
                  type="date"
                  className="input"
                  value={audit.filters[key] || ''}
                  onChange={(e) => audit.setFilter(key, e.target.value)}
                />
              </label>
            ))}
            <FilterSelect
              records={audit}
              name="entity_type"
              label="Recurso"
              allLabel="Todos os recursos"
              options={entityTypes.map((v) => [v, v])}
            />
          </>
        }
      />

      {detail && (
        <Dialog title="Detalhes do registro de auditoria" onClose={() => setDetail(null)} wide>
          <div className="evidence-grid">
            <div>
              <small>Quando</small>
              {new Date(detail.created_at).toLocaleString('pt-BR')}
            </div>
            <div>
              <small>Quem</small>
              {detail.actor_name}
            </div>
            <div>
              <small>Ação</small>
              {detail.action}
            </div>
          </div>
          <p className="small">
            {detail.entity_type} · {detail.entity_id || 'Registro geral'}
          </p>
          <pre className="audit-json">{JSON.stringify(detail.details, null, 2)}</pre>
        </Dialog>
      )}
    </PageFrame>
  );
}
