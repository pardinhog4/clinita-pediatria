'use client';
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import Link from 'next/link';
import { ArrowLeft, Check, Eye, EyeOff, MailCheck, RefreshCw } from 'lucide-react';
import { api, post } from '@/lib/client';
import { Button } from '@/components/atoms/button';
import { ThemeSwitcher } from '@/components/molecules/theme-switcher';

// Telas públicas de acesso: "Esqueci minha senha" e o link recebido por e-mail
// (convite ou recuperação), onde a pessoa define a própria senha.

export function AuthFrame({ children }: { children: ReactNode }) {
  return (
    <main className="login login-single">
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
          {children}
          <Link href="/login" className="link-button login-back">
            <ArrowLeft size={14} />
            Voltar para a entrada
          </Link>
        </div>
      </section>
    </main>
  );
}

export function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState('');
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const r = await post<{ message: string }>('auth/forgot-password', { email });
      setDone(r.message);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <AuthFrame>
      <h1>Esqueci minha senha</h1>
      {done ? (
        <div className="access-done" role="status">
          <MailCheck size={28} />
          <p>{done}</p>
          <p className="muted">
            O link vale por 1 hora e só pode ser usado uma vez. Confira também a caixa de spam.
          </p>
        </div>
      ) : (
        <>
          <p className="login-lead">
            Informe o e-mail cadastrado pela clínica. Enviaremos um link para criar uma nova senha.
          </p>
          <form onSubmit={submit} noValidate className="login-form">
            <label className="field">
              E-mail
              <input
                className="input"
                type="email"
                autoComplete="email"
                autoFocus
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </label>
            {error && (
              <p className="error-banner login-error" role="alert">
                {error}
              </p>
            )}
            <Button
              type="submit"
              className="login-submit"
              disabled={busy || !/\S+@\S+\.\S+/.test(email)}
            >
              {busy && <RefreshCw className="spin" size={16} />}
              Enviar link
            </Button>
          </form>
        </>
      )}
    </AuthFrame>
  );
}

type LinkInfo = { purpose: 'INVITE' | 'PASSWORD_RESET'; name: string; email: string };

export function AccessLink({ token }: { token: string }) {
  const [info, setInfo] = useState<LinkInfo | null>(null);
  const [invalid, setInvalid] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  useEffect(() => {
    api<LinkInfo>('auth/access/' + encodeURIComponent(token))
      .then(setInfo)
      .catch((e) => setInvalid(e.message));
  }, [token]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await post('auth/access/' + encodeURIComponent(token), { password, confirm });
      setDone(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (invalid)
    return (
      <AuthFrame>
        <h1>Link indisponível</h1>
        <p className="error-banner" role="alert">
          {invalid}
        </p>
        <Link href="/esqueci-senha" className="button secondary">
          Pedir um novo link
        </Link>
      </AuthFrame>
    );
  if (!info)
    return (
      <AuthFrame>
        <p className="loading">Conferindo o link…</p>
      </AuthFrame>
    );
  if (done)
    return (
      <AuthFrame>
        <div className="access-done" role="status">
          <Check size={28} />
          <h1>Senha definida</h1>
          <p>Agora entre com seu e-mail e a nova senha.</p>
        </div>
        <Link href="/login" className="button primary login-submit">
          Ir para a entrada
        </Link>
      </AuthFrame>
    );
  return (
    <AuthFrame>
      <h1>{info.purpose === 'INVITE' ? `Boas-vindas, ${info.name}!` : 'Criar uma nova senha'}</h1>
      <p className="login-lead">
        {info.purpose === 'INVITE'
          ? `Defina a senha do seu acesso (${info.email}).`
          : `Escolha uma nova senha para ${info.email}. As sessões abertas serão encerradas.`}
      </p>
      <form onSubmit={submit} noValidate className="login-form">
        <label className="field">
          Nova senha
          <span className="input-affix">
            <input
              className="input"
              type={show ? 'text' : 'password'}
              autoComplete="new-password"
              autoFocus
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <button
              type="button"
              className="icon-toggle"
              aria-label={show ? 'Ocultar senha' : 'Mostrar senha'}
              onClick={() => setShow(!show)}
            >
              {show ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </span>
          <small>Ao menos 10 caracteres, com letras e números.</small>
        </label>
        <label className="field">
          Confirme a nova senha
          <input
            className="input"
            type={show ? 'text' : 'password'}
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
        </label>
        {error && (
          <p className="error-banner login-error" role="alert">
            {error}
          </p>
        )}
        <Button type="submit" className="login-submit" disabled={busy || !password || !confirm}>
          {busy && <RefreshCw className="spin" size={16} />}
          Salvar senha
        </Button>
      </form>
    </AuthFrame>
  );
}
