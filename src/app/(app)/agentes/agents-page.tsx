'use client';
import { useState } from 'react';
import { Bot, Plus } from 'lucide-react';
import { canManageClinic } from '@/lib/navigation';
import { Badge } from '@/components/atoms/badge';
import { Button } from '@/components/atoms/button';
import { EditorHost, type EditorState } from '@/components/organisms/editor-host';
import { PageFrame } from '@/components/organisms/page-frame';
import { ArchiveButton, HistoryButton } from '@/components/organisms/record-lifecycle';
import { ScenarioBoard } from '@/components/organisms/scenario-board';
import { useWorkspaceContext } from '@/components/templates/workspace-context';
import { useRecords } from '@/hooks/use-records';

// Agentes de IA da clínica (instruções versionadas) e a biblioteca de cenários de atendimento.
export function AgentsPage() {
  const { unitId, role, lookupsReady, notifyChange } = useWorkspaceContext();
  const agents = useRecords('agents');
  const [editor, setEditor] = useState<EditorState | null>(null);
  const showArchived = agents.filters.archived === 'true';

  return (
    <PageFrame
      section="agentes"
      loading={agents.loading}
      error={agents.error}
      onRetry={agents.reload}
      actions={
        canManageClinic(role) && (
          <Button
            disabled={!lookupsReady || agents.loading}
            onClick={() => setEditor({ resource: 'agents' })}
          >
            <Plus size={17} />
            Novo agente
          </Button>
        )
      }
    >
      <div className="note">
        Agentes persistidos e versionados, usados pelo Sandbox de atendimento. A chave de IA é
        configurada no servidor; os canais externos dependem de conexão com o provedor.
      </div>
      <div className="toolbar">
        <label className="sandbox-consent">
          <input
            type="checkbox"
            checked={showArchived}
            onChange={(e) => agents.setFilter('archived', e.target.checked ? 'true' : '')}
          />
          Mostrar agentes arquivados
        </label>
      </div>
      <div className="agent-flow">
        <span>Conversa da família</span>→<span>Triagem</span>→<span>Agente especializado</span>→
        <span>Revisão humana</span>
      </div>

      <div className="agent-grid">
        {agents.collection.data.map((agent) => (
          <div className="card agent-card" key={agent.id}>
            <div className="actions between">
              <span className="agent-icon">
                <Bot size={23} />
              </span>
              <Badge
                value={agent.enabled ? 'APPROVED' : 'PENDING'}
                label={agent.enabled ? 'Configurado' : 'Pausado'}
              />
            </div>
            <h2>{agent.name}</h2>
            <p>{agent.instructions.slice(0, 150)}</p>
            <small>
              Confiança mínima {agent.confidence_threshold}% · versão {agent.version}
              {agent.use_scenarios ? ' · usa cenários' : ''}
            </small>
            <div className="actions wrap">
              <Button
                variant="secondary"
                onClick={() => setEditor({ resource: 'agents', entity: agent })}
              >
                Configurar agente
              </Button>
              <HistoryButton resource="agents" entity={agent} onRestored={notifyChange} />
              <ArchiveButton resource="agents" entity={agent} onDone={notifyChange} />
            </div>
          </div>
        ))}
      </div>

      <ScenarioBoard unitId={unitId} />
      <EditorHost editor={editor} onClose={() => setEditor(null)} />
    </PageFrame>
  );
}
