'use client';
import { useState } from 'react';
import { Mail, Send } from 'lucide-react';
import { post } from '@/lib/client';
import type { Entity } from '@/lib/types';
import { Badge } from '../atoms/badge';
import { Button } from '../atoms/button';
import { Dialog } from '../molecules/dialog';
import { useApi } from '@/hooks/use-api';
import { useNotices } from '@/stores/workspace';

// Integrações → E-mail: modo (SMTP ou simulação), teste de envio e caixa de saída.

type Outbox = {
  status: { mode: 'SMTP' | 'SIMULATED'; host: string | null; from: string | null; origin: string };
  data: Entity[];
};

const kinds: Record<string, string> = {
  INVITE: 'Convite',
  PASSWORD_RESET: 'Nova senha',
  PAYOUT_MIRROR: 'Espelho de repasse',
  TEST: 'Teste',
};
const statuses: Record<string, [string, string]> = {
  QUEUED: ['PENDING', 'Na fila'],
  SENT: ['APPROVED', 'Enviado'],
  FAILED: ['REJECTED', 'Falhou'],
  SIMULATED: ['neutral', 'Simulado'],
};

export function EmailBoard() {
  const outbox = useApi<Outbox>('email');
  const add = useNotices((s) => s.add);
  const [to, setTo] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [open, setOpen] = useState<Entity | null>(null);
  const status = outbox.data?.status;

  async function test() {
    setBusy(true);
    setError('');
    try {
      const r = await post<{ status: string; error: string | null }>('email/test', { to });
      if (r.status === 'FAILED') setError('O servidor de e-mail recusou o envio: ' + r.error);
      else add(r.status === 'SENT' ? 'E-mail de teste enviado.' : 'E-mail de teste simulado.');
      outbox.reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card email-board">
      <div className="toolbar">
        <h2>
          <Mail size={20} /> E-mail
        </h2>
        {status && (
          <Badge
            value={status.mode === 'SMTP' ? 'APPROVED' : 'PENDING'}
            label={status.mode === 'SMTP' ? 'SMTP configurado' : 'Simulação'}
          />
        )}
      </div>
      {outbox.error && <p className="error-banner">{outbox.error}</p>}
      {status?.mode === 'SIMULATED' ? (
        <p className="note">
          Nenhum servidor de e-mail configurado: convites e links de nova senha ficam só nesta caixa
          de saída e não saem da máquina. Para enviar de verdade, o responsável técnico preenche{' '}
          <code>SMTP_HOST</code>, <code>SMTP_PORT</code>, <code>SMTP_USER</code>,{' '}
          <code>SMTP_PASS</code> e <code>MAIL_FROM</code> no servidor.
        </p>
      ) : status ? (
        <p className="muted">
          Enviando por <b>{status.host}</b>
          {status.from ? (
            <>
              {' '}
              como <b>{status.from}</b>
            </>
          ) : null}
          . Os links apontam para {status.origin}.
        </p>
      ) : null}

      <div className="email-test">
        <label className="field">
          Enviar e-mail de teste para
          <input
            className="input"
            type="email"
            value={to}
            placeholder="nome@clinica.com.br"
            onChange={(e) => setTo(e.target.value)}
          />
        </label>
        <Button
          variant="secondary"
          disabled={busy || !/\S+@\S+\.\S+/.test(to)}
          onClick={() => void test()}
        >
          <Send size={15} />
          Enviar teste
        </Button>
      </div>
      {error && <p className="error-banner">{error}</p>}

      <h3>Caixa de saída</h3>
      {!outbox.data?.data.length ? (
        <p className="muted">Nenhum e-mail ainda.</p>
      ) : (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Quando</th>
                <th>Tipo</th>
                <th>Para</th>
                <th>Assunto</th>
                <th>Situação</th>
              </tr>
            </thead>
            <tbody>
              {outbox.data.data.map((m) => {
                const [badge, label] = statuses[m.status] || ['neutral', m.status];
                return (
                  <tr
                    key={m.id}
                    className={m.body ? 'clickable' : undefined}
                    onClick={() => m.body && setOpen(m)}
                  >
                    <td>{new Date(m.created_at).toLocaleString('pt-BR')}</td>
                    <td>{kinds[m.kind] || m.kind}</td>
                    <td>{m.to_email}</td>
                    <td>{m.subject}</td>
                    <td>
                      <Badge value={badge} label={label} />
                      {m.status === 'FAILED' && m.last_error && (
                        <small className="field-error">
                          {m.last_error} · tentativa {m.attempts} de 5
                        </small>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {open && (
        <Dialog title={open.subject} onClose={() => setOpen(null)} wide>
          <p className="muted">
            Para {open.to_name ? `${open.to_name} · ` : ''}
            {open.to_email} · simulado, não enviado
          </p>
          <pre className="email-body">{open.body}</pre>
        </Dialog>
      )}
    </section>
  );
}
