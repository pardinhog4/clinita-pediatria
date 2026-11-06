'use client';
import { useState } from 'react';
import { Download, Plus } from 'lucide-react';
import { z } from 'zod';
import { post } from '@/lib/client';
import { downloadCsv } from '@/lib/csv';
import { currency, dateLabel, type Entity } from '@/lib/types';
import { useNotices } from '@/stores/workspace';
import { Badge } from '@/components/atoms/badge';
import { Button } from '@/components/atoms/button';
import type { Column } from '@/components/molecules/data-table';
import { Dialog } from '@/components/molecules/dialog';
import { EditorHost, type EditorState } from '@/components/organisms/editor-host';
import { PageFrame } from '@/components/organisms/page-frame';
import { PaymentDialog } from '@/components/organisms/payment-dialog';
import { RecordActions } from '@/components/organisms/record-lifecycle';
import { RecordsTable } from '@/components/organisms/records-table';
import { SchemaForm } from '@/components/organisms/schema-form';
import { useWorkspaceContext } from '@/components/templates/workspace-context';
import { useRecords } from '@/hooks/use-records';

// Contas a pagar e a receber (baixa manual) e controle de estoque de materiais.

type Tab = 'ledger' | 'inventory';

const ledgerColumns: Column[] = [
  {
    key: 'description',
    label: 'Descrição / pessoa',
    render: (r) => (
      <>
        <strong>{r.description}</strong>
        <small>{r.counterparty || r.category}</small>
      </>
    ),
  },
  {
    key: 'kind',
    label: 'Tipo',
    render: (r) => (
      <Badge
        value={r.kind === 'INCOME' ? 'COMPLETED' : 'PENDING'}
        label={r.kind === 'INCOME' ? 'A receber' : 'A pagar'}
      />
    ),
  },
  { key: 'amount', label: 'Valor', render: (r) => <strong>{currency(r.amount)}</strong> },
  { key: 'due_date', label: 'Vencimento', render: (r) => dateLabel(r.due_date) },
  {
    key: 'status',
    label: 'Situação',
    render: (r) => (
      <Badge
        value={r.status}
        label={r.status === 'OPEN' ? 'Em aberto' : r.kind === 'INCOME' ? 'Recebido' : 'Pago'}
      />
    ),
  },
  {
    key: 'actions',
    label: 'Ação',
    render: (r) => (
      <span className="table-link">
        {r.status === 'OPEN' ? 'Registrar baixa' : 'Consultar histórico'} →
      </span>
    ),
  },
];

const inventoryColumns: Column[] = [
  { key: 'name', label: 'Material', render: (r) => <strong>{r.name}</strong> },
  { key: 'quantity', label: 'Quantidade' },
  { key: 'minimum', label: 'Mínimo' },
  {
    key: 'stockstatus',
    label: 'Situação',
    render: (r) => (
      <Badge
        value={r.quantity < r.minimum ? 'PENDING' : 'APPROVED'}
        label={r.quantity < r.minimum ? 'Repor material' : 'Regular'}
      />
    ),
  },
  {
    key: 'actions',
    label: 'Ação',
    render: () => <span className="table-link">Entrada / saída →</span>,
  },
];

const movementSchema = z.object({
  version: z.number(),
  delta: z.coerce
    .number()
    .int()
    .refine((n) => n !== 0, 'Informe quantidade diferente de zero.'),
  reason: z.string().min(10),
});

export function FinancePage() {
  const { meta, role, unitId, lookupsReady, notifyChange } = useWorkspaceContext();
  const add = useNotices((s) => s.add);
  const [tab, setTab] = useState<Tab>('ledger');
  const records = useRecords(tab);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [payment, setPayment] = useState<Entity | null>(null);
  const [movement, setMovement] = useState<Entity | null>(null);

  function exportLedger() {
    downloadCsv(
      'integrar-financeiro-pagina-' + records.page + '.csv',
      ['Descrição', 'Tipo', 'Valor', 'Vencimento', 'Situação'],
      records.collection.data.map((r) => [r.description, r.kind, r.amount, r.due_date, r.status]),
    );
  }

  return (
    <PageFrame
      section="financeiro"
      loading={records.loading}
      error={records.error}
      onRetry={records.reload}
      actions={
        <>
          {tab === 'ledger' && (
            <Button variant="secondary" onClick={exportLedger}>
              <Download size={16} />
              Exportar página CSV
            </Button>
          )}
          {meta.financial && (
            <Button
              disabled={!lookupsReady || records.loading}
              onClick={() => setEditor({ resource: tab })}
            >
              <Plus size={17} />
              {tab === 'ledger' ? 'Novo lançamento' : 'Novo material'}
            </Button>
          )}
        </>
      }
    >
      <div className="note">
        Pagamentos e recebimentos são realizados fora da plataforma. Registre a conferência manual,
        com referência e comprovante opcional.
      </div>
      <div className="tabs">
        <button className={tab === 'ledger' ? 'active' : ''} onClick={() => setTab('ledger')}>
          Lançamentos
        </button>
        <button className={tab === 'inventory' ? 'active' : ''} onClick={() => setTab('inventory')}>
          Estoque
        </button>
      </div>

      <RecordsTable
        records={records}
        columns={tab === 'ledger' ? ledgerColumns : inventoryColumns}
        onRow={tab === 'ledger' ? setPayment : setMovement}
      />

      {payment && (
        <PaymentDialog
          row={payment}
          unitId={unitId}
          onClose={() => setPayment(null)}
          onSaved={notifyChange}
        />
      )}

      {movement && (
        <Dialog title={'Movimentar · ' + movement.name} onClose={() => setMovement(null)}>
          <p className="note">
            Saldo atual: {movement.quantity}. Use quantidade positiva para entrada e negativa para
            saída.
          </p>
          <SchemaForm
            schema={movementSchema}
            fields={[
              { name: 'delta', label: 'Quantidade (+ entrada / − saída)', type: 'number' },
              { name: 'reason', label: 'Justificativa', type: 'textarea' },
            ]}
            defaults={{ version: movement.version, delta: -1, reason: '' }}
            label="Registrar movimentação"
            onSubmit={async (d) => {
              await post('inventory/' + movement.id + '/move', d);
              setMovement(null);
              add('Movimentação registrada.');
              notifyChange();
            }}
          />
          <div className="record-admin">
            <Button
              variant="ghost"
              onClick={() => {
                setEditor({ resource: 'inventory', entity: movement });
                setMovement(null);
              }}
            >
              Editar item
            </Button>
            <RecordActions
              resource="inventory"
              entity={movement}
              role={role}
              onChanged={() => {
                setMovement(null);
                notifyChange();
              }}
            />
          </div>
        </Dialog>
      )}

      <EditorHost editor={editor} onClose={() => setEditor(null)} />
    </PageFrame>
  );
}
