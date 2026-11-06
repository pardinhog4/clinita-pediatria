'use client';
import { useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { Building2, Check, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { api, post } from '@/lib/client';
import { Button } from '@/components/atoms/button';
import { AuthFrame } from './access-forms';

// Cadastro inicial: primeira clínica real, suas unidades e a conta da direção.
// Disponível só enquanto não houver clínica cadastrada (o servidor confere de novo ao salvar).

type Status = {
  available: boolean;
  needsToken?: boolean;
  reason?: 'DONE' | 'TOKEN_NOT_CONFIGURED';
};

export function InitialSetup() {
  const [status, setStatus] = useState<Status | null>(null);
  const [name, setName] = useState('');
  const [units, setUnits] = useState(['']);
  const [admin, setAdmin] = useState({ name: '', email: '', password: '', confirm: '' });
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState('');

  useEffect(() => {
    api<Status>('setup')
      .then(setStatus)
      .catch((e) => setError(e.message));
  }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const r = await post<{ email: string }>('setup', {
        name,
        units: units.map((u) => u.trim()).filter(Boolean),
        admin,
        ...(status?.needsToken ? { setup_token: token } : {}),
      });
      setDone(r.email);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (done)
    return (
      <AuthFrame>
        <div className="access-done" role="status">
          <Check size={28} />
          <h1>Clínica cadastrada</h1>
          <p>
            Entre com <b>{done}</b> e a senha que você escolheu. Depois, importe pacientes,
            profissionais e convênios em Configurações → Importar dados.
          </p>
        </div>
        <Link href="/login" className="button primary login-submit">
          Ir para a entrada
        </Link>
      </AuthFrame>
    );
  if (!status)
    return (
      <AuthFrame>
        {error ? <p className="error-banner">{error}</p> : <p className="loading">Carregando…</p>}
      </AuthFrame>
    );
  if (!status.available)
    return (
      <AuthFrame>
        <h1>Cadastro inicial</h1>
        <p className="note">
          {status.reason === 'DONE'
            ? 'A clínica já foi cadastrada. Entre com a conta da direção; novas pessoas recebem acesso em Usuários e acessos.'
            : 'O cadastro inicial está bloqueado neste servidor. O responsável técnico precisa definir SETUP_TOKEN no .env.'}
        </p>
      </AuthFrame>
    );

  const valid =
    name.trim().length >= 3 &&
    units.some((u) => u.trim().length >= 2) &&
    admin.name.trim().length >= 3 &&
    /\S+@\S+\.\S+/.test(admin.email) &&
    admin.password.length > 0 &&
    admin.confirm.length > 0 &&
    (!status.needsToken || token.length > 0);

  return (
    <AuthFrame>
      <h1>Cadastro inicial</h1>
      <p className="login-lead">
        Crie a clínica, as unidades e a conta da direção. Esta tela só aparece uma vez.
      </p>
      <form onSubmit={submit} noValidate className="login-form setup-form">
        <label className="field">
          Nome da clínica
          <input
            className="input"
            value={name}
            autoFocus
            maxLength={120}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <fieldset className="setup-units">
          <legend>Unidades</legend>
          {units.map((u, i) => (
            <div className="setup-unit" key={i}>
              <Building2 size={16} />
              <input
                className="input"
                aria-label={`Unidade ${i + 1}`}
                placeholder={i === 0 ? 'Ex.: Matriz' : 'Nome da unidade'}
                value={u}
                maxLength={80}
                onChange={(e) => setUnits(units.map((x, j) => (j === i ? e.target.value : x)))}
              />
              {units.length > 1 && (
                <button
                  type="button"
                  className="icon-toggle"
                  aria-label={`Remover unidade ${i + 1}`}
                  onClick={() => setUnits(units.filter((_, j) => j !== i))}
                >
                  <Trash2 size={15} />
                </button>
              )}
            </div>
          ))}
          <Button
            variant="ghost"
            onClick={() => setUnits([...units, ''])}
            disabled={units.length >= 30}
          >
            <Plus size={15} />
            Adicionar unidade
          </Button>
        </fieldset>
        <label className="field">
          Nome da direção
          <input
            className="input"
            autoComplete="name"
            value={admin.name}
            onChange={(e) => setAdmin({ ...admin, name: e.target.value })}
          />
        </label>
        <label className="field">
          E-mail da direção
          <input
            className="input"
            type="email"
            autoComplete="email"
            value={admin.email}
            onChange={(e) => setAdmin({ ...admin, email: e.target.value })}
          />
        </label>
        <label className="field">
          Senha
          <input
            className="input"
            type="password"
            autoComplete="new-password"
            value={admin.password}
            onChange={(e) => setAdmin({ ...admin, password: e.target.value })}
          />
          <small>Ao menos 10 caracteres, com letras e números.</small>
        </label>
        <label className="field">
          Confirme a senha
          <input
            className="input"
            type="password"
            autoComplete="new-password"
            value={admin.confirm}
            onChange={(e) => setAdmin({ ...admin, confirm: e.target.value })}
          />
        </label>
        {status.needsToken && (
          <label className="field">
            Código de instalação
            <input
              className="input"
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
            />
            <small>Definido pelo responsável técnico em SETUP_TOKEN.</small>
          </label>
        )}
        {error && (
          <p className="error-banner login-error" role="alert">
            {error}
          </p>
        )}
        <Button type="submit" className="login-submit" disabled={busy || !valid}>
          {busy && <RefreshCw className="spin" size={16} />}
          Criar clínica
        </Button>
      </form>
    </AuthFrame>
  );
}
