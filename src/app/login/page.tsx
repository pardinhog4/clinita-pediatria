'use client';
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import {
  Eye,
  EyeOff,
  ArrowRight,
  RefreshCw,
  Lock,
  CalendarHeart,
  HeartPulse,
  FileCheck2,
} from 'lucide-react';
import Link from 'next/link';
import { api, post } from '@/lib/client';
import { Button } from '@/components/atoms/button';
import { ThemeSwitcher } from '@/components/molecules/theme-switcher';
const safeNext = (v: string | null) =>
  v && v.startsWith('/') && !v.startsWith('//') && !v.startsWith('/login') ? v : '/inicio';

export default function LoginPage() {
  const [email, setEmail] = useState(''),
    [password, setPassword] = useState(''),
    [show, setShow] = useState(false),
    [caps, setCaps] = useState(false),
    [busy, setBusy] = useState(''),
    [error, setError] = useState(''),
    [attempt, setAttempt] = useState(0),
    [setup, setSetup] = useState(false);
  const passwordRef = useRef<HTMLInputElement>(null);
  const next = () => safeNext(new URLSearchParams(location.search).get('next'));
  useEffect(() => {
    // Instalação nova, sem clínica cadastrada: oferece o cadastro inicial.
    void api<{ available: boolean }>('setup')
      .then((r) => setSetup(r.available))
      .catch(() => {});
    if (document.cookie.includes('integrar_csrf='))
      void api('meta')
        .then(() => location.replace(next()))
        .catch(() => {});
  }, []);
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (!email.trim() || !password) {
      setError('Informe e-mail e senha.');
      setAttempt((a) => a + 1);
      return;
    }
    setBusy('login');
    setError('');
    try {
      const r = await post<{ mustChangePassword?: boolean }>('auth/login', {
        email: email.trim(),
        password,
      });
      location.assign(r.mustChangePassword ? '/perfil' : next());
    } catch (err) {
      setError((err as Error).message);
      setAttempt((a) => a + 1);
      setBusy('');
      setPassword('');
      passwordRef.current?.focus();
    }
  }
  const capsCheck = (e: KeyboardEvent<HTMLInputElement>) =>
    setCaps(e.getModifierState?.('CapsLock') ?? false);
  return (
    <main className="login">
      <section className="login-aside" aria-hidden>
        <div className="login-brand">
          <span className="brand-mark">i</span>
          <span>
            <b>integrar</b>
            <small>multidisciplinar</small>
          </span>
        </div>
        <div className="login-aside-copy">
          <span className="eyebrow">Cuidado conectado, gestão integrada</span>
          <h2>
            Mais tempo para cuidar.
            <br />
            Mais clareza para gerir.
          </h2>
          <p>
            Do primeiro contato à evolução de cada paciente. Toda a operação da clínica em um só
            lugar.
          </p>
        </div>
        <ul className="login-features">
          <li>
            <CalendarHeart size={18} />
            Agenda multiprofissional com disponibilidade real
          </li>
          <li>
            <HeartPulse size={18} />
            Prontuário, evolução e avaliações
          </li>
          <li>
            <FileCheck2 size={18} />
            Guias, faturamento e repasses auditados
          </li>
        </ul>
        <small className="login-aside-foot">Todas as unidades, uma plataforma</small>
      </section>
      <section className="login-main">
        <ThemeSwitcher className="login-theme" />
        <div className="login-panel">
          <div className="login-brand login-brand-compact">
            <span className="brand-mark">i</span>
            <span>
              <b>integrar</b>
              <small>multidisciplinar</small>
            </span>
          </div>
          <h1>Entrar</h1>
          {setup && (
            <p className="note">
              Nenhuma clínica cadastrada ainda.{' '}
              <Link href="/configuracao-inicial">Fazer o cadastro inicial</Link>
            </p>
          )}
          <p className="login-lead">Use o e-mail cadastrado pela clínica.</p>
          <form onSubmit={submit} noValidate className="login-form">
            <label className="field">
              E-mail
              <input
                className="input"
                type="email"
                name="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="username"
                inputMode="email"
                autoCapitalize="none"
                spellCheck={false}
                autoFocus
                placeholder="nome@clinica.com.br"
                required
              />
            </label>
            <label className="field">
              Senha
              <span className="input-affix">
                <input
                  ref={passwordRef}
                  className="input"
                  type={show ? 'text' : 'password'}
                  name="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onKeyDown={capsCheck}
                  onKeyUp={capsCheck}
                  autoComplete="current-password"
                  required
                />
                <button
                  type="button"
                  className="icon-toggle"
                  onClick={() => setShow(!show)}
                  aria-label={show ? 'Ocultar senha' : 'Mostrar senha'}
                  aria-pressed={show}
                >
                  {show ? <EyeOff size={17} /> : <Eye size={17} />}
                </button>
              </span>
              {caps && <small className="caps-hint">Caps Lock está ativado.</small>}
            </label>
            {error && (
              <p key={attempt} className="error-banner login-error" role="alert">
                {error}
              </p>
            )}
            <Button type="submit" className="login-submit" disabled={!!busy}>
              {busy === 'login' ? (
                <>
                  <RefreshCw className="spin" size={16} />
                  Entrando…
                </>
              ) : (
                <>
                  Entrar
                  <ArrowRight size={16} />
                </>
              )}
            </Button>
            <Link href="/esqueci-senha" className="link-button">
              Esqueceu a senha?
            </Link>
          </form>
          <p className="login-foot">
            <Lock size={13} />
            Conexão protegida. Sua sessão fica ativa por até 7 dias neste dispositivo.
          </p>
        </div>
      </section>
    </main>
  );
}
