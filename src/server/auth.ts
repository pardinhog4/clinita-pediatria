import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { query, transaction } from '@/lib/db';
import { ApiError } from '@/lib/errors';
import {
  checkOrigin,
  clientInfo,
  hash,
  issueSession,
  rateLimit,
  setCookies,
  type Context,
} from '@/lib/security';
import { hashPassword, verifyPassword, strongEnough, passwordRule } from '@/lib/password';
import { audit } from './repository';
const roleNames: Record<string, string> = {
  ADMIN: 'Direção clínica',
  MANAGEMENT: 'Gestão da clínica',
  RECEPTION: 'Recepção',
  CLINICIAN: 'Profissional de saúde',
  AUDIT: 'Auditoria',
  FINANCE: 'Financeiro',
};
async function limited(key: string, limit: number, seconds: number, message: string) {
  try {
    await rateLimit(key, limit, seconds);
  } catch (e) {
    if (e instanceof ApiError && e.status === 429) throw new ApiError(429, message);
    throw e;
  }
}

export async function login(req: NextRequest, input: unknown) {
  checkOrigin(req);
  const { ip } = clientInfo(req);
  await limited(
    'login-ip:' + hash(ip).slice(0, 32),
    30,
    60,
    'Muitas tentativas a partir deste dispositivo. Aguarde um minuto.',
  );
  const d = z
    .object({
      email: z.string().trim().toLowerCase().pipe(z.email().max(200)),
      password: z.string().min(1).max(200),
    })
    .strict()
    .parse(input);
  // Bloqueio por conta conta apenas falhas: 8 senhas erradas em 15 minutos. Um login bem-sucedido zera o contador.
  const accountKey = 'login-account:' + hash(d.email).slice(0, 32);
  const [failures] = await query<{ count: number }>(
    'SELECT count FROM rate_limits WHERE key=$1 AND expires_at>now()',
    [accountKey],
  );
  if ((failures?.count || 0) >= 8)
    throw new ApiError(
      429,
      'Muitas tentativas para este e-mail. Aguarde 15 minutos ou peça à direção para redefinir a senha.',
    );
  const [user] = await query<{
    id: string;
    password_hash: string | null;
    must_change_password: boolean;
    tenant_id: string;
    unit_ids: string[];
  }>(
    "SELECT u.id,u.password_hash,u.must_change_password,m.tenant_id,m.unit_ids FROM users u JOIN memberships m ON m.user_id=u.id AND m.active=true WHERE lower(u.email)=$1 ORDER BY m.role='ADMIN' DESC LIMIT 1",
    [d.email],
  );
  // verifyPassword executa o scrypt mesmo sem usuário, para não revelar quais e-mails existem pelo tempo de resposta.
  const valid = await verifyPassword(d.password, user?.password_hash);
  if (!user || !valid) {
    await rateLimit(accountKey, Number.MAX_SAFE_INTEGER, 900);
    throw new ApiError(401, 'E-mail ou senha incorretos.');
  }
  await query('DELETE FROM rate_limits WHERE key=$1', [accountKey]);
  const session = await transaction(async (c) => {
    const s = await issueSession(c, req, user.tenant_id, user.id, 'PASSWORD');
    await c.query('UPDATE users SET last_login_at=now() WHERE id=$1', [user.id]);
    await audit(
      c,
      { tenantId: user.tenant_id, userId: user.id } as Context,
      'auth.login',
      'sessions',
      s.id,
      null,
      { method: 'PASSWORD' },
    );
    return s;
  });
  return setCookies(
    NextResponse.json({
      ok: true,
      csrfToken: session.csrf,
      mustChangePassword: user.must_change_password,
    }),
    session.access,
    session.refresh,
    session.csrf,
  );
}

export async function profile(ctx: Context) {
  const [u] = await query(
    `SELECT u.id,u.name,u.email,u.phone,u.job_title,u.must_change_password,u.created_at,u.last_login_at,u.password_changed_at,(u.password_hash IS NOT NULL) AS has_password,m.role,t.name AS tenant_name FROM users u JOIN memberships m ON m.user_id=u.id AND m.tenant_id=$2 JOIN tenants t ON t.id=m.tenant_id WHERE u.id=$1`,
    [ctx.userId, ctx.tenantId],
  );
  if (!u) throw new ApiError(404, 'Usuário não encontrado.');
  const units = await query(
    'SELECT id,name FROM units WHERE tenant_id=$1 AND id=ANY($2::uuid[]) ORDER BY name',
    [ctx.tenantId, ctx.unitIds],
  );
  return { ...u, role_name: roleNames[u.role] || u.role, units };
}

const optional = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => v || null);
export async function updateProfile(ctx: Context, input: unknown) {
  const d = z
    .object({
      name: z.string().trim().min(3, 'Informe o nome completo.').max(120),
      phone: optional(30).refine((v) => !v || /^[\d\s()+-]{8,30}$/.test(v), 'Telefone inválido.'),
      job_title: optional(80),
    })
    .strict()
    .parse(input);
  await transaction(async (c) => {
    const {
      rows: [before],
    } = await c.query('SELECT name,phone,job_title FROM users WHERE id=$1 FOR UPDATE', [
      ctx.userId,
    ]);
    await c.query('UPDATE users SET name=$2,phone=$3,job_title=$4,updated_at=now() WHERE id=$1', [
      ctx.userId,
      d.name,
      d.phone,
      d.job_title,
    ]);
    await audit(c, ctx, 'profile.updated', 'users', ctx.userId, null, { before, after: d });
  });
  return profile(ctx);
}

export async function changePassword(ctx: Context, input: unknown) {
  const d = z
    .object({
      current: z.string().max(200).optional(),
      password: z.string().max(200),
      confirm: z.string().max(200),
    })
    .strict()
    .parse(input);
  await limited(
    'password:' + ctx.userId,
    5,
    900,
    'Muitas tentativas de troca de senha. Aguarde 15 minutos.',
  );
  if (d.password !== d.confirm)
    throw new ApiError(422, 'A confirmação não corresponde à nova senha.');
  if (!strongEnough(d.password)) throw new ApiError(422, passwordRule);
  const [u] = await query<{ password_hash: string | null }>(
    'SELECT password_hash FROM users WHERE id=$1',
    [ctx.userId],
  );
  if (u.password_hash) {
    if (!d.current || !(await verifyPassword(d.current, u.password_hash)))
      throw new ApiError(422, 'A senha atual está incorreta.');
    if (await verifyPassword(d.password, u.password_hash))
      throw new ApiError(422, 'Escolha uma senha diferente da atual.');
  }
  const next = await hashPassword(d.password);
  return transaction(async (c) => {
    await c.query(
      'UPDATE users SET password_hash=$2,password_changed_at=now(),must_change_password=false,updated_at=now() WHERE id=$1',
      [ctx.userId, next],
    );
    const { rowCount } = await c.query(
      'UPDATE sessions SET revoked_at=now() WHERE user_id=$1 AND id<>$2 AND revoked_at IS NULL',
      [ctx.userId, ctx.sessionId],
    );
    await audit(c, ctx, 'profile.password_changed', 'users', ctx.userId, null, {
      revokedSessions: rowCount,
      firstPassword: !u.password_hash,
    });
    return { ok: true, revoked: rowCount };
  });
}

export async function sessions(ctx: Context) {
  const rows = await query(
    'SELECT id,method,user_agent,ip,created_at,coalesce(last_seen_at,created_at) AS last_seen_at FROM sessions WHERE user_id=$1 AND tenant_id=$2 AND revoked_at IS NULL AND expires_at>now() ORDER BY (id=$3) DESC,coalesce(last_seen_at,created_at) DESC LIMIT 50',
    [ctx.userId, ctx.tenantId, ctx.sessionId],
  );
  return { data: rows.map((r) => ({ ...r, current: r.id === ctx.sessionId })) };
}
export async function revokeSession(ctx: Context, id: string) {
  z.uuid().parse(id);
  if (id === ctx.sessionId) throw new ApiError(422, 'Para encerrar esta sessão, use Sair.');
  return transaction(async (c) => {
    const { rowCount } = await c.query(
      'UPDATE sessions SET revoked_at=now() WHERE id=$1 AND user_id=$2 AND tenant_id=$3 AND revoked_at IS NULL',
      [id, ctx.userId, ctx.tenantId],
    );
    if (!rowCount) throw new ApiError(404, 'Sessão não encontrada ou já encerrada.');
    await audit(c, ctx, 'profile.session_revoked', 'sessions', id, null);
    return { ok: true };
  });
}
export async function revokeOtherSessions(ctx: Context) {
  return transaction(async (c) => {
    const { rowCount } = await c.query(
      'UPDATE sessions SET revoked_at=now() WHERE user_id=$1 AND tenant_id=$2 AND id<>$3 AND revoked_at IS NULL',
      [ctx.userId, ctx.tenantId, ctx.sessionId],
    );
    await audit(c, ctx, 'profile.sessions_revoked', 'sessions', null, null, { count: rowCount });
    return { ok: true, revoked: rowCount };
  });
}
