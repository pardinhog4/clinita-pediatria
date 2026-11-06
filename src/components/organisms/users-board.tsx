'use client';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import {
  Plus,
  Search,
  UserCheck,
  KeyRound,
  UserX,
  ShieldAlert,
  Copy,
  Check,
  RefreshCw,
  Building2,
  Stethoscope,
  Mail,
} from 'lucide-react';
import { api, post, patch } from '@/lib/client';
import { useNotices } from '@/stores/workspace';
import { Button } from '../atoms/button';
import { Badge } from '../atoms/badge';
import { Input } from '../atoms/input';
import { Dialog } from '../molecules/dialog';
import { MetricCard } from '../molecules/metric-card';
type User = {
  id: string;
  name: string;
  email: string;
  job_title: string | null;
  last_login_at: string | null;
  has_password: boolean;
  must_change_password: boolean;
  role: string;
  unit_ids: string[];
  active: boolean;
  is_self: boolean;
  professional_id: string | null;
  professional_name: string | null;
  deactivated_at: string | null;
};
type Option = { id: string; name: string };
type Professional = Option & { specialty: string; unit_id: string; user_id: string | null };
type Data = {
  data: User[];
  summary: { active: number; inactive: number; pending: number; without_password: number };
  units: Option[];
  professionals: Professional[];
  canGrantAdmin: boolean;
};
type Credential = {
  email: string;
  temporaryPassword: string;
  title: string;
  /** Convite por e-mail enviado junto (cadastro novo): SMTP real ou simulação. */
  invite?: { mode: 'SMTP' | 'SIMULATED' };
};
export const roleInfo: Record<string, [string, string]> = {
  ADMIN: ['Direção clínica', 'Acesso total, inclusive conceder o perfil de direção.'],
  MANAGEMENT: ['Gestão da unidade', 'Acesso total às unidades, exceto contas de direção.'],
  RECEPTION: ['Recepção', 'Agenda, atendimento, pacientes e guias.'],
  CLINICIAN: [
    'Profissional de saúde',
    'Própria agenda, prontuários dos seus pacientes e repasses.',
  ],
  AUDIT: ['Auditoria', 'Guias, faturamento TISS e conferência de sessões.'],
  FINANCE: ['Financeiro', 'Lançamentos, estoque, faturamento e repasses.'],
};
const initials = (n: string) =>
  n
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((v) => v[0])
    .join('')
    .toUpperCase();
const ago = (v: string | null) =>
  v ? formatDistanceToNow(new Date(v), { addSuffix: true, locale: ptBR }) : 'Nunca entrou';

export function UsersBoard() {
  const [data, setData] = useState<Data | null>(null),
    [error, setError] = useState(''),
    [q, setQ] = useState(''),
    [query, setQuery] = useState(''),
    [role, setRole] = useState(''),
    [status, setStatus] = useState('active'),
    [editing, setEditing] = useState<User | 'new' | null>(null),
    [credential, setCredential] = useState<Credential | null>(null);
  const load = useCallback(async () => {
    try {
      setData(await api<Data>('users?' + new URLSearchParams({ q: query, role, status })));
      setError('');
    } catch (e) {
      setError((e as Error).message);
    }
  }, [query, role, status]);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    const t = setTimeout(() => setQuery(q), 250);
    return () => clearTimeout(t);
  }, [q]);
  if (error && !data)
    return (
      <div className="error-banner" role="alert">
        {error}
        <Button variant="ghost" onClick={() => void load()}>
          Tentar novamente
        </Button>
      </div>
    );
  if (!data)
    return (
      <div className="loading">
        <RefreshCw className="spin" size={18} />
        Carregando usuários…
      </div>
    );
  const unitName = (id: string) => data.units.find((u) => u.id === id)?.name;
  return (
    <>
      <div className="metrics">
        <MetricCard
          title="Acessos ativos"
          value={data.summary.active}
          detail="Podem entrar na plataforma"
          icon={UserCheck}
        />
        <MetricCard
          title="Aguardando nova senha"
          value={data.summary.pending}
          detail="Entraram ou vão entrar com senha provisória"
          icon={KeyRound}
        />
        <MetricCard
          title="Sem senha definida"
          value={data.summary.without_password}
          detail="Precisam de redefinição para entrar"
          icon={ShieldAlert}
        />
        <MetricCard
          title="Desativados"
          value={data.summary.inactive}
          detail="Histórico preservado na auditoria"
          icon={UserX}
        />
      </div>
      <div className="toolbar">
        <div className="search-field">
          <Search size={17} />
          <Input
            aria-label="Buscar usuários"
            placeholder="Buscar por nome ou e-mail…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <select
          className="input"
          aria-label="Filtrar perfil"
          value={role}
          onChange={(e) => setRole(e.target.value)}
        >
          <option value="">Todos os perfis</option>
          {Object.entries(roleInfo).map(([k, [l]]) => (
            <option key={k} value={k}>
              {l}
            </option>
          ))}
        </select>
        <div className="segmented" role="group" aria-label="Situação">
          {[
            ['active', 'Ativos'],
            ['inactive', 'Desativados'],
            ['all', 'Todos'],
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
        <Button className="toolbar-end" onClick={() => setEditing('new')}>
          <Plus size={17} />
          Novo usuário
        </Button>
      </div>
      <div className="card table-card">
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Usuário</th>
                <th>Perfil</th>
                <th>Unidades e vínculo</th>
                <th>Senha</th>
                <th>Último acesso</th>
                <th>Situação</th>
              </tr>
            </thead>
            <tbody>
              {data.data.map((u) => (
                <tr
                  key={u.id}
                  className={u.is_self ? '' : 'clickable'}
                  tabIndex={u.is_self ? undefined : 0}
                  onClick={() => !u.is_self && setEditing(u)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !u.is_self) setEditing(u);
                  }}
                >
                  <td>
                    <div className="identity">
                      <span className="avatar">{initials(u.name)}</span>
                      <div>
                        <strong>
                          {u.name}
                          {u.is_self && <span className="tag self-tag">você</span>}
                        </strong>
                        <small>{u.email}</small>
                      </div>
                    </div>
                  </td>
                  <td>
                    <span className="role-pill" data-role={u.role}>
                      {roleInfo[u.role]?.[0] || u.role}
                    </span>
                    {u.job_title && <small>{u.job_title}</small>}
                  </td>
                  <td>
                    {u.professional_name ? (
                      <span className="linked">
                        <Stethoscope size={14} />
                        {u.professional_name}
                      </span>
                    ) : null}
                    <div className="tags">
                      {u.unit_ids.length >= data.units.length && data.units.length > 1 ? (
                        <span className="tag">Todas as unidades</span>
                      ) : (
                        u.unit_ids.map((id) => (
                          <span className="tag" key={id}>
                            {unitName(id) || 'Outra unidade'}
                          </span>
                        ))
                      )}
                    </div>
                  </td>
                  <td>
                    {!u.has_password ? (
                      <Badge value="CANCELLED" label="Sem senha" />
                    ) : u.must_change_password ? (
                      <Badge value="PENDING" label="Provisória" />
                    ) : (
                      <Badge value="APPROVED" label="Definida" />
                    )}
                  </td>
                  <td>
                    <span className="muted">{ago(u.last_login_at)}</span>
                  </td>
                  <td>
                    {u.active ? (
                      <Badge value="COMPLETED" label="Ativo" />
                    ) : (
                      <Badge value="neutral" label="Desativado" />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!data.data.length && (
            <div className="empty">
              <strong>Nenhum usuário encontrado</strong>
              <p>Revise a busca e os filtros, ou cadastre um novo acesso.</p>
            </div>
          )}
        </div>
        <div className="pagination">
          <span>
            {data.data.length} {data.data.length === 1 ? 'usuário' : 'usuários'} · seu próprio
            acesso é ajustado em Meu perfil
          </span>
        </div>
      </div>
      {editing && (
        <UserEditor
          user={editing === 'new' ? null : editing}
          data={data}
          onClose={() => setEditing(null)}
          onSaved={(c) => {
            setEditing(null);
            if (c) setCredential(c);
            void load();
          }}
        />
      )}
      {credential && (
        <CredentialDialog credential={credential} onClose={() => setCredential(null)} />
      )}
    </>
  );
}

function UserEditor({
  user,
  data,
  onClose,
  onSaved,
}: {
  user: User | null;
  data: Data;
  onClose: () => void;
  onSaved: (c?: Credential) => void;
}) {
  const { add } = useNotices();
  const [form, setForm] = useState({
    name: user?.name || '',
    email: user?.email || '',
    job_title: user?.job_title || '',
    role: user?.role || 'RECEPTION',
    unit_ids: user?.unit_ids || (data.units.length === 1 ? [data.units[0].id] : []),
    professional_id: user?.professional_id || '',
  });
  const [busy, setBusy] = useState(''),
    [error, setError] = useState(''),
    [fields, setFields] = useState<Record<string, string[]>>({}),
    [confirm, setConfirm] = useState<'deactivate' | 'reset' | null>(null),
    [reason, setReason] = useState('');
  const set = (k: string, v: unknown) => setForm((f) => ({ ...f, [k]: v }));
  const clinician = form.role === 'CLINICIAN',
    lockedAdmin = user?.role === 'ADMIN' && !data.canGrantAdmin;
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
  const payload = () => ({
    name: form.name,
    email: form.email,
    job_title: form.job_title,
    role: form.role,
    unit_ids: clinician ? [] : form.unit_ids,
    professional_id: clinician ? form.professional_id || null : null,
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    void run('save', async () => {
      if (user) {
        await patch('users/' + user.id, payload());
        add('Acesso atualizado.');
        onSaved();
      } else {
        const r = await post<Omit<Credential, 'title'>>('users', payload());
        onSaved({ ...r, title: 'Usuário criado' });
      }
    });
  };
  const valid =
    form.name.trim().length >= 3 &&
    /\S+@\S+\.\S+/.test(form.email) &&
    (clinician ? !!form.professional_id : form.unit_ids.length > 0);
  return (
    <Dialog title={user ? 'Editar acesso' : 'Novo usuário'} onClose={onClose} wide>
      {lockedAdmin && (
        <p className="note">
          Contas de direção só podem ser alteradas por outro usuário com perfil de direção.
        </p>
      )}
      <form onSubmit={submit} noValidate>
        <fieldset className="user-form" disabled={lockedAdmin}>
          <div className="form-grid">
            <label className="field">
              Nome completo
              <input
                className="input"
                value={form.name}
                onChange={(e) => set('name', e.target.value)}
                autoComplete="off"
                maxLength={120}
                autoFocus
              />
              {fields.name && <span className="field-error">{fields.name[0]}</span>}
            </label>
            <label className="field">
              E-mail de acesso
              <input
                className="input"
                type="email"
                value={form.email}
                onChange={(e) => set('email', e.target.value)}
                autoComplete="off"
                spellCheck={false}
                maxLength={200}
              />
              {fields.email ? (
                <span className="field-error">{fields.email[0]}</span>
              ) : (
                user && <small>Trocar o e-mail encerra as sessões abertas desta pessoa.</small>
              )}
            </label>
            <label className="field full">
              <span>
                Cargo ou função <span className="muted">(opcional)</span>
              </span>
              <input
                className="input"
                value={form.job_title}
                onChange={(e) => set('job_title', e.target.value)}
                maxLength={80}
                placeholder="Ex.: Recepcionista, Fonoaudióloga"
              />
            </label>
          </div>
          <div className="field">
            <span className="field-label">Perfil de acesso</span>
            <div className="role-grid" role="radiogroup" aria-label="Perfil de acesso">
              {Object.entries(roleInfo).map(([k, [l, d]]) => {
                const disabled = k === 'ADMIN' && !data.canGrantAdmin;
                return (
                  <label
                    key={k}
                    className={
                      'role-option' +
                      (form.role === k ? ' selected' : '') +
                      (disabled ? ' disabled' : '')
                    }
                  >
                    <input
                      type="radio"
                      name="role"
                      value={k}
                      checked={form.role === k}
                      disabled={disabled}
                      onChange={() => set('role', k)}
                    />
                    <strong>{l}</strong>
                    <small>{d}</small>
                  </label>
                );
              })}
            </div>
          </div>
          {clinician ? (
            <label className="field">
              Cadastro do profissional
              <select
                className="input"
                value={form.professional_id}
                onChange={(e) => set('professional_id', e.target.value)}
              >
                <option value="">Selecione o profissional…</option>
                {data.professionals.map((p) => {
                  const taken = !!p.user_id && p.user_id !== user?.id;
                  return (
                    <option key={p.id} value={p.id} disabled={taken}>
                      {p.name} · {data.units.find((u) => u.id === p.unit_id)?.name}
                      {taken ? ' · já vinculado' : ''}
                    </option>
                  );
                })}
              </select>
              <small>A unidade e a agenda vêm do cadastro do profissional.</small>
            </label>
          ) : (
            <div className="field">
              <span className="field-label">Unidades liberadas</span>
              <div className="unit-grid">
                {data.units.map((u) => (
                  <label
                    key={u.id}
                    className={'unit-option' + (form.unit_ids.includes(u.id) ? ' selected' : '')}
                  >
                    <input
                      type="checkbox"
                      checked={form.unit_ids.includes(u.id)}
                      onChange={(e) =>
                        set(
                          'unit_ids',
                          e.target.checked
                            ? [...form.unit_ids, u.id]
                            : form.unit_ids.filter((x) => x !== u.id),
                        )
                      }
                    />
                    <Building2 size={15} />
                    {u.name}
                  </label>
                ))}
              </div>
              {data.units.length > 1 && (
                <button
                  type="button"
                  className="link-button"
                  onClick={() =>
                    set(
                      'unit_ids',
                      form.unit_ids.length === data.units.length ? [] : data.units.map((u) => u.id),
                    )
                  }
                >
                  {form.unit_ids.length === data.units.length
                    ? 'Limpar seleção'
                    : 'Selecionar todas'}
                </button>
              )}
            </div>
          )}
        </fieldset>
        {error && (
          <p className="error-banner" role="alert">
            {error}
          </p>
        )}
        <div className="form-footer">
          <span className="muted">
            {user
              ? 'As permissões valem a partir da próxima ação da pessoa.'
              : 'Uma senha provisória será gerada e exibida uma única vez.'}
          </span>
          <div className="actions">
            <Button variant="secondary" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" disabled={!valid || !!busy || lockedAdmin}>
              {busy === 'save' && <RefreshCw className="spin" size={15} />}
              {user ? 'Salvar alterações' : 'Criar usuário'}
            </Button>
          </div>
        </div>
      </form>
      {user && !lockedAdmin && (
        <section className="user-danger">
          <h3>Senha e acesso</h3>
          {confirm === null && (
            <div className="user-danger-actions">
              {user.active && (
                <div>
                  <div>
                    <strong>Reenviar convite por e-mail</strong>
                    <small>
                      Novo link para {user.email} definir a própria senha (válido por 72 horas).
                    </small>
                  </div>
                  <Button
                    variant="secondary"
                    disabled={!!busy}
                    onClick={() =>
                      void run('invite', async () => {
                        const r = await post<{ invite: { mode: string } }>(
                          'users/' + user.id + '/invite',
                          {},
                        );
                        add(
                          r.invite.mode === 'SMTP'
                            ? 'Convite enviado para ' + user.email + '.'
                            : 'Convite gerado em simulação: veja em Integrações → E-mail.',
                        );
                      })
                    }
                  >
                    {busy === 'invite' ? (
                      <RefreshCw className="spin" size={15} />
                    ) : (
                      <Mail size={15} />
                    )}
                    Reenviar
                  </Button>
                </div>
              )}
              {user.active && (
                <div>
                  <div>
                    <strong>Redefinir senha</strong>
                    <small>
                      Gera uma senha provisória e desconecta a pessoa de todos os dispositivos.
                    </small>
                  </div>
                  <Button variant="secondary" onClick={() => setConfirm('reset')}>
                    <KeyRound size={15} />
                    Redefinir
                  </Button>
                </div>
              )}
              <div>
                <div>
                  <strong>{user.active ? 'Desativar acesso' : 'Reativar acesso'}</strong>
                  <small>
                    {user.active
                      ? 'A pessoa é desconectada na hora. Registros e histórico são preservados.'
                      : 'Libera de novo o login com as permissões atuais.'}
                  </small>
                </div>
                {user.active ? (
                  <Button variant="danger" onClick={() => setConfirm('deactivate')}>
                    <UserX size={15} />
                    Desativar
                  </Button>
                ) : (
                  <Button
                    variant="secondary"
                    disabled={!!busy}
                    onClick={() =>
                      void run('status', async () => {
                        await post('users/' + user.id + '/status', { active: true });
                        add('Acesso reativado.');
                        onSaved();
                      })
                    }
                  >
                    <UserCheck size={15} />
                    Reativar
                  </Button>
                )}
              </div>
            </div>
          )}
          {confirm === 'reset' && (
            <div className="confirm-box">
              <p>
                Redefinir a senha de <b>{user.name}</b>? A senha atual deixa de funcionar e todas as
                sessões dela são encerradas.
              </p>
              <div className="actions">
                <Button variant="secondary" onClick={() => setConfirm(null)}>
                  Voltar
                </Button>
                <Button
                  disabled={!!busy}
                  onClick={() =>
                    void run('reset', async () => {
                      const r = await post<{ email: string; temporaryPassword: string }>(
                        'users/' + user.id + '/password',
                        {},
                      );
                      onSaved({ ...r, title: 'Senha redefinida' });
                    })
                  }
                >
                  {busy === 'reset' && <RefreshCw className="spin" size={15} />}Gerar senha
                  provisória
                </Button>
              </div>
            </div>
          )}
          {confirm === 'deactivate' && (
            <div className="confirm-box">
              <label className="field">
                Motivo da desativação
                <textarea
                  className="input"
                  rows={2}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  maxLength={300}
                  placeholder="Ex.: desligamento, fim do contrato, troca de função"
                  autoFocus
                />
              </label>
              <div className="actions">
                <Button variant="secondary" onClick={() => setConfirm(null)}>
                  Voltar
                </Button>
                <Button
                  variant="danger"
                  disabled={!!busy || reason.trim().length < 3}
                  onClick={() =>
                    void run('status', async () => {
                      await post('users/' + user.id + '/status', { active: false, reason });
                      add('Acesso desativado e sessões encerradas.');
                      onSaved();
                    })
                  }
                >
                  {busy === 'status' && <RefreshCw className="spin" size={15} />}Desativar acesso
                </Button>
              </div>
            </div>
          )}
        </section>
      )}
    </Dialog>
  );
}

function CredentialDialog({
  credential,
  onClose,
}: {
  credential: Credential;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const text = `Acesso à plataforma Integrar\nE-mail: ${credential.email}\nSenha provisória: ${credential.temporaryPassword}\nNo primeiro acesso, você vai criar uma senha pessoal.`;
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }
  return (
    <Dialog title={credential.title} onClose={onClose}>
      {credential.invite && (
        <p className="note">
          {credential.invite.mode === 'SMTP' ? (
            <>
              Enviamos um convite para <b>{credential.email}</b> com um link para a pessoa definir a
              própria senha (válido por 72 horas).
            </>
          ) : (
            <>
              <b>Simulação:</b> o convite com o link para definir a senha está em Integrações →
              E-mail (nenhum e-mail sai da máquina).
            </>
          )}
        </p>
      )}
      <p className="muted">
        {credential.invite ? 'Se preferir, entregue' : 'Entregue'} estes dados à pessoa por um canal
        seguro. <b>A senha provisória aparece só agora</b>: depois de fechar, será preciso
        redefinir.
      </p>
      <dl className="credential">
        <div>
          <dt>E-mail</dt>
          <dd>{credential.email}</dd>
        </div>
        <div>
          <dt>Senha provisória</dt>
          <dd className="credential-secret">{credential.temporaryPassword}</dd>
        </div>
      </dl>
      <p className="note">
        No primeiro acesso, a plataforma pede que a pessoa crie a própria senha antes de liberar as
        outras telas.
      </p>
      <div className="form-footer">
        <span />
        <div className="actions">
          <Button variant="secondary" onClick={() => void copy()}>
            {copied ? <Check size={15} /> : <Copy size={15} />}
            {copied ? 'Copiado' : 'Copiar instruções'}
          </Button>
          <Button onClick={onClose}>Concluir</Button>
        </div>
      </div>
    </Dialog>
  );
}
