import { randomBytes } from 'node:crypto';
import type { NextRequest } from 'next/server';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { query, transaction } from '@/lib/db';
import { ApiError } from '@/lib/errors';
import { checkOrigin, clientInfo, hash, rateLimit, type Context } from '@/lib/security';
import { hashPassword, passwordRule, strongEnough } from '@/lib/password';
import { audit } from './repository';
import { appOrigin, deliverSoon, mailMode, queueEmail } from './mail';

// Links de uso único para definir a senha, enviados por e-mail:
// - convite (72 h): a pessoa recém-cadastrada escolhe a própria senha;
// - recuperação (1 h): "Esqueci minha senha" na tela de entrada.
// Só o hash do link fica no banco. Usar um link invalida os outros do mesmo usuário e encerra
// as sessões abertas.

type Purpose = 'INVITE' | 'PASSWORD_RESET';
const validity: Record<Purpose, number> = { INVITE: 72, PASSWORD_RESET: 1 };

async function limited(key: string, limit: number, seconds: number, message: string) {
  try {
    await rateLimit(key, limit, seconds);
  } catch (e) {
    if (e instanceof ApiError && e.status === 429) throw new ApiError(429, message);
    throw e;
  }
}

/** Cria o link (invalidando os anteriores do mesmo tipo) e devolve o endereço completo. */
export async function issueAccessLink(
  c: PoolClient,
  d: { userId: string; tenantId: string | null; purpose: Purpose; createdBy?: string | null },
) {
  await c.query(
    'UPDATE access_tokens SET used_at=now() WHERE user_id=$1 AND purpose=$2 AND used_at IS NULL',
    [d.userId, d.purpose],
  );
  const token = randomBytes(32).toString('base64url');
  await c.query(
    'INSERT INTO access_tokens(user_id,tenant_id,purpose,token_hash,expires_at,created_by) VALUES($1,$2,$3,$4,now()+make_interval(hours=>$5),$6)',
    [d.userId, d.tenantId, d.purpose, hash(token), validity[d.purpose], d.createdBy || null],
  );
  return `${appOrigin()}/acesso/${token}`;
}

/** Convite por e-mail para quem acabou de ganhar acesso (ou reenviado pela gestão). */
export async function queueInvite(
  c: PoolClient,
  ctx: Context,
  user: { id: string; name: string; email: string },
) {
  const {
    rows: [tenant],
  } = await c.query('SELECT name FROM tenants WHERE id=$1', [ctx.tenantId]);
  const url = await issueAccessLink(c, {
    userId: user.id,
    tenantId: ctx.tenantId,
    purpose: 'INVITE',
    createdBy: ctx.userId,
  });
  const first = user.name.split(' ')[0];
  return queueEmail(c, {
    tenantId: ctx.tenantId,
    kind: 'INVITE',
    to: user.email,
    toName: user.name,
    subject: `Seu acesso à ${tenant.name}`,
    body: [
      `Olá, ${first}!`,
      '',
      `${ctx.name} liberou seu acesso à plataforma da ${tenant.name}.`,
      'Para entrar, defina sua senha pelo link abaixo (válido por 72 horas):',
      '',
      url,
      '',
      `Depois, entre com este e-mail (${user.email}) e a senha que você escolher.`,
      'Se você não esperava este convite, ignore esta mensagem.',
    ].join('\n'),
    createdBy: ctx.userId,
  });
}

/**
 * "Esqueci minha senha". A resposta é sempre a mesma, exista ou não a conta, para não revelar
 * quais e-mails estão cadastrados.
 */
export async function requestPasswordReset(req: NextRequest, input: unknown) {
  checkOrigin(req);
  const { email } = z
    .object({ email: z.string().trim().toLowerCase().max(200) })
    .strict()
    .parse(input);
  const { ip } = clientInfo(req);
  await limited(
    'reset-ip:' + hash(ip).slice(0, 32),
    10,
    900,
    'Muitas solicitações. Aguarde 15 minutos.',
  );
  const ok = {
    ok: true,
    message: 'Se este e-mail tiver acesso, enviaremos um link para criar uma nova senha.',
  };
  if (!z.email().safeParse(email).success) return ok;
  try {
    await rateLimit('reset-account:' + hash(email).slice(0, 32), 3, 3600);
  } catch {
    return ok;
  }
  const [user] = await query(
    `SELECT u.id,u.name,u.email,(SELECT m.tenant_id FROM memberships m WHERE m.user_id=u.id AND m.active=true ORDER BY m.created_at LIMIT 1) AS tenant_id
     FROM users u WHERE lower(u.email)=$1`,
    [email],
  );
  if (!user?.tenant_id) return ok;
  const id = await transaction(async (c) => {
    const url = await issueAccessLink(c, {
      userId: user.id,
      tenantId: user.tenant_id,
      purpose: 'PASSWORD_RESET',
    });
    await c.query(
      "INSERT INTO audit_events(tenant_id,unit_id,actor_id,action,entity_type,entity_id,details) VALUES($1,NULL,$2,'user.password_reset_requested','users',$2,$3)",
      [user.tenant_id, user.id, JSON.stringify({ ip: hash(ip).slice(0, 16) })],
    );
    return queueEmail(c, {
      tenantId: user.tenant_id,
      kind: 'PASSWORD_RESET',
      to: user.email,
      toName: user.name,
      subject: 'Criar uma nova senha',
      body: [
        `Olá, ${user.name.split(' ')[0]}!`,
        '',
        'Recebemos um pedido para criar uma nova senha para o seu acesso.',
        'Use o link abaixo (válido por 1 hora, uma única vez):',
        '',
        url,
        '',
        'Se não foi você, ignore esta mensagem: sua senha atual continua valendo.',
      ].join('\n'),
    });
  });
  await deliverSoon(id);
  return ok;
}

async function findToken(token: string, c?: PoolClient) {
  if (!/^[A-Za-z0-9_-]{30,100}$/.test(token)) return null;
  const sql = `SELECT t.id,t.user_id,t.tenant_id,t.purpose,t.expires_at,t.used_at,u.name,u.email
    FROM access_tokens t JOIN users u ON u.id=t.user_id WHERE t.token_hash=$1${c ? ' FOR UPDATE OF t' : ''}`;
  const rows = c ? (await c.query(sql, [hash(token)])).rows : await query(sql, [hash(token)]);
  const t = rows[0];
  if (!t || t.used_at || new Date(t.expires_at) <= new Date()) return null;
  return t;
}

const invalid = () =>
  new ApiError(410, 'Este link expirou ou já foi usado. Peça um novo na tela de entrada.');

/** Dados para a tela do link (sem revelar o e-mail inteiro). */
export async function accessLinkInfo(token: string) {
  const t = await findToken(token);
  if (!t) throw invalid();
  const [user, domain] = t.email.split('@');
  return {
    purpose: t.purpose as Purpose,
    name: t.name.split(' ')[0],
    email: user.slice(0, 2) + '•••@' + domain,
    expires_at: t.expires_at,
  };
}

/** Define a senha pelo link. Encerra sessões abertas e invalida os outros links do usuário. */
export async function useAccessLink(req: NextRequest, token: string, input: unknown) {
  checkOrigin(req);
  const d = z
    .object({ password: z.string().max(200), confirm: z.string().max(200) })
    .strict()
    .parse(input);
  const { ip } = clientInfo(req);
  await limited(
    'access-link:' + hash(ip).slice(0, 32),
    20,
    900,
    'Muitas tentativas. Aguarde 15 minutos.',
  );
  if (d.password !== d.confirm)
    throw new ApiError(422, 'A confirmação não corresponde à nova senha.');
  if (!strongEnough(d.password)) throw new ApiError(422, passwordRule);
  const passwordHash = await hashPassword(d.password);
  return transaction(async (c) => {
    const t = await findToken(token, c);
    if (!t) throw invalid();
    await c.query(
      'UPDATE users SET password_hash=$2,must_change_password=false,password_changed_at=now(),updated_at=now() WHERE id=$1',
      [t.user_id, passwordHash],
    );
    await c.query('UPDATE access_tokens SET used_at=now() WHERE user_id=$1 AND used_at IS NULL', [
      t.user_id,
    ]);
    const revoked =
      (
        await c.query(
          'UPDATE sessions SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL',
          [t.user_id],
        )
      ).rowCount || 0;
    await c.query('DELETE FROM rate_limits WHERE key=$1', [
      'login-account:' + hash(t.email.toLowerCase()).slice(0, 32),
    ]);
    await audit(
      c,
      { tenantId: t.tenant_id, userId: t.user_id } as Context,
      t.purpose === 'INVITE' ? 'user.invite_accepted' : 'user.password_reset_completed',
      'users',
      t.user_id,
      null,
      { revokedSessions: revoked },
    );
    return { ok: true, email: t.email };
  });
}

export { mailMode };
