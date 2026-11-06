'use client';
import { useEffect, useRef, useState } from 'react';
import { api, post } from '@/lib/client';
import type { Entity } from '@/lib/types';
import { useNotices } from '@/stores/workspace';
import { DirectorySelect } from '../molecules/directory-select';
import { Badge } from '../atoms/badge';
import { Button } from '../atoms/button';
export function TeamQueue({ unitId }: { unitId: string }) {
  const [rows, setRows] = useState<Entity[]>([]),
    [selected, setSelected] = useState<Entity | null>(null),
    [detail, setDetail] = useState<Entity | null>(null),
    [queue, setQueue] = useState(''),
    [source, setSource] = useState('ALL'),
    [message, setMessage] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const selectedRef = useRef('');
  selectedRef.current = selected?.id || '';
  const add = useNotices((s) => s.add);
  async function load() {
    const r = await api<{ data: Entity[] }>('team-queue?unit=' + unitId);
    setRows(r.data);
  }
  async function refresh(row: Entity) {
    const r = await api<Entity>((row.sandbox ? 'sandbox/' : 'conversations/') + row.id);
    if (selectedRef.current === row.id) setDetail(r);
  }
  useEffect(() => {
    setSelected(null);
    setDetail(null);
    void load().catch((e) => setError(e.message));
    const timer = setInterval(() => void load().catch(() => {}), 5000);
    return () => clearInterval(timer);
  }, [unitId]);
  useEffect(() => {
    setMessage('');
    setDetail(null);
    if (!selected) return;
    void refresh(selected).catch((e) => setError(e.message));
    const timer = setInterval(() => void refresh(selected).catch(() => {}), 4000);
    return () => clearInterval(timer);
  }, [selected?.id]);
  async function control(action: string) {
    if (!detail) return;
    setBusy(true);
    try {
      await post('operations', {
        operation: 'CONVERSATION_CONTROL',
        unit_id: unitId,
        conversation_id: detail.id,
        version: detail.version,
        action,
      });
      await load();
      if (action === 'CLOSE') {
        setSelected(null);
        setDetail(null);
      } else if (selected) await refresh(selected);
      add(action === 'CLOSE' ? 'Atendimento encerrado.' : 'Atendimento assumido.');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const visible = rows.filter(
    (r) =>
      (!queue || r.queue_id === queue) &&
      (source === 'ALL' ||
        (source === 'SANDBOX' && r.sandbox) ||
        (source === 'OPERATIONAL' && !r.sandbox)),
  );
  return (
    <>
      <div className="note">
        Aqui a equipe vê os encaminhamentos da IA e as conversas assumidas. Os atendimentos de teste
        são identificados como Sandbox. Respostas operacionais ficam no histórico local até conectar
        o WhatsApp externo.
      </div>
      <div className="operational-filters">
        <div className="field">
          <label htmlFor="team-queue-filter">Fila da equipe</label>
          <DirectorySelect
            id="team-queue-filter"
            kind="queues"
            unitId={unitId}
            value={queue}
            onChange={setQueue}
          />
        </div>
        <label className="field">
          Origem
          <select className="input" value={source} onChange={(e) => setSource(e.target.value)}>
            <option value="ALL">Operacionais e testes</option>
            <option value="OPERATIONAL">Somente operacionais</option>
            <option value="SANDBOX">Somente Sandbox</option>
          </select>
        </label>
        <Button variant="secondary" onClick={() => void load().catch((e) => setError(e.message))}>
          Atualizar filas
        </Button>
      </div>
      {error && <p className="error-banner">{error}</p>}
      <div className="conversation-layout card">
        <aside className="conversation-list">
          {visible.map((r) => (
            <button
              key={r.id}
              className={selected?.id === r.id ? 'selected' : ''}
              onClick={() => setSelected(r)}
            >
              <strong>{r.guardian}</strong>
              <div className="actions wrap">
                <Badge value="PENDING" label={r.queue_name || 'Sem fila definida'} />
                <Badge
                  value={r.sandbox ? 'CONFIRMED' : 'EMPTY'}
                  label={r.sandbox ? 'Sandbox' : 'Operacional'}
                />
              </div>
              <p>{r.summary || 'Atendimento encaminhado para a equipe.'}</p>
              <small>{r.assigned_user_name || 'Aguardando responsável'}</small>
            </button>
          ))}
          {!visible.length && <div className="empty small">Nenhuma conversa nesta fila.</div>}
        </aside>
        <div className="conversation-main">
          {detail && selected ? (
            <>
              <div className="conversation-header">
                <div>
                  <h2>{detail.guardian}</h2>
                  <small>
                    {selected.queue_name || 'Atendimento da equipe'} ·{' '}
                    {selected.sandbox ? 'Teste Sandbox' : 'Canal operacional'}
                  </small>
                </div>
                <div className="actions wrap">
                  <a
                    className="button secondary"
                    href={'/buscar-horarios?conversation=' + detail.id}
                  >
                    Preparar proposta de horários
                  </a>
                  <Button
                    variant="secondary"
                    disabled={busy}
                    onClick={() => void control('TAKEOVER')}
                  >
                    Assumir atendimento
                  </Button>
                  <Button variant="ghost" disabled={busy} onClick={() => void control('CLOSE')}>
                    Encerrar atendimento
                  </Button>
                </div>
              </div>
              <div className="handoff-summary">
                <strong>Resumo para a equipe</strong>
                <p>{detail.summary || 'Sem resumo registrado.'}</p>
              </div>
              <div className="messages">
                {detail.messages.map((m: Entity) => (
                  <div className={'message ' + m.direction.toLowerCase()} key={m.id}>
                    <small>
                      {m.direction === 'INBOUND'
                        ? 'Família'
                        : m.direction === 'SYSTEM'
                          ? 'Sistema'
                          : m.agent_name || m.author || 'Equipe'}
                    </small>
                    <p>{m.content}</p>
                    {m.attachments?.map((f: Entity) => (
                      <a
                        className="sandbox-file"
                        key={f.id}
                        href={'/api/sandbox/' + detail.id + '/files?attachment=' + f.id}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {f.name}
                      </a>
                    ))}
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
                  if (!message.trim()) return;
                  setBusy(true);
                  try {
                    if (selected.sandbox)
                      await post('sandbox/' + detail.id + '/reply', {
                        request_id: crypto.randomUUID(),
                        direction: 'OUTBOUND',
                        content: message,
                      });
                    else
                      await post('conversations/' + detail.id + '/messages', { content: message });
                    setMessage('');
                    await refresh(selected);
                    await load();
                    add('Resposta da equipe registrada.');
                  } catch (e) {
                    setError((e as Error).message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                <label className="sr-only" htmlFor="team-reply">
                  Resposta da equipe na fila
                </label>
                <input
                  id="team-reply"
                  className="input"
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="Continue o atendimento com o histórico da família…"
                />
                <Button type="submit" disabled={busy || !message.trim() || detail.ai_mode === 'AI'}>
                  Registrar resposta
                </Button>
              </form>
            </>
          ) : (
            <div className="empty">
              <h2>Fila de atendimento da equipe</h2>
              <p>
                Selecione uma conversa para ver o histórico, o resumo e continuar o atendimento.
              </p>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
