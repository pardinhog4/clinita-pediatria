'use client';
import { useClinicRules } from '@/hooks/use-clinic-rules';
import { useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import {
  Bot,
  Plus,
  Paperclip,
  FileText,
  Image as ImageIcon,
  Send,
  UserRound,
  RefreshCw,
  Pause,
  Play,
  ArrowRightLeft,
  CheckCircle2,
  AlertCircle,
  X,
} from 'lucide-react';
import { api, post } from '@/lib/client';
import type { Entity } from '@/lib/types';
import { useNotices } from '@/stores/workspace';
import { SandboxSession } from '../molecules/sandbox-session';
import { ReferralPlan } from '../molecules/referral-plan';
import { Dialog } from '../molecules/dialog';
import { DirectorySelect } from '../molecules/directory-select';
import { Button } from '../atoms/button';
import { Badge } from '../atoms/badge';
import { SchemaForm } from './schema-form';
type Configuration = {
  provider: string;
  model: string;
  configured: boolean;
  worker_online: boolean;
  max_file_mb: number;
  max_pdf_pages: number;
};
const runLabels: Record<string, string> = {
  QUEUED: 'Na fila de análise',
  RUNNING: 'IA analisando',
  COMPLETED: 'Análise concluída',
  FAILED: 'Análise não concluída',
  CANCELLED: 'Análise interrompida',
};
export function SandboxBoard({ unitId, clinical }: { unitId: string; clinical: boolean }) {
  const { upload_max_mb, upload_max_pages } = useClinicRules();
  const [sessions, setSessions] = useState<Entity[]>([]),
    [configuration, setConfiguration] = useState<Configuration | null>(null),
    [selected, setSelected] = useState(''),
    [detail, setDetail] = useState<Entity | null>(null),
    [create, setCreate] = useState(false),
    [patientId, setPatientId] = useState(''),
    [consent, setConsent] = useState(false),
    [includeClinical, setIncludeClinical] = useState(false),
    [content, setContent] = useState(''),
    [files, setFiles] = useState<Entity[]>([]),
    [agentId, setAgentId] = useState(''),
    [speaker, setSpeaker] = useState('family'),
    [busy, setBusy] = useState(false),
    [uploading, setUploading] = useState(false),
    [error, setError] = useState(''),
    [transfer, setTransfer] = useState(false),
    [traceRun, setTraceRun] = useState(''),
    [deleteTarget, setDeleteTarget] = useState<Entity | null>(null);
  const requestRef = useRef<{ key: string; id: string } | null>(null);
  const selectedRef = useRef(selected),
    scrollRef = useRef<HTMLDivElement>(null);
  selectedRef.current = selected;
  const add = useNotices((s) => s.add);
  async function loadSessions() {
    const result = await api<{ data: Entity[]; configuration: Configuration }>(
      'sandbox?unit=' + unitId,
    );
    setSessions(result.data);
    setConfiguration(result.configuration);
  }
  async function loadSession(id: string) {
    const result = await api<Entity>('sandbox/' + id);
    if (selectedRef.current === id) {
      setDetail(result);
      setTraceRun((current) => current || result.runs[0]?.id || '');
    }
    return result;
  }
  useEffect(() => {
    setSelected('');
    setDetail(null);
    setFiles([]);
    setError('');
    loadSessions().catch((e) => setError(e.message));
  }, [unitId]);
  useEffect(() => {
    if (!selected) return;
    let active = true;
    const refresh = async () => {
      try {
        await loadSession(selected);
        if (active) await loadSessions();
      } catch (e) {
        if (active) setError((e as Error).message);
      }
    };
    void refresh();
    const timer = setInterval(refresh, 2500);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [selected, unitId]);
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [detail?.messages?.length]);
  const activeRun = detail?.runs?.find((r: Entity) => ['QUEUED', 'RUNNING'].includes(r.status)),
    latest = detail?.runs?.[0],
    run = detail?.runs?.find((r: Entity) => r.id === traceRun) || latest;
  const canCall = !!configuration?.configured && !!configuration.worker_online;
  async function control(action: string) {
    if (!detail) return;
    setBusy(true);
    try {
      await post('sandbox/' + selected + '/control', { version: detail.version, action });
      await loadSession(selected);
      await loadSessions();
      setError('');
      if (action === 'reset') {
        setFiles([]);
        setContent('');
        setTraceRun('');
      }
      add(action === 'takeover' ? 'Você assumiu o atendimento.' : 'Controle atualizado.');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function send() {
    if (!detail || busy) return;
    setBusy(true);
    setError('');
    const requestKey = JSON.stringify({
      selected,
      content,
      files: files.map((f) => f.id),
      speaker,
      agentId,
      mode: detail.ai_mode,
    });
    if (requestRef.current?.key !== requestKey)
      requestRef.current = { key: requestKey, id: crypto.randomUUID() };
    const requestId = requestRef.current.id;
    try {
      if (detail.ai_mode === 'HUMAN') {
        if (files.length)
          throw Error('Remova os anexos pendentes ou devolva para a IA para analisá-los.');
        await post('sandbox/' + selected + '/reply', {
          request_id: requestId,
          direction: speaker === 'team' ? 'OUTBOUND' : 'INBOUND',
          content,
        });
      } else {
        const queued = await post<Entity>('sandbox/' + selected + '/messages', {
          request_id: requestId,
          content,
          attachment_ids: files.map((f) => f.id),
          ...(agentId ? { agent_id: agentId } : {}),
        });
        setTraceRun(queued.id);
      }
      requestRef.current = null;
      setContent('');
      setFiles([]);
      await loadSession(selected);
      await loadSessions();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function attach(fileList: FileList | null) {
    if (!fileList) return;
    setUploading(true);
    setError('');
    try {
      if (files.length + fileList.length > 3) throw Error('Anexe até três arquivos por mensagem.');
      const uploaded: Entity[] = [];
      for (const file of Array.from(fileList)) {
        if (file.size > upload_max_mb * 1048576)
          throw Error(`Cada arquivo deve ter até ${upload_max_mb} MB.`);
        const form = new FormData();
        form.set('file', file);
        uploaded.push(
          await api<Entity>('sandbox/' + selected + '/attachments', { method: 'POST', body: form }),
        );
      }
      setFiles((old) => [...old, ...uploaded]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setUploading(false);
    }
  }
  return (
    <div className="sandbox">
      <div className="sandbox-intro">
        <div>
          <span className="eyebrow">LABORATÓRIO DE ATENDIMENTO</span>
          <h2>Teste a conversa, acompanhe cada ação.</h2>
          <p>
            Simule a família enviando mensagens, imagens e PDFs. A IA consulta os cadastros e
            encaminha o que precisa de revisão.
          </p>
        </div>
        <Button
          onClick={() => {
            setCreate(true);
            setConsent(false);
            setPatientId('');
            setIncludeClinical(false);
          }}
        >
          <Plus size={16} />
          Nova sessão de teste
        </Button>
      </div>
      <div className="sandbox-status">
        <span>
          <Bot size={16} />
          {configuration?.provider === 'gemini' ? 'Gemini' : 'OpenAI'} ·{' '}
          {configuration?.model || 'modelo a configurar'}
        </span>
        <Badge
          value={configuration?.configured ? 'APPROVED' : 'PENDING'}
          label={configuration?.configured ? 'Chave configurada' : 'Chave não configurada'}
        />
        <Badge
          value={configuration?.worker_online ? 'APPROVED' : 'PENDING'}
          label={configuration?.worker_online ? 'Executor conectado' : 'Executor desconectado'}
        />
        <Button variant="ghost" onClick={() => loadSessions().catch((e) => setError(e.message))}>
          <RefreshCw size={14} />
          Verificar
        </Button>
      </div>
      {!configuration?.configured && (
        <div className="note">
          A IA ainda não foi configurada no servidor. Peça ao responsável técnico para cadastrar a
          chave do provedor de IA. Nenhuma resposta simulada é apresentada como IA real.
        </div>
      )}
      {configuration?.configured && !configuration.worker_online && (
        <div className="note">
          O executor de IA está parado. Peça ao responsável técnico para iniciá-lo; as mensagens
          ficam na fila até lá.
        </div>
      )}
      {error && (
        <div className="error-banner" role="alert">
          {error}
          <Button variant="ghost" aria-label="Fechar aviso" onClick={() => setError('')}>
            <X size={14} />
          </Button>
        </div>
      )}
      <div className="sandbox-layout">
        <aside className="sandbox-sessions card">
          <div className="sandbox-panel-title">
            <h3>Sessões de teste</h3>
            <small>{sessions.length} conversas</small>
          </div>
          {sessions.map((s) => (
            <SandboxSession
              key={s.id}
              selected={selected === s.id}
              onDelete={() => setDeleteTarget(s)}
              onSelect={() => {
                setSelected(s.id);
                setTraceRun('');
                setFiles([]);
                setError('');
                setContent('');
              }}
            >
              <strong>{s.guardian}</strong>
              <small>{s.summary || 'Novo atendimento de teste'}</small>
              <div className="actions">
                <Badge
                  value={s.ai_mode === 'AI' ? 'APPROVED' : 'PENDING'}
                  label={s.ai_mode === 'AI' ? 'IA no controle' : 'Equipe no controle'}
                />
              </div>
              {s.queue_name && <small>Fila: {s.queue_name}</small>}
            </SandboxSession>
          ))}
          {!sessions.length && <div className="empty small">Crie uma sessão para começar.</div>}
        </aside>
        <div className="sandbox-chat card">
          {detail ? (
            <>
              <div className="sandbox-chat-header">
                <div>
                  <h3>{detail.guardian}</h3>
                  <small>
                    {detail.patient_id
                      ? 'Paciente vinculado ao cadastro'
                      : 'Contato fictício sem vínculo'}{' '}
                    ·{' '}
                    {detail.include_clinical_context
                      ? 'Prontuário autorizado'
                      : 'Sem acesso ao prontuário'}
                  </small>
                </div>
                <Badge
                  value={detail.ai_mode === 'AI' ? 'APPROVED' : 'PENDING'}
                  label={detail.ai_mode === 'AI' ? 'IA ativa' : 'Atendimento humano'}
                />
              </div>
              <div className="sandbox-controls">
                <Button
                  variant="secondary"
                  disabled={busy}
                  onClick={() => void control(detail.ai_mode === 'AI' ? 'takeover' : 'resume')}
                >
                  {detail.ai_mode === 'AI' ? <Pause size={13} /> : <Play size={13} />}{' '}
                  {detail.ai_mode === 'AI' ? 'Assumir atendimento' : 'Devolver para IA'}
                </Button>
                <Button variant="ghost" disabled={busy} onClick={() => setTransfer(true)}>
                  <ArrowRightLeft size={13} />
                  Transferir
                </Button>
                <Button variant="ghost" disabled={busy} onClick={() => void control('reset')}>
                  Reiniciar contexto
                </Button>
              </div>
              <div className="sandbox-messages" ref={scrollRef}>
                {detail.messages.map((m: Entity) => (
                  <div className={'message ' + m.direction.toLowerCase()} key={m.id}>
                    <small>
                      {m.direction === 'INBOUND'
                        ? 'Família'
                        : m.direction === 'SYSTEM'
                          ? 'Sistema'
                          : m.agent_name || 'Equipe'}
                    </small>
                    <p>{m.content}</p>
                    {m.attachments?.map((f: Entity) => (
                      <a
                        className="sandbox-file"
                        key={f.id}
                        href={'/api/sandbox/' + selected + '/files?attachment=' + f.id}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {f.mime === 'application/pdf' ? (
                          <FileText size={16} />
                        ) : (
                          <ImageIcon size={16} />
                        )}{' '}
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
                {!detail.messages.length && (
                  <div className="empty">
                    <MessagePlaceholder />
                    <h3>A primeira mensagem começa aqui</h3>
                    <p>Ex.: “Preciso de fono para meu filho. Posso enviar o pedido médico?”</p>
                  </div>
                )}
                {activeRun && (
                  <div className="sandbox-thinking">
                    <RefreshCw size={15} className="spin" />
                    {runLabels[activeRun.status]}…
                  </div>
                )}
              </div>
              {detail.queue_name && (
                <div className="sandbox-handoff">
                  <ArrowRightLeft size={16} />
                  <span>
                    Encaminhado para <strong>{detail.queue_name}</strong>. A IA está pausada.
                  </span>
                  <a href="#filas" className="button secondary">
                    Ver fila da equipe
                  </a>
                </div>
              )}
              <div className="sandbox-composer">
                <div className="sandbox-composer-options">
                  {detail.ai_mode === 'AI' ? (
                    <>
                      <label htmlFor="sandbox-agent">Agente</label>
                      <select
                        id="sandbox-agent"
                        className="input"
                        value={agentId}
                        onChange={(e) => setAgentId(e.target.value)}
                      >
                        <option value="">Orquestração automática</option>
                        {detail.agents
                          .filter((a: Entity) => a.enabled)
                          .map((a: Entity) => (
                            <option value={a.id} key={a.id}>
                              {a.name} · v{a.version}
                            </option>
                          ))}
                      </select>
                    </>
                  ) : (
                    <>
                      <label htmlFor="sandbox-speaker">Escrever como</label>
                      <select
                        id="sandbox-speaker"
                        className="input"
                        value={speaker}
                        onChange={(e) => setSpeaker(e.target.value)}
                      >
                        <option value="family">Família</option>
                        <option value="team">Equipe humana</option>
                      </select>
                    </>
                  )}
                </div>
                {files.length > 0 && (
                  <div className="sandbox-pending-files">
                    {files.map((f) => (
                      <span className="sandbox-file" key={f.id}>
                        <Paperclip size={13} />
                        {f.name}
                        <button
                          aria-label={'Remover ' + f.name}
                          onClick={() => setFiles((old) => old.filter((x) => x.id !== f.id))}
                        >
                          <X size={13} />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void send();
                  }}
                >
                  <label className="sr-only" htmlFor="sandbox-message">
                    Mensagem da simulação
                  </label>
                  <textarea
                    id="sandbox-message"
                    className="input"
                    rows={3}
                    value={content}
                    onChange={(e) => setContent(e.target.value)}
                    placeholder={
                      detail.ai_mode === 'AI'
                        ? 'Escreva como se fosse a família no WhatsApp…'
                        : 'Mensagem para o atendimento humano…'
                    }
                  />
                  <div className="actions between">
                    <div className="actions">
                      <label className="button secondary" htmlFor="sandbox-file">
                        <Paperclip size={15} />
                        {uploading ? 'Enviando…' : 'Anexar imagem / PDF'}
                      </label>
                      <input
                        id="sandbox-file"
                        className="sr-only"
                        type="file"
                        multiple
                        accept="application/pdf,image/png,image/jpeg,image/webp"
                        disabled={uploading || busy || !!activeRun}
                        onChange={(e) => {
                          void attach(e.target.files);
                          e.target.value = '';
                        }}
                      />
                      <small>
                        Até {upload_max_mb} MB · PDF até {upload_max_pages} páginas
                      </small>
                    </div>
                    <Button
                      type="submit"
                      disabled={
                        busy ||
                        uploading ||
                        !!activeRun ||
                        (!content.trim() && !files.length) ||
                        (detail.ai_mode === 'AI' && !canCall)
                      }
                    >
                      <Send size={14} />
                      {detail.ai_mode === 'AI' ? 'Enviar para IA' : 'Registrar mensagem'}
                    </Button>
                  </div>
                </form>
              </div>
            </>
          ) : (
            <div className="empty sandbox-empty">
              <Bot size={36} />
              <h2>Uma conversa real com a sua IA</h2>
              <p>
                Selecione uma sessão ou inicie um novo teste. Mensagens, análises e encaminhamentos
                ficam salvos.
              </p>
            </div>
          )}
        </div>
        <aside className="sandbox-execution card">
          <div className="sandbox-panel-title">
            <h3>Painel de execução</h3>
            <small>Ferramentas, evidências e encaminhamento</small>
          </div>
          {detail?.plan && <ReferralPlan plan={detail.plan} />}
          {detail && detail.runs?.length > 0 ? (
            <>
              <label htmlFor="sandbox-run" className="sr-only">
                Análise
              </label>
              <select
                className="input"
                id="sandbox-run"
                value={run?.id || ''}
                onChange={(e) => setTraceRun(e.target.value)}
              >
                {detail.runs.map((r: Entity) => (
                  <option value={r.id} key={r.id}>
                    {new Date(r.created_at).toLocaleTimeString('pt-BR')} · {runLabels[r.status]}
                  </option>
                ))}
              </select>
              <div className="sandbox-run-summary">
                <Badge
                  value={
                    run.status === 'COMPLETED'
                      ? 'APPROVED'
                      : run.status === 'FAILED'
                        ? 'REJECTED'
                        : 'PENDING'
                  }
                  label={runLabels[run.status]}
                />
                <small>
                  {run.provider} · {run.model}
                </small>
                <small>
                  {run.input_tokens} tokens de entrada · {run.output_tokens} de saída
                </small>
              </div>
              {run.error_message && <div className="error-banner small">{run.error_message}</div>}
              {run.status === 'FAILED' && (
                <Button
                  variant="secondary"
                  disabled={!canCall || !!activeRun || detail.ai_mode !== 'AI' || busy}
                  onClick={async () => {
                    setBusy(true);
                    try {
                      const queued = await post<Entity>('sandbox/' + selected + '/messages', {
                        request_id: crypto.randomUUID(),
                        retry_run_id: run.id,
                      });
                      setTraceRun(queued.id);
                      await loadSession(selected);
                    } catch (e) {
                      setError((e as Error).message);
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  Repetir análise
                </Button>
              )}
              {run.decision && (
                <div className="sandbox-decision">
                  <h3>Resumo operacional</h3>
                  <p>{run.decision.summary}</p>
                  <small>Confiança declarada: {Math.round(run.decision.confidence * 100)}%</small>
                  {run.decision.missing_information.length > 0 && (
                    <>
                      <strong>Pendências</strong>
                      <ul>
                        {run.decision.missing_information.map((v: string) => (
                          <li key={v}>{v}</li>
                        ))}
                      </ul>
                    </>
                  )}
                  {run.decision.evidence.map((e: any, i: number) => (
                    <div key={i} className="sandbox-evidence">
                      <FileText size={14} />
                      <p>
                        {e.excerpt}
                        <small>
                          {e.page ? 'Página ' + e.page : 'Imagem / anexo'} · extração da IA,
                          conferir documento
                        </small>
                      </p>
                    </div>
                  ))}
                </div>
              )}
              <div className="sandbox-traces">
                {run.trace.map((e: any, i: number) => (
                  <details key={i}>
                    <summary>
                      <CheckCircle2 size={13} />
                      {e.title}
                    </summary>
                    <pre>{JSON.stringify(e.data, null, 2)}</pre>
                  </details>
                ))}
              </div>
            </>
          ) : (
            <div className="empty small">
              <Bot size={28} />
              <p>As ações aparecerão aqui quando a análise começar.</p>
            </div>
          )}
        </aside>
      </div>
      {deleteTarget && (
        <Dialog
          title="Excluir conversa"
          onClose={() => {
            if (!busy) setDeleteTarget(null);
          }}
        >
          <p>
            Excluir a conversa de {deleteTarget.guardian} da lista de testes? A IA será
            interrompida. O histórico será preservado para auditoria.
          </p>
          <div className="form-footer">
            <Button variant="secondary" disabled={busy} onClick={() => setDeleteTarget(null)}>
              Cancelar
            </Button>
            <Button
              variant="danger"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await api('sandbox/' + deleteTarget.id, { method: 'DELETE' });
                  if (selectedRef.current === deleteTarget.id) {
                    selectedRef.current = '';
                    setSelected('');
                    setDetail(null);
                    setFiles([]);
                    setContent('');
                    setTraceRun('');
                    requestRef.current = null;
                  }
                  setDeleteTarget(null);
                  await loadSessions();
                  setError('');
                  add('Conversa excluída.');
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy ? 'Excluindo…' : 'Excluir conversa'}
            </Button>
          </div>
        </Dialog>
      )}
      {create && (
        <Dialog title="Nova sessão de teste" onClose={() => setCreate(false)}>
          <form
            className="form"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setError('');
              try {
                const conv = await post<Entity>('sandbox', {
                  unit_id: unitId,
                  ...(patientId ? { patient_id: patientId } : {}),
                  consent,
                  include_clinical_context: includeClinical && !!patientId,
                });
                setCreate(false);
                setSelected(conv.id);
                setTraceRun('');
                await loadSessions();
                add('Sessão criada. Você já pode testar a conversa.');
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <div className="field">
              <label htmlFor="sandbox-patient">Paciente / responsável (opcional)</label>
              <DirectorySelect
                id="sandbox-patient"
                kind="patients"
                unitId={unitId}
                value={patientId}
                onChange={setPatientId}
              />
              <small>Sem seleção, será usado um contato fictício sem vínculo com prontuário.</small>
            </div>
            {clinical && (
              <label className="sandbox-consent">
                <input
                  type="checkbox"
                  checked={includeClinical}
                  disabled={!patientId}
                  onChange={(e) => setIncludeClinical(e.target.checked)}
                />
                Incluir o contexto clínico autorizado deste paciente
              </label>
            )}
            <label className="sandbox-consent">
              <input
                type="checkbox"
                checked={consent}
                onChange={(e) => setConsent(e.target.checked)}
              />
              Usarei dados fictícios e autorizo o envio dos anexos e do contexto selecionado ao
              provedor de IA durante o teste.
            </label>
            <div className="form-footer">
              <small>Sessão separada do atendimento operacional.</small>
              <Button type="submit" disabled={busy || !consent}>
                Criar sessão
              </Button>
            </div>
          </form>
        </Dialog>
      )}
      {transfer && detail && (
        <Dialog title="Transferir para uma fila" onClose={() => setTransfer(false)}>
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
              { name: 'reason', label: 'Motivo da transferência', type: 'textarea' },
            ]}
            defaults={{
              version: detail.version,
              queue_id: detail.queue_id || '',
              assigned_user_id: '',
              priority: 'NORMAL',
              status: 'HUMAN',
              reason: '',
            }}
            label="Transferir atendimento"
            onSubmit={async (data) => {
              await post('conversations/' + selected + '/transfer', data);
              setTransfer(false);
              await loadSession(selected);
              await loadSessions();
              add('Fila e responsável atualizados. IA pausada.');
            }}
          />
        </Dialog>
      )}
    </div>
  );
}
function MessagePlaceholder() {
  return (
    <div className="sandbox-placeholder-icon">
      <UserRound size={26} />
      <Bot size={26} />
    </div>
  );
}
