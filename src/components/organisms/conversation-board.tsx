'use client';
import { useState, useEffect } from 'react';
import { z } from 'zod';
import { api, post } from '@/lib/client';
import { type Entity } from '@/lib/types';
import { useNotices } from '@/stores/workspace';
import { Button } from '../atoms/button';
import { Badge } from '../atoms/badge';
import { Dialog } from '../molecules/dialog';
import { SchemaForm } from './schema-form';
export function ConversationBoard({
  rows,
  onSaved,
  unitId,
}: {
  rows: Entity[];
  onSaved: () => void;
  unitId: string;
}) {
  const [selected, setSelected] = useState<string | null>(null),
    [conversation, setConversation] = useState<Entity | null>(null),
    [message, setMessage] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [transfer, setTransfer] = useState(false);
  const add = useNotices((s) => s.add);
  const [filters, setFilters] = useState({ q: '', priority: '', channel: '', stage: '' }),
    [filtered, setFiltered] = useState<Entity[] | null>(null);
  useEffect(() => {
    let active = true;
    const timer = setTimeout(() => {
      api<{ data: Entity[] }>(
        'conversations?' + new URLSearchParams({ unit: unitId, limit: '100', ...filters }),
      )
        .then((r) => {
          if (active) setFiltered(r.data);
        })
        .catch((e) => {
          if (active) setError(e.message);
        });
    }, 250);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [filters, unitId, rows]);
  async function load(id: string) {
    try {
      setConversation(await api<Entity>('conversations/' + id));
      setError('');
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => {
    if (selected) void load(selected);
  }, [selected]);
  return (
    <>
      <div className="note">
        Organize as conversas e os encaminhamentos da equipe. Para testar mensagens, imagens, PDFs e
        agentes de IA, use a aba Sandbox. O envio a números externos depende da conexão do WhatsApp.
      </div>
      <div className="operational-filters">
        <label className="field">
          Buscar família
          <input
            className="input"
            value={filters.q}
            onChange={(e) => setFilters({ ...filters, q: e.target.value })}
          />
        </label>
        <label className="field">
          Prioridade
          <select
            className="input"
            value={filters.priority}
            onChange={(e) => setFilters({ ...filters, priority: e.target.value })}
          >
            <option value="">Todas</option>
            <option value="HIGH">Alta</option>
            <option value="NORMAL">Normal</option>
          </select>
        </label>
        <label className="field">
          Etapa
          <select
            className="input"
            value={filters.stage}
            onChange={(e) => setFilters({ ...filters, stage: e.target.value })}
          >
            <option value="">Todas</option>
            {[
              ['TRIAGE', 'Triagem'],
              ['CLARIFYING', 'Complementando dados'],
              ['PROPOSAL', 'Proposta preparada'],
              ['ACCEPTED', 'Aceita pela família'],
              ['HUMAN', 'Com a equipe'],
              ['COMPLETED', 'Concluída'],
            ].map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="conversation-layout card">
        <aside className="conversation-list">
          {(filtered || rows).map((c) => (
            <button
              key={c.id}
              className={selected === c.id ? 'selected' : ''}
              onClick={() => setSelected(c.id)}
            >
              <div className="actions between">
                <strong>{c.guardian}</strong>
                <Badge value={c.priority} />
              </div>
              <p>{c.summary || 'Atendimento local'}</p>
              <small>
                {c.wait_minutes || 0} min de espera · {c.queue_name || 'Sem fila'}
              </small>
              <Badge value={c.status} />
            </button>
          ))}
        </aside>
        <div className="conversation-main">
          {conversation ? (
            <>
              <div className="conversation-header">
                <div>
                  <h2>{conversation.guardian}</h2>
                  <small>
                    {conversation.assigned_to || 'Sem responsável'} · canal {conversation.channel}
                  </small>
                </div>
                <div className="actions wrap">
                  <a
                    className="button secondary"
                    href={'/buscar-horarios?conversation=' + conversation.id}
                  >
                    Propor horários
                  </a>
                  <Button variant="secondary" onClick={() => setTransfer(true)}>
                    Transferir / priorizar
                  </Button>
                </div>
              </div>
              <div className="messages">
                {conversation.messages.map((m: Entity) => (
                  <div className={'message ' + m.direction.toLowerCase()} key={m.id}>
                    <small>
                      {m.direction === 'INBOUND'
                        ? 'Família'
                        : m.direction === 'SYSTEM'
                          ? 'Sistema'
                          : m.author || 'Equipe'}
                    </small>
                    <p>{m.content}</p>
                    <time>
                      {new Date(m.created_at).toLocaleTimeString('pt-BR', {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </time>
                  </div>
                ))}
              </div>
              <form
                className="message-compose"
                onSubmit={async (e) => {
                  e.preventDefault();
                  if (!message.trim() || busy) return;
                  setBusy(true);
                  try {
                    await post('conversations/' + conversation.id + '/messages', {
                      content: message,
                    });
                    setMessage('');
                    await load(conversation.id);
                    add('Mensagem registrada no canal local.');
                  } catch (e) {
                    setError((e as Error).message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                <label className="sr-only" htmlFor="local-message">
                  Mensagem local
                </label>
                <input
                  id="local-message"
                  className="input"
                  placeholder="Escreva uma mensagem para o histórico local"
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                />
                <Button type="submit" disabled={busy}>
                  Registrar
                </Button>
              </form>
            </>
          ) : (
            <div className="empty">
              <h2>Uma central para toda a equipe</h2>
              <p>Selecione uma conversa para consultar o histórico e organizar o atendimento.</p>
            </div>
          )}
          {error && <div className="error-banner">{error}</div>}
        </div>
      </div>
      {transfer && conversation && (
        <Dialog title="Transferir atendimento" onClose={() => setTransfer(false)}>
          <SchemaForm
            schema={z.object({
              version: z.number(),
              queue_id: z.uuid(),
              assigned_user_id: z.string().default(''),
              priority: z.enum(['NORMAL', 'HIGH']),
              status: z.enum(['HUMAN', 'REVIEW', 'DONE']),
              reason: z.string().min(10),
            })}
            fields={[
              {
                name: 'queue_id',
                label: 'Fila de destino',
                type: 'directory',
                directoryKind: 'queues',
                unitId,
              },
              {
                name: 'assigned_user_id',
                label: 'Responsável da equipe (opcional)',
                type: 'directory',
                directoryKind: 'users',
                unitId,
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
              {
                name: 'status',
                label: 'Etapa',
                type: 'select',
                options: [
                  { value: 'HUMAN', label: 'Com a equipe' },
                  { value: 'REVIEW', label: 'Em revisão' },
                  { value: 'DONE', label: 'Concluído' },
                ],
              },
              { name: 'reason', label: 'Motivo', type: 'textarea' },
            ]}
            defaults={{
              version: conversation.version,
              queue_id: conversation.queue_id || '',
              assigned_user_id: conversation.assigned_user_id || '',
              priority: conversation.priority,
              status: 'HUMAN',
              reason: '',
            }}
            onSubmit={async (d) => {
              await post('conversations/' + conversation.id + '/transfer', d);
              setTransfer(false);
              await load(conversation.id);
              onSaved();
              add('Transferência registrada.');
            }}
          />
        </Dialog>
      )}
    </>
  );
}
