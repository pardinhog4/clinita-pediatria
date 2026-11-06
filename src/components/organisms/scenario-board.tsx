'use client';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import {
  BookOpen,
  Plus,
  Search,
  FlaskConical,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  RefreshCw,
  Archive,
  Send,
  Undo2,
} from 'lucide-react';
import { api, post, patch } from '@/lib/client';
import type { Entity } from '@/lib/types';
import { useNotices } from '@/stores/workspace';
import { Button } from '../atoms/button';
import { Badge } from '../atoms/badge';
import { Input } from '../atoms/input';
import { Dialog } from '../molecules/dialog';
import { MetricCard } from '../molecules/metric-card';
type Data = { data: Entity[]; agents: Entity[]; summary: { published: number; drafts: number } };
const statusInfo: Record<string, [string, string]> = {
  PUBLISHED: ['APPROVED', 'Publicado'],
  DRAFT: ['PENDING', 'Rascunho'],
  ARCHIVED: ['neutral', 'Arquivado'],
};
const testInfo: Record<string, [string, string]> = {
  PASSED: ['APPROVED', 'Teste passou'],
  FAILED: ['REJECTED', 'Teste falhou'],
  ERROR: ['REJECTED', 'Teste com erro'],
  RUNNING: ['CONFIRMED', 'Testando…'],
};
const actionLabel: Record<string, string> = {
  ASK_USER: 'Continuar perguntando',
  ANSWER: 'Responder',
  HANDOFF: 'Encaminhar',
};
const queueLabel: Record<string, string> = {
  AI: 'Fica com a IA',
  recepcao: 'Recepção',
  agenda: 'Agendamento',
  convenios: 'Convênios',
  clinica: 'Coordenação clínica',
  auditoria: 'Auditoria',
  financeiro: 'Financeiro',
};
const ago = (v: string) => formatDistanceToNow(new Date(v), { addSuffix: true, locale: ptBR });
const outcome = (s: Entity) =>
  s.expected_action
    ? actionLabel[s.expected_action] +
      (s.expected_destination && s.expected_destination !== 'AI'
        ? ' → ' + queueLabel[s.expected_destination]
        : '')
    : s.expected_destination
      ? queueLabel[s.expected_destination]
      : 'Sem desfecho definido';

// Biblioteca de cenários: a IA consulta os publicados; cada cenário também roda como teste no Sandbox.
export function ScenarioBoard({ unitId }: { unitId: string }) {
  const add = useNotices((s) => s.add);
  const [data, setData] = useState<Data | null>(null),
    [status, setStatus] = useState('ACTIVE'),
    [q, setQ] = useState(''),
    [query, setQuery] = useState(''),
    [editing, setEditing] = useState<string | 'new' | null>(null),
    [error, setError] = useState(''),
    [testing, setTesting] = useState(false);
  const load = useCallback(async () => {
    try {
      setData(await api<Data>('scenarios?' + new URLSearchParams({ status, q: query })));
      setError('');
    } catch (e) {
      setError((e as Error).message);
    }
  }, [status, query]);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    const t = setTimeout(() => setQuery(q), 250);
    return () => clearTimeout(t);
  }, [q]);
  const running = !!data?.data.some((s) => s.last_test_status === 'RUNNING');
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => void load(), 3000);
    return () => clearInterval(t);
  }, [running, load]);
  async function testAll() {
    if (!data) return;
    setTesting(true);
    setError('');
    try {
      const list = data.data.filter((s) => s.status === 'PUBLISHED' && s.test_message);
      for (const s of list) await post('scenarios/' + s.id + '/test', { unit_id: unitId });
      add(list.length + ' testes iniciados. O resultado aparece em cada cenário.');
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setTesting(false);
    }
  }
  if (!data)
    return error ? (
      <div className="error-banner" role="alert">
        {error}
      </div>
    ) : (
      <div className="loading">
        <RefreshCw className="spin" size={18} />
        Carregando cenários…
      </div>
    );
  const users = data.agents.filter((a) => a.use_scenarios && a.enabled);
  return (
    <section className="scenario-board">
      <div className="scenario-head">
        <div>
          <h2>Cenários da IA</h2>
          <p className="muted">
            Situações recorrentes com a orientação de como agir. A IA consulta os cenários
            publicados quando a conversa se parece com um deles, e cada cenário também funciona como
            teste.
          </p>
        </div>
      </div>
      <div className="metrics">
        <MetricCard
          title="Publicados"
          value={data.summary.published}
          detail="A IA já consulta"
          icon={BookOpen}
        />
        <MetricCard
          title="Rascunhos"
          value={data.summary.drafts}
          detail="Ainda não usados pela IA"
          icon={Plus}
        />
        <MetricCard
          title="Agentes usando"
          value={users.length}
          detail={users.map((a) => a.name).join(', ') || 'Ligue no agente: Usar cenários'}
          icon={CheckCircle2}
        />
        <MetricCard
          title="Falhas no último teste"
          value={data.data.filter((s) => ['FAILED', 'ERROR'].includes(s.last_test_status)).length}
          detail="Revise o cenário ou as instruções"
          icon={AlertTriangle}
        />
      </div>
      <div className="toolbar">
        <div className="search-field">
          <Search size={17} />
          <Input
            aria-label="Buscar cenários"
            placeholder="Buscar por situação ou etiqueta…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <div className="segmented" role="group" aria-label="Situação">
          {[
            ['ACTIVE', 'Ativos'],
            ['PUBLISHED', 'Publicados'],
            ['DRAFT', 'Rascunhos'],
            ['ARCHIVED', 'Arquivados'],
          ].map(([k, l]) => (
            <Button
              key={k}
              variant={status === k ? 'primary' : 'ghost'}
              aria-pressed={status === k}
              onClick={() => setStatus(k)}
            >
              {l}
            </Button>
          ))}
        </div>
        <Button
          variant="secondary"
          className="toolbar-end"
          disabled={testing || running}
          onClick={() => void testAll()}
        >
          <FlaskConical size={16} />
          {testing ? 'Iniciando…' : running ? 'Testes em andamento…' : 'Testar publicados'}
        </Button>
        <Button onClick={() => setEditing('new')}>
          <Plus size={16} />
          Novo cenário
        </Button>
      </div>
      {error && (
        <div className="error-banner" role="alert">
          {error}
        </div>
      )}
      <div className="scenario-grid">
        {data.data.map((s) => {
          const [tone, label] = statusInfo[s.status],
            test = s.last_test_status ? testInfo[s.last_test_status] : null;
          return (
            <button key={s.id} className="card scenario-card" onClick={() => setEditing(s.id)}>
              <div className="scenario-card-top">
                <Badge value={tone} label={label} />
                {test && (
                  <Badge
                    value={test[0]}
                    label={
                      test[1] +
                      (s.last_test_version !== s.version && s.last_test_status !== 'RUNNING'
                        ? ' (versão anterior)'
                        : '')
                    }
                  />
                )}
              </div>
              <h3>{s.title}</h3>
              <p>{s.situation}</p>
              <div className="tags">
                {s.tags.slice(0, 4).map((t: string) => (
                  <span className="tag" key={t}>
                    {t}
                  </span>
                ))}
              </div>
              <small className="scenario-outcome">
                {outcome(s)} · v{s.version}
                {s.updated_by_name ? ' · ' + s.updated_by_name : ''}
              </small>
            </button>
          );
        })}
      </div>
      {!data.data.length && (
        <div className="card empty">
          <BookOpen size={30} />
          <h2>Nenhum cenário aqui</h2>
          <p>Escreva o primeiro: uma situação, como a IA deve agir e o desfecho esperado.</p>
        </div>
      )}
      {editing && (
        <ScenarioEditor
          id={editing === 'new' ? null : editing}
          unitId={unitId}
          onClose={() => setEditing(null)}
          onSaved={() => void load()}
        />
      )}
    </section>
  );
}

const empty = {
  title: '',
  situation: '',
  guidance: '',
  example: '',
  avoid: '',
  test_message: '',
  expected_action: '',
  expected_destination: '',
  tags: '',
  agent_specialties: '',
};
function ScenarioEditor({
  id,
  unitId,
  onClose,
  onSaved,
}: {
  id: string | null;
  unitId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const add = useNotices((s) => s.add);
  const [detail, setDetail] = useState<Entity | null>(null),
    [form, setForm] = useState(empty),
    [busy, setBusy] = useState(''),
    [error, setError] = useState(''),
    [fields, setFields] = useState<Record<string, string[]>>({});
  const fill = (s: Entity) =>
    setForm({
      title: s.title,
      situation: s.situation,
      guidance: s.guidance,
      example: s.example,
      avoid: s.avoid,
      test_message: s.test_message,
      expected_action: s.expected_action || '',
      expected_destination: s.expected_destination || '',
      tags: s.tags.join(', '),
      agent_specialties: s.agent_specialties.join(', '),
    });
  const load = useCallback(
    async (reset = false) => {
      if (!id) return;
      const s = await api<Entity>('scenarios/' + id);
      setDetail(s);
      if (reset) fill(s);
    },
    [id],
  );
  useEffect(() => {
    void load(true).catch((e) => setError(e.message));
  }, [load]);
  const running = !!detail?.runs?.some((r: Entity) => r.status === 'RUNNING');
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => void load().catch(() => {}), 3000);
    return () => clearInterval(t);
  }, [running, load]);
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));
  const list = (v: string) =>
    v
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean);
  const payload = () => ({
    title: form.title,
    situation: form.situation,
    guidance: form.guidance,
    example: form.example,
    avoid: form.avoid,
    test_message: form.test_message,
    expected_action: form.expected_action || null,
    expected_destination:
      form.expected_destination ||
      (form.expected_action && form.expected_action !== 'HANDOFF' ? 'AI' : null),
    tags: list(form.tags),
    agent_specialties: list(form.agent_specialties),
  });
  const dirty =
    !detail ||
    JSON.stringify(payload()) !==
      JSON.stringify({
        title: detail.title,
        situation: detail.situation,
        guidance: detail.guidance,
        example: detail.example,
        avoid: detail.avoid,
        test_message: detail.test_message,
        expected_action: detail.expected_action,
        expected_destination: detail.expected_destination,
        tags: detail.tags,
        agent_specialties: detail.agent_specialties,
      });
  async function run(kind: string, fn: () => Promise<void>) {
    setBusy(kind);
    setError('');
    setFields({});
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
      setFields((e as any).fields || {});
    } finally {
      setBusy('');
    }
  }
  const save = (e: FormEvent) => {
    e.preventDefault();
    void run('save', async () => {
      if (detail) {
        await patch('scenarios/' + detail.id, { ...payload(), version: detail.version });
        await load(true);
        add('Cenário salvo em nova versão.');
      } else {
        const s = await post<Entity>('scenarios', payload());
        add('Rascunho criado. Teste antes de publicar.');
        onSaved();
        onClose();
        void s;
        return;
      }
      onSaved();
    });
  };
  const setStatus = (status: string, msg: string) =>
    void run(status, async () => {
      await post('scenarios/' + detail!.id + '/status', { status, version: detail!.version });
      await load();
      onSaved();
      add(msg);
    });
  const test = () =>
    void run('test', async () => {
      await post('scenarios/' + detail!.id + '/test', { unit_id: unitId });
      await load();
      onSaved();
      add('Teste iniciado no Sandbox.');
    });
  const err = (k: string) =>
    fields[k] ? <span className="field-error">{fields[k][0]}</span> : null;
  return (
    <Dialog
      title={detail ? detail.title : 'Novo cenário'}
      onClose={() => {
        if (!busy) onClose();
      }}
      wide
    >
      {detail && (
        <div className="scenario-status-bar">
          <Badge
            value={statusInfo[detail.status][0]}
            label={statusInfo[detail.status][1] + ' · v' + detail.version}
          />
          <div className="actions">
            {detail.status !== 'PUBLISHED' && detail.status !== 'ARCHIVED' && (
              <Button
                variant="secondary"
                disabled={!!busy || dirty}
                title={dirty ? 'Salve antes de publicar' : ''}
                onClick={() => setStatus('PUBLISHED', 'Cenário publicado. A IA já pode consultar.')}
              >
                <Send size={15} />
                Publicar
              </Button>
            )}
            {detail.status === 'PUBLISHED' && (
              <Button
                variant="ghost"
                disabled={!!busy}
                onClick={() =>
                  setStatus('DRAFT', 'Cenário voltou para rascunho. A IA deixa de consultar.')
                }
              >
                <Undo2 size={15} />
                Voltar para rascunho
              </Button>
            )}
            {detail.status !== 'ARCHIVED' ? (
              <Button
                variant="ghost"
                disabled={!!busy}
                onClick={() => setStatus('ARCHIVED', 'Cenário arquivado.')}
              >
                <Archive size={15} />
                Arquivar
              </Button>
            ) : (
              <Button
                variant="ghost"
                disabled={!!busy}
                onClick={() => setStatus('DRAFT', 'Cenário restaurado como rascunho.')}
              >
                <Undo2 size={15} />
                Restaurar
              </Button>
            )}
          </div>
        </div>
      )}
      <form onSubmit={save} className="scenario-form" noValidate>
        <label className="field">
          Título
          <input
            className="input"
            value={form.title}
            onChange={(e) => set('title', e.target.value)}
            maxLength={120}
            placeholder="Ex.: Família pede troca de profissional"
          />
          {err('title')}
        </label>
        <label className="field">
          Quando se aplica
          <textarea
            className="input"
            rows={2}
            value={form.situation}
            onChange={(e) => set('situation', e.target.value)}
            maxLength={1000}
            placeholder="Descreva a situação como a família costuma trazer."
          />
          {err('situation')}
        </label>
        <label className="field">
          Como lidar
          <textarea
            className="input"
            rows={4}
            value={form.guidance}
            onChange={(e) => set('guidance', e.target.value)}
            maxLength={3000}
            placeholder="Passos curtos: o que dizer, o que perguntar, para onde encaminhar."
          />
          {err('guidance')}
        </label>
        <div className="form-grid">
          <label className="field">
            Exemplo de conversa
            <textarea
              className="input"
              rows={3}
              value={form.example}
              onChange={(e) => set('example', e.target.value)}
              maxLength={2000}
              placeholder={'Família: …\nIA: …'}
            />
          </label>
          <label className="field">
            Não fazer
            <textarea
              className="input"
              rows={3}
              value={form.avoid}
              onChange={(e) => set('avoid', e.target.value)}
              maxLength={1000}
            />
          </label>
        </div>
        <div className="form-grid">
          <label className="field">
            Etiquetas (separadas por vírgula)
            <input
              className="input"
              value={form.tags}
              onChange={(e) => set('tags', e.target.value)}
              placeholder="troca, insatisfação, mudar de terapeuta"
            />
            <small>Ajudam a IA a encontrar o cenário.</small>
          </label>
          <label className="field">
            Agentes (vazio = todos)
            <input
              className="input"
              value={form.agent_specialties}
              onChange={(e) => set('agent_specialties', e.target.value)}
              placeholder="triagem, agenda"
            />
          </label>
        </div>
        <fieldset className="scenario-test-fields">
          <legend>Teste do cenário</legend>
          <label className="field">
            Mensagem de teste (como a família escreveria)
            <input
              className="input"
              value={form.test_message}
              onChange={(e) => set('test_message', e.target.value)}
              maxLength={1000}
            />
          </label>
          <div className="form-grid">
            <label className="field">
              Ação esperada
              <select
                className="input"
                value={form.expected_action}
                onChange={(e) => {
                  set('expected_action', e.target.value);
                  if (e.target.value && e.target.value !== 'HANDOFF')
                    set('expected_destination', 'AI');
                  if (e.target.value === 'HANDOFF' && form.expected_destination === 'AI')
                    set('expected_destination', '');
                }}
              >
                <option value="">Qualquer</option>
                {Object.entries(actionLabel).map(([k, l]) => (
                  <option key={k} value={k}>
                    {l}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              Destino esperado
              <select
                className="input"
                value={form.expected_destination}
                onChange={(e) => set('expected_destination', e.target.value)}
              >
                <option value="">Qualquer</option>
                {Object.entries(queueLabel)
                  .filter(([k]) =>
                    form.expected_action === 'HANDOFF'
                      ? k !== 'AI'
                      : !form.expected_action || k === 'AI',
                  )
                  .map(([k, l]) => (
                    <option key={k} value={k}>
                      {l}
                    </option>
                  ))}
              </select>
            </label>
          </div>
        </fieldset>
        {error && <p className="field-error">{error}</p>}
        <div className="form-footer">
          <small className="muted">
            {detail
              ? 'Salvar cria uma nova versão. A IA usa a versão publicada mais recente.'
              : 'O cenário nasce como rascunho e só é usado pela IA depois de publicado.'}
          </small>
          <div className="actions">
            {detail && (
              <Button
                type="button"
                variant="secondary"
                disabled={!!busy || running || dirty || !detail.test_message}
                title={dirty ? 'Salve antes de testar' : ''}
                onClick={test}
              >
                <FlaskConical size={15} />
                {running ? 'Testando…' : 'Testar agora'}
              </Button>
            )}
            <Button type="submit" disabled={!!busy || !dirty}>
              {busy === 'save' ? 'Salvando…' : detail ? 'Salvar nova versão' : 'Criar rascunho'}
            </Button>
          </div>
        </div>
      </form>
      {detail && (
        <div className="scenario-history">
          <h3>Testes</h3>
          {detail.runs.length ? (
            <ul className="scenario-runs">
              {detail.runs.map((r: Entity) => (
                <li key={r.id}>
                  <div className="actions between">
                    <Badge value={testInfo[r.status][0]} label={testInfo[r.status][1]} />
                    <small className="muted">
                      v{r.version} · {ago(r.created_at)}
                      {r.author ? ' · ' + r.author : ''}
                    </small>
                  </div>
                  {r.checks.map((c: Entity, i: number) => (
                    <p
                      key={i}
                      className={
                        'scenario-check ' + (c.passed ? 'ok' : c.required ? 'bad' : 'warn')
                      }
                    >
                      {c.passed ? (
                        <CheckCircle2 size={14} />
                      ) : c.required ? (
                        <XCircle size={14} />
                      ) : (
                        <AlertTriangle size={14} />
                      )}
                      <span>
                        <b>{c.label}.</b> {c.detail}
                      </span>
                    </p>
                  ))}
                  {r.reply && <blockquote>{r.reply}</blockquote>}
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted small">
              Ainda não testado. O teste abre uma sessão de Sandbox, envia a mensagem de teste para
              a IA e compara o desfecho com o esperado.
            </p>
          )}
          <h3>Versões</h3>
          <p className="muted small">
            {detail.versions
              .map(
                (v: Entity) =>
                  'v' +
                  v.version +
                  ' · ' +
                  new Date(v.created_at).toLocaleDateString('pt-BR') +
                  (v.author ? ' · ' + v.author : ''),
              )
              .join('   ·   ')}
          </p>
        </div>
      )}
    </Dialog>
  );
}
