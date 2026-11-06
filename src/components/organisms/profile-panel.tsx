'use client';
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import {
  Monitor,
  Smartphone,
  LogOut,
  ShieldCheck,
  KeyRound,
  UserRound,
  Eye,
  EyeOff,
  RefreshCw,
  Building2,
  Mail,
} from 'lucide-react';
import { api, patch, post, del } from '@/lib/client';
import { useNotices } from '@/stores/workspace';
import { Button } from '../atoms/button';
import { Badge } from '../atoms/badge';
type Profile = {
  id: string;
  must_change_password: boolean;
  name: string;
  email: string;
  phone: string | null;
  job_title: string | null;
  created_at: string;
  last_login_at: string | null;
  password_changed_at: string | null;
  has_password: boolean;
  role: string;
  role_name: string;
  tenant_name: string;
  units: { id: string; name: string }[];
};
type Session = {
  id: string;
  method: 'PASSWORD' | 'LOCAL_DEMO';
  user_agent: string | null;
  ip: string | null;
  created_at: string;
  last_seen_at: string;
  current: boolean;
};
const ago = (v: string | null) =>
  v ? formatDistanceToNow(new Date(v), { addSuffix: true, locale: ptBR }) : '—';
const initials = (name: string) =>
  name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((v) => v[0])
    .join('')
    .toUpperCase();
function device(ua: string | null) {
  const v = ua || '';
  const browser = /Edg\//.test(v)
    ? 'Edge'
    : /OPR\//.test(v)
      ? 'Opera'
      : /Chrome\//.test(v)
        ? 'Chrome'
        : /Firefox\//.test(v)
          ? 'Firefox'
          : /Safari\//.test(v)
            ? 'Safari'
            : 'Navegador';
  const os = /iPhone|iPad/.test(v)
    ? 'iOS'
    : /Android/.test(v)
      ? 'Android'
      : /Windows/.test(v)
        ? 'Windows'
        : /Mac OS X/.test(v)
          ? 'macOS'
          : /Linux/.test(v)
            ? 'Linux'
            : 'Sistema desconhecido';
  return { label: browser + ' · ' + os, mobile: /iPhone|Android|Mobile/.test(v) };
}
function strength(p: string) {
  if (!p) return 0;
  let s = 0;
  if (p.length >= 10) s++;
  if (p.length >= 14) s++;
  if (/[a-z]/.test(p) && /[A-Z]/.test(p)) s++;
  if (/\d/.test(p) && /[^a-zA-Z0-9]/.test(p)) s++;
  return Math.max(1, s);
}
const strengthLabel = ['', 'Fraca', 'Razoável', 'Boa', 'Forte'];

export function ProfilePanel({ onSignOut }: { onSignOut: () => void }) {
  const { add } = useNotices();
  const [profile, setProfile] = useState<Profile | null>(null),
    [sessions, setSessions] = useState<Session[]>([]),
    [error, setError] = useState('');
  const load = useCallback(async () => {
    try {
      const [p, s] = await Promise.all([
        api<Profile>('profile'),
        api<{ data: Session[] }>('profile/sessions'),
      ]);
      setProfile(p);
      setSessions(s.data);
      setError('');
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  if (error && !profile)
    return (
      <div className="error-banner" role="alert">
        {error}
        <Button variant="ghost" onClick={() => void load()}>
          Tentar novamente
        </Button>
      </div>
    );
  if (!profile)
    return (
      <div className="loading">
        <RefreshCw className="spin" size={18} />
        Carregando seu perfil…
      </div>
    );
  return (
    <div className="profile">
      {profile.must_change_password && (
        <div className="first-access" role="status">
          <KeyRound size={20} />
          <div>
            <strong>Defina sua senha para continuar</strong>
            <p>
              Você entrou com uma senha provisória. Crie uma senha pessoal abaixo para liberar o
              acesso à plataforma.
            </p>
          </div>
        </div>
      )}
      <section className="card profile-hero">
        <span className="avatar profile-avatar" aria-hidden>
          {initials(profile.name)}
        </span>
        <div className="profile-identity">
          <h2>{profile.name}</h2>
          <p>
            {profile.job_title || profile.role_name} · {profile.tenant_name}
          </p>
          <div className="tags">
            {profile.units.map((u) => (
              <span className="tag" key={u.id}>
                <Building2 size={12} />
                {u.name}
              </span>
            ))}
          </div>
        </div>
        <dl className="profile-facts">
          <div>
            <dt>Perfil de acesso</dt>
            <dd>{profile.role_name}</dd>
          </div>
          <div>
            <dt>Último acesso com senha</dt>
            <dd>{profile.last_login_at ? ago(profile.last_login_at) : 'Ainda não'}</dd>
          </div>
          <div>
            <dt>Senha alterada</dt>
            <dd>{profile.password_changed_at ? ago(profile.password_changed_at) : 'Nunca'}</dd>
          </div>
        </dl>
      </section>
      <div className="profile-grid">
        <PersonalCard
          profile={profile}
          onSaved={(p) => {
            setProfile(p);
            add('Dados pessoais atualizados.');
          }}
        />
        <PasswordCard
          hasPassword={profile.has_password}
          onChanged={(revoked) => {
            if (profile.must_change_password) {
              location.assign('/inicio');
              return;
            }
            add(
              revoked
                ? `Senha alterada. ${revoked} ${revoked === 1 ? 'outra sessão foi encerrada' : 'outras sessões foram encerradas'}.`
                : 'Senha alterada.',
            );
            void load();
          }}
        />
      </div>
      <SessionsCard sessions={sessions} onChange={load} />
      <section className="card profile-signout">
        <div>
          <h3>Sair desta conta</h3>
          <p className="muted">
            Encerra a sessão neste dispositivo. Os outros continuam conectados.
          </p>
        </div>
        <Button variant="secondary" onClick={onSignOut}>
          <LogOut size={16} />
          Sair
        </Button>
      </section>
    </div>
  );
}

function PersonalCard({ profile, onSaved }: { profile: Profile; onSaved: (p: Profile) => void }) {
  const initial = useMemo(
    () => ({ name: profile.name, phone: profile.phone || '', job_title: profile.job_title || '' }),
    [profile],
  );
  const [form, setForm] = useState(initial),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [fields, setFields] = useState<Record<string, string[]>>({});
  useEffect(() => setForm(initial), [initial]);
  const dirty = JSON.stringify(form) !== JSON.stringify(initial);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    setFields({});
    try {
      onSaved(await patch<Profile>('profile', form));
    } catch (err) {
      setError((err as Error).message);
      setFields((err as any).fields || {});
    } finally {
      setBusy(false);
    }
  }
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm({ ...form, [k]: e.target.value });
  return (
    <section className="card profile-card">
      <header className="profile-card-header">
        <span className="agent-icon">
          <UserRound size={20} />
        </span>
        <div>
          <h3>Dados pessoais</h3>
          <small>Como você aparece para a equipe e nos registros de auditoria.</small>
        </div>
      </header>
      <form onSubmit={submit} noValidate>
        <label className="field">
          Nome completo
          <input
            className="input"
            value={form.name}
            onChange={set('name')}
            autoComplete="name"
            required
            minLength={3}
            maxLength={120}
          />
          {fields.name && <span className="field-error">{fields.name[0]}</span>}
        </label>
        <label className="field">
          E-mail de acesso
          <span className="input input-readonly">
            <Mail size={15} />
            {profile.email}
          </span>
          <small>Para trocar o e-mail, fale com a direção da clínica.</small>
        </label>
        <div className="form-grid">
          <label className="field">
            Telefone
            <input
              className="input"
              value={form.phone}
              onChange={set('phone')}
              autoComplete="tel"
              inputMode="tel"
              placeholder="(92) 90000-0000"
              maxLength={30}
            />
            {fields.phone && <span className="field-error">{fields.phone[0]}</span>}
          </label>
          <label className="field">
            Cargo ou função
            <input
              className="input"
              value={form.job_title}
              onChange={set('job_title')}
              autoComplete="organization-title"
              placeholder={profile.role_name}
              maxLength={80}
            />
          </label>
        </div>
        {error && (
          <p className="field-error" role="alert">
            {error}
          </p>
        )}
        <div className="profile-card-actions">
          <Button variant="ghost" disabled={!dirty || busy} onClick={() => setForm(initial)}>
            Descartar
          </Button>
          <Button type="submit" disabled={!dirty || busy || form.name.trim().length < 3}>
            {busy ? <RefreshCw className="spin" size={15} /> : null}Salvar alterações
          </Button>
        </div>
      </form>
    </section>
  );
}

function PasswordCard({
  hasPassword,
  onChanged,
}: {
  hasPassword: boolean;
  onChanged: (revoked: number) => void;
}) {
  const empty = { current: '', password: '', confirm: '' };
  const [form, setForm] = useState(empty),
    [show, setShow] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const score = strength(form.password),
    mismatch = !!form.confirm && form.confirm !== form.password,
    valid =
      form.password.length >= 10 && /[a-zA-Z]/.test(form.password) && /\d/.test(form.password);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const r = await post<{ revoked: number }>(
        'profile/password',
        hasPassword ? form : { password: form.password, confirm: form.confirm },
      );
      setForm(empty);
      onChanged(r.revoked);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const type = show ? 'text' : 'password';
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm({ ...form, [k]: e.target.value });
  return (
    <section className="card profile-card">
      <header className="profile-card-header">
        <span className="agent-icon">
          <KeyRound size={20} />
        </span>
        <div>
          <h3>{hasPassword ? 'Alterar senha' : 'Criar senha'}</h3>
          <small>
            {hasPassword
              ? 'Ao trocar, os outros dispositivos são desconectados.'
              : 'Esta conta ainda não tem senha. Crie uma para entrar pelo login.'}
          </small>
        </div>
        <button
          type="button"
          className="icon-toggle"
          aria-label={show ? 'Ocultar senhas' : 'Mostrar senhas'}
          aria-pressed={show}
          onClick={() => setShow(!show)}
        >
          {show ? <EyeOff size={17} /> : <Eye size={17} />}
        </button>
      </header>
      <form onSubmit={submit} noValidate>
        {hasPassword && (
          <label className="field">
            Senha atual
            <input
              className="input"
              type={type}
              value={form.current}
              onChange={set('current')}
              autoComplete="current-password"
              required
            />
          </label>
        )}
        <label className="field">
          Nova senha
          <input
            className="input"
            type={type}
            value={form.password}
            onChange={set('password')}
            autoComplete="new-password"
            aria-describedby="password-rule"
            required
          />
          <span className="strength" data-score={score} aria-live="polite">
            <i />
            <i />
            <i />
            <i />
            <b>{strengthLabel[score]}</b>
          </span>
          <small id="password-rule">Ao menos 10 caracteres, com letras e números.</small>
        </label>
        <label className="field">
          Confirmar nova senha
          <input
            className="input"
            type={type}
            value={form.confirm}
            onChange={set('confirm')}
            autoComplete="new-password"
            aria-invalid={mismatch}
            required
          />
          {mismatch && <span className="field-error">As senhas não coincidem.</span>}
        </label>
        {error && (
          <p className="field-error" role="alert">
            {error}
          </p>
        )}
        <div className="profile-card-actions">
          <Button
            type="submit"
            disabled={busy || !valid || mismatch || !form.confirm || (hasPassword && !form.current)}
          >
            {busy ? <RefreshCw className="spin" size={15} /> : <ShieldCheck size={15} />}
            {hasPassword ? 'Alterar senha' : 'Criar senha'}
          </Button>
        </div>
      </form>
    </section>
  );
}

function SessionsCard({
  sessions,
  onChange,
}: {
  sessions: Session[];
  onChange: () => Promise<void>;
}) {
  const { add } = useNotices();
  const [busy, setBusy] = useState('');
  async function run(id: string, fn: () => Promise<unknown>, message: string) {
    setBusy(id);
    try {
      await fn();
      add(message);
      await onChange();
    } catch (e) {
      add((e as Error).message, 'error');
    } finally {
      setBusy('');
    }
  }
  const others = sessions.filter((s) => !s.current).length;
  return (
    <section className="card profile-card profile-sessions">
      <header className="profile-card-header">
        <span className="agent-icon">
          <ShieldCheck size={20} />
        </span>
        <div>
          <h3>Dispositivos conectados</h3>
          <small>
            {sessions.length} {sessions.length === 1 ? 'sessão ativa' : 'sessões ativas'}. Encerre
            qualquer acesso que você não reconheça.
          </small>
        </div>
        {others > 0 && (
          <Button
            variant="secondary"
            disabled={!!busy}
            onClick={() =>
              void run('others', () => del('profile/sessions'), 'Outras sessões encerradas.')
            }
          >
            Encerrar as outras
          </Button>
        )}
      </header>
      <ul className="session-list">
        {sessions.map((s) => {
          const d = device(s.user_agent);
          const Icon = d.mobile ? Smartphone : Monitor;
          return (
            <li key={s.id} className={s.current ? 'current' : ''}>
              <span className="session-icon">
                <Icon size={20} />
              </span>
              <div>
                <strong>
                  {d.label}
                  {s.current && <Badge value="APPROVED" label="Este dispositivo" />}
                </strong>
                <small>
                  {s.method === 'PASSWORD' ? 'Login com senha' : 'Outro método'} ·{' '}
                  {s.ip === 'local' || s.ip === '::1' || s.ip === '127.0.0.1' ? 'rede local' : s.ip}{' '}
                  · ativo {ago(s.last_seen_at)}
                </small>
              </div>
              {!s.current && (
                <Button
                  variant="ghost"
                  disabled={!!busy}
                  onClick={() =>
                    void run(s.id, () => del('profile/sessions/' + s.id), 'Sessão encerrada.')
                  }
                >
                  {busy === s.id ? <RefreshCw className="spin" size={15} /> : null}Encerrar
                </Button>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
