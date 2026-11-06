'use client';
import { useState } from 'react';
import { Plus } from 'lucide-react';
import { currency } from '@/lib/types';
import { canManageClinic } from '@/lib/navigation';
import { Badge } from '@/components/atoms/badge';
import { Button } from '@/components/atoms/button';
import type { Column } from '@/components/molecules/data-table';
import { EditorHost, type EditorState } from '@/components/organisms/editor-host';
import { ModelsBoard } from '@/components/organisms/models-board';
import { OperationalSettings } from '@/components/organisms/operational-settings';
import { PageFrame } from '@/components/organisms/page-frame';
import { RecordsTable } from '@/components/organisms/records-table';
import { RegistryBoard } from '@/components/organisms/registry-board';
import { RulesSettings } from '@/components/organisms/rules-settings';
import { ImportBoard } from '@/components/organisms/import-board';
import { useWorkspaceContext } from '@/components/templates/workspace-context';
import { useRecords } from '@/hooks/use-records';

// Cadastros e regras da clínica, separados em abas.

type Tab =
  | 'units'
  | 'specialties'
  | 'competencies'
  | 'queues'
  | 'insurers'
  | 'rooms'
  | 'rules'
  | 'import'
  | 'models'
  | 'automations'
  | 'channels'
  | 'templates';

const tabs: [Tab, string][] = [
  ['units', 'Unidades'],
  ['specialties', 'Especialidades'],
  ['competencies', 'Competências'],
  ['queues', 'Filas de atendimento'],
  ['insurers', 'Planos e regras'],
  ['rooms', 'Salas e capacidade'],
  ['rules', 'Horários e regras'],
  ['import', 'Importar dados'],
  ['models', 'Modelos clínicos'],
  ['automations', 'Automações'],
  ['channels', 'Canais'],
  ['templates', 'Modelos de mensagem'],
];

const statusColumn = (active: string, inactive: string): Column => ({
  key: 'active',
  label: 'Situação',
  render: (r) =>
    r.active === false ? (
      <Badge value="neutral" label={inactive} />
    ) : (
      <Badge value="COMPLETED" label={active} />
    ),
});

const insurerColumns: Column[] = [
  { key: 'name', label: 'Operadora', render: (r) => <strong>{r.name}</strong> },
  { key: 'duration', label: 'Duração', render: (r) => r.rules.duration + ' min' },
  {
    key: 'token',
    label: 'Autorização',
    render: (r) => (r.rules.token_required ? 'Token por sessão' : 'Conferência manual'),
  },
  {
    key: 'signature',
    label: 'Guia',
    render: (r) => (r.rules.signature_required ? 'Assinatura obrigatória' : 'Conforme contrato'),
  },
  { key: 'value', label: 'Valor', render: (r) => currency(r.rules.session_value) },
  statusColumn('Ativo', 'Desativado'),
];

const roomColumns: Column[] = [
  { key: 'name', label: 'Sala' },
  { key: 'capacity', label: 'Capacidade simultânea' },
  { key: 'version', label: 'Versão' },
  statusColumn('Ativa', 'Desativada'),
];

export function SettingsPage() {
  const { unitId, role, lookupsReady } = useWorkspaceContext();
  const [tab, setTab] = useState<Tab>('insurers');
  const [editor, setEditor] = useState<EditorState | null>(null);
  const tableResource = tab === 'insurers' || tab === 'rooms' ? tab : null;
  const records = useRecords(tableResource);

  return (
    <PageFrame
      section="configuracoes"
      loading={records.loading}
      error={records.error}
      onRetry={records.reload}
      actions={
        tableResource &&
        canManageClinic(role) && (
          <Button
            disabled={!lookupsReady || records.loading}
            onClick={() => setEditor({ resource: tableResource })}
          >
            <Plus size={17} />
            Novo registro
          </Button>
        )
      }
    >
      <div className="tabs">
        {tabs.map(([key, label]) => (
          <button key={key} className={tab === key ? 'active' : ''} onClick={() => setTab(key)}>
            {label}
          </button>
        ))}
      </div>

      {(tab === 'units' || tab === 'specialties' || tab === 'competencies' || tab === 'queues') && (
        <RegistryBoard key={tab + unitId} kind={tab} unitId={unitId} />
      )}
      {tableResource && (
        <RecordsTable
          records={records}
          columns={tableResource === 'insurers' ? insurerColumns : roomColumns}
          onRow={(row) => setEditor({ resource: tableResource, entity: row })}
        />
      )}
      {tab === 'rules' && <RulesSettings key={unitId} />}
      {tab === 'import' && <ImportBoard />}
      {tab === 'models' && <ModelsBoard />}
      {(tab === 'automations' || tab === 'channels' || tab === 'templates') && (
        <OperationalSettings unitId={unitId} tab={tab} />
      )}

      <EditorHost editor={editor} onClose={() => setEditor(null)} />
    </PageFrame>
  );
}
