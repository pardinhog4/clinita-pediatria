import nodemailer, { type Transporter } from 'nodemailer';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { query, transaction } from '@/lib/db';
import { permit, type Context } from '@/lib/security';
import { managers } from './repository';

// E-mail transacional por SMTP genérico (Google Workspace, Microsoft 365, SES, Resend…): basta
// preencher SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS e MAIL_FROM no .env.
// Sem SMTP_HOST, o sistema fica em SIMULAÇÃO: os e-mails vão para a caixa de saída
// (Integrações → E-mail) com o texto completo e nada sai da máquina.
//
// Fluxo: queueEmail() grava na caixa de saída dentro da transação de quem pede;
// deliverPending() envia (logo após a gravação e, para novas tentativas, pelo worker).

export type MailKind = 'INVITE' | 'PASSWORD_RESET' | 'PAYOUT_MIRROR' | 'TEST';
export type MailMode = 'SMTP' | 'SIMULATED';

export function mailMode(): MailMode {
  return process.env.SMTP_HOST ? 'SMTP' : 'SIMULATED';
}

/** Situação para a tela de Integrações (sem expor usuário ou senha). */
export function mailStatus() {
  const mode = mailMode();
  return {
    mode,
    host: mode === 'SMTP' ? process.env.SMTP_HOST : null,
    from: process.env.MAIL_FROM || null,
    origin: appOrigin(),
  };
}

export function appOrigin() {
  return (process.env.APP_ORIGIN || 'http://localhost:3005').replace(/\/$/, '');
}

let transporter: Transporter | null = null;
let testTransport: Transporter | null = null;
/** Testes trocam o SMTP por um transporte em memória. */
export function setMailTransportForTests(t: Transporter | null) {
  testTransport = t;
}
function transport() {
  if (testTransport) return testTransport;
  if (!transporter) {
    const port = Number(process.env.SMTP_PORT || 587);
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port,
      secure: process.env.SMTP_SECURE ? process.env.SMTP_SECURE === 'true' : port === 465,
      auth: process.env.SMTP_USER
        ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS || '' }
        : undefined,
      // Nunca lê arquivos nem URLs a partir do conteúdo da mensagem.
      disableFileAccess: true,
      disableUrlAccess: true,
      connectionTimeout: 15000,
      greetingTimeout: 15000,
      socketTimeout: 30000,
    });
  }
  return transporter;
}

export async function queueEmail(
  c: PoolClient,
  mail: {
    tenantId: string | null;
    kind: MailKind;
    to: string;
    toName?: string;
    subject: string;
    body: string;
    createdBy?: string | null;
  },
) {
  const {
    rows: [row],
  } = await c.query(
    'INSERT INTO email_outbox(tenant_id,kind,to_email,to_name,subject,body,created_by) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id',
    [
      mail.tenantId,
      mail.kind,
      mail.to.trim().toLowerCase(),
      mail.toName || '',
      mail.subject,
      mail.body,
      mail.createdBy || null,
    ],
  );
  return row.id as string;
}

const MAX_ATTEMPTS = 5;

/**
 * Envia (ou simula) os e-mails pendentes. Falhas temporárias voltam a ser tentadas com espera
 * crescente (1, 4, 9, 16 min); depois de 5 tentativas o e-mail fica como FAILED.
 */
export async function deliverPending(limit = 20, onlyId?: string) {
  const rows = await query(
    `UPDATE email_outbox SET next_attempt_at=now()+interval '2 minutes' WHERE id IN(
       SELECT id FROM email_outbox WHERE status IN('QUEUED','FAILED') AND attempts<$1 AND next_attempt_at<=now()
       AND ($3::uuid IS NULL OR id=$3) ORDER BY created_at LIMIT $2 FOR UPDATE SKIP LOCKED)
     RETURNING id,to_email,to_name,subject,body,attempts`,
    [MAX_ATTEMPTS, limit, onlyId || null],
  );
  const mode = testTransport ? 'SMTP' : mailMode();
  let sent = 0;
  for (const m of rows) {
    if (mode === 'SIMULATED') {
      await query("UPDATE email_outbox SET status='SIMULATED',sent_at=now() WHERE id=$1", [m.id]);
      continue;
    }
    try {
      const info = await transport().sendMail({
        from: process.env.MAIL_FROM || process.env.SMTP_USER,
        to: m.to_name ? { name: m.to_name, address: m.to_email } : m.to_email,
        subject: m.subject,
        text: m.body,
      });
      // Enviado: o corpo sai do banco (pode conter link de acesso de uso único).
      await query(
        "UPDATE email_outbox SET status='SENT',sent_at=now(),attempts=attempts+1,provider_id=$2,body=NULL,last_error=NULL WHERE id=$1",
        [m.id, String(info.messageId || '').slice(0, 300)],
      );
      sent++;
    } catch (e) {
      const attempts = m.attempts + 1;
      await query(
        "UPDATE email_outbox SET status='FAILED',attempts=$2,last_error=$3,next_attempt_at=now()+make_interval(mins=>$4) WHERE id=$1",
        [m.id, attempts, String((e as Error).message || e).slice(0, 1000), attempts * attempts],
      );
    }
  }
  return { processed: rows.length, sent };
}

/** Tenta entregar logo após gravar; falha aqui não desfaz a operação (o worker tenta de novo). */
export async function deliverSoon(id: string) {
  try {
    await deliverPending(1, id);
  } catch {
    // O worker reprocessa a caixa de saída a cada minuto.
  }
}

// ---- Integrações → E-mail (gestão da clínica) ----

/**
 * Situação do e-mail e últimos envios da clínica. Em simulação, o texto completo aparece para a
 * gestão conferir (e usar os links de teste); e-mails enviados de verdade não guardam o texto.
 */
export async function emailOutbox(ctx: Context) {
  permit(ctx, managers);
  const data = await query(
    `SELECT id,kind,to_email,to_name,subject,CASE WHEN status='SIMULATED' THEN body END AS body,status,attempts,last_error,created_at,sent_at
     FROM email_outbox WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 50`,
    [ctx.tenantId],
  );
  return { status: mailStatus(), data };
}

/** E-mail de teste para conferir a configuração do SMTP. */
export async function sendTestEmail(ctx: Context, input: unknown) {
  permit(ctx, managers);
  const { to } = z
    .object({ to: z.string().trim().toLowerCase().pipe(z.email('E-mail inválido.').max(200)) })
    .strict()
    .parse(input);
  const id = await transaction((c) =>
    queueEmail(c, {
      tenantId: ctx.tenantId,
      kind: 'TEST',
      to,
      subject: 'Teste de e-mail da plataforma',
      body: `Este é um e-mail de teste enviado por ${ctx.name}.\nSe chegou, o envio de convites e recuperação de senha está funcionando.`,
      createdBy: ctx.userId,
    }),
  );
  await deliverPending(1, id);
  const [row] = await query('SELECT status,last_error FROM email_outbox WHERE id=$1', [id]);
  return { id, status: row.status, error: row.last_error };
}
