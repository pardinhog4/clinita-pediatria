import { NextRequest, NextResponse } from 'next/server';
import { SignJWT, jwtVerify } from 'jose';
import { randomBytes, randomUUID, createHash, timingSafeEqual } from 'node:crypto';
import type { PoolClient } from 'pg';
import { query, transaction } from './db';
import { ApiError } from './errors';
export type Role = 'ADMIN' | 'MANAGEMENT' | 'RECEPTION' | 'CLINICIAN' | 'AUDIT' | 'FINANCE';
export type Context = {
  sessionId: string;
  tenantId: string;
  userId: string;
  name: string;
  role: Role;
  unitIds: string[];
  mustChangePassword?: boolean;
};
// Com senha provisória, só o perfil (troca de senha), a sessão e os metadados ficam liberados.
const firstAccessPaths = ['/api/profile', '/api/auth/', '/api/meta'];
const ISSUER = 'integrar',
  AUDIENCE = 'integrar-web',
  ACCESS = 15 * 60,
  REFRESH = 7 * 86400;
export const hash = (v: string) => createHash('sha256').update(v).digest('hex');
const equal = (a: string, b: string) =>
  a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const secret = (refresh = false) => {
  const value = process.env[refresh ? 'REFRESH_TOKEN_SECRET' : 'ACCESS_TOKEN_SECRET'];
  if (!value || value.length < 48) throw new ApiError(503, 'Segredos de sessão não configurados.');
  if (process.env.ACCESS_TOKEN_SECRET === process.env.REFRESH_TOKEN_SECRET)
    throw new ApiError(503, 'Use segredos distintos.');
  return new TextEncoder().encode(value);
};
export function checkOrigin(req: NextRequest) {
  const expected = new URL(process.env.APP_ORIGIN || 'http://localhost:3005').origin;
  if (req.headers.get('origin') !== expected)
    throw new ApiError(403, 'Origem da requisição não autorizada.');
}
export async function rateLimit(key: string, limit = 120, seconds = 60) {
  const [bucket] = await query<{ count: number }>(
    `INSERT INTO rate_limits(key,count,expires_at) VALUES($1,1,now()+($2::int*interval '1 second')) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN rate_limits.expires_at<now() THEN 1 ELSE rate_limits.count+1 END,expires_at=CASE WHEN rate_limits.expires_at<now() THEN excluded.expires_at ELSE rate_limits.expires_at END RETURNING count`,
    [key, seconds],
  );
  if (bucket.count > limit) throw new ApiError(429, 'Muitas solicitações. Aguarde um minuto.');
}
export async function signToken(
  session: { id: string; tenant_id: string; user_id: string },
  refresh = false,
) {
  return new SignJWT({
    sid: session.id,
    tid: session.tenant_id,
    typ: refresh ? 'refresh' : 'access',
  })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(session.user_id)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setJti(randomUUID())
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + (refresh ? REFRESH : ACCESS))
    .sign(secret(refresh));
}
async function verify(token: string, refresh = false) {
  try {
    const { payload } = await jwtVerify(token, secret(refresh), {
      algorithms: ['HS256'],
      issuer: ISSUER,
      audience: AUDIENCE,
    });
    if (
      payload.typ !== (refresh ? 'refresh' : 'access') ||
      typeof payload.sid !== 'string' ||
      typeof payload.tid !== 'string' ||
      !payload.sub
    )
      throw Error();
    return payload as typeof payload & { sid: string; tid: string; sub: string };
  } catch {
    throw new ApiError(401, 'Sessão expirada ou inválida.');
  }
}
export async function context(req: NextRequest, write = false): Promise<Context> {
  if (write) checkOrigin(req);
  const access = req.cookies.get('integrar_access')?.value;
  if (!access) throw new ApiError(401, 'Sessão necessária.');
  const p = await verify(access);
  const [row] = await query(
    `SELECT s.id,s.tenant_id,s.user_id,s.csrf_hash,u.name,u.must_change_password,m.role,ARRAY(SELECT x FROM unnest(m.unit_ids) x WHERE EXISTS(SELECT 1 FROM units un WHERE un.id=x AND un.active)) AS unit_ids FROM sessions s JOIN users u ON u.id=s.user_id JOIN memberships m ON m.user_id=s.user_id AND m.tenant_id=s.tenant_id WHERE s.id=$1 AND s.tenant_id=$2 AND s.user_id=$3 AND s.revoked_at IS NULL AND s.expires_at>now() AND m.active=true`,
    [p.sid, p.tid, p.sub],
  );
  if (!row) throw new ApiError(401, 'Sessão revogada.');
  if (write) {
    const csrf = req.headers.get('x-csrf-token') || '',
      cookie = req.cookies.get('integrar_csrf')?.value || '';
    if (!csrf || !equal(csrf, cookie) || !equal(hash(csrf), row.csrf_hash))
      throw new ApiError(403, 'Confirmação de segurança inválida.');
  }
  await rateLimit('session:' + row.id + (write ? ':write' : ':read'), write ? 60 : 300);
  if (row.must_change_password && !firstAccessPaths.some((p) => req.nextUrl.pathname.startsWith(p)))
    throw new ApiError(403, 'Defina uma nova senha em Meu perfil para continuar.');
  return {
    sessionId: row.id,
    tenantId: row.tenant_id,
    userId: row.user_id,
    name: row.name,
    role: row.role,
    unitIds: row.unit_ids,
    mustChangePassword: row.must_change_password,
  };
}
export function permit(ctx: Context, roles: Role[]) {
  if (!roles.includes(ctx.role)) throw new ApiError(403, 'Seu perfil não acessa esta operação.');
}
export function assertUnit(ctx: Context, unitId: string) {
  if (!ctx.unitIds.includes(unitId)) throw new ApiError(403, 'Unidade não autorizada.');
}
export function setCookies(response: NextResponse, access: string, refresh: string, csrf: string) {
  const secure = new URL(process.env.APP_ORIGIN || 'http://localhost:3005').protocol === 'https:';
  response.cookies.set('integrar_access', access, {
    httpOnly: true,
    secure,
    sameSite: 'strict',
    path: '/',
    maxAge: ACCESS,
  });
  response.cookies.set('integrar_refresh', refresh, {
    httpOnly: true,
    secure,
    sameSite: 'strict',
    path: '/api/auth',
    maxAge: REFRESH,
  });
  response.cookies.set('integrar_csrf', csrf, {
    httpOnly: false,
    secure,
    sameSite: 'strict',
    path: '/',
    maxAge: REFRESH,
  });
  response.headers.set('Cache-Control', 'no-store');
  return response;
}
export function clientInfo(req: NextRequest) {
  return {
    ip: (req.headers.get('x-forwarded-for') || '').split(',')[0].trim().slice(0, 64) || 'local',
    userAgent: (req.headers.get('user-agent') || '').slice(0, 300),
  };
}
export async function issueSession(
  c: PoolClient,
  req: NextRequest,
  tenantId: string,
  userId: string,
  method: 'PASSWORD',
) {
  const session = { id: randomUUID(), tenant_id: tenantId, user_id: userId },
    csrf = randomBytes(32).toString('base64url');
  const access = await signToken(session),
    refresh = await signToken(session, true);
  const client = clientInfo(req);
  await c.query(
    `INSERT INTO sessions(id,tenant_id,user_id,refresh_hash,csrf_hash,expires_at,method,user_agent,ip,last_seen_at) VALUES($1,$2,$3,$4,$5,now()+interval '7 days',$6,$7,$8,now())`,
    [session.id, tenantId, userId, hash(refresh), hash(csrf), method, client.userAgent, client.ip],
  );
  return { id: session.id, access, refresh, csrf };
}
export async function rotate(req: NextRequest) {
  checkOrigin(req);
  const token = req.cookies.get('integrar_refresh')?.value;
  await rateLimit('refresh:' + hash(token || 'missing').slice(0, 32), 20);
  if (!token) throw new ApiError(401, 'Refresh token ausente.');
  const p = await verify(token, true);
  const result = await transaction(async (c) => {
    const {
      rows: [s],
    } = await c.query(
      'SELECT * FROM sessions WHERE id=$1 AND tenant_id=$2 AND user_id=$3 FOR UPDATE',
      [p.sid, p.tid, p.sub],
    );
    if (!s || s.revoked_at || new Date(s.expires_at) <= new Date()) return null;
    const csrf = req.headers.get('x-csrf-token') || '';
    if (
      !csrf ||
      !equal(hash(csrf), s.csrf_hash) ||
      !equal(csrf, req.cookies.get('integrar_csrf')?.value || '')
    )
      throw new ApiError(403, 'Confirmação de segurança inválida.');
    if (!equal(s.refresh_hash, hash(token))) {
      await c.query('UPDATE sessions SET revoked_at=now() WHERE id=$1', [s.id]);
      return null;
    }
    const refresh = await signToken(s, true),
      access = await signToken(s);
    await c.query('UPDATE sessions SET refresh_hash=$2,last_seen_at=now() WHERE id=$1', [
      s.id,
      hash(refresh),
    ]);
    return { refresh, access, csrf };
  });
  if (!result) throw new ApiError(401, 'Refresh token reutilizado, expirado ou revogado.');
  return setCookies(
    NextResponse.json({ ok: true, csrfToken: result.csrf }),
    result.access,
    result.refresh,
    result.csrf,
  );
}
export async function logout(req: NextRequest) {
  const c = await context(req, true);
  await query('UPDATE sessions SET revoked_at=now() WHERE id=$1 AND tenant_id=$2', [
    c.sessionId,
    c.tenantId,
  ]);
  const r = NextResponse.json({ ok: true });
  for (const [name, path] of [
    ['integrar_access', '/'],
    ['integrar_refresh', '/api/auth'],
    ['integrar_csrf', '/'],
  ])
    r.cookies.set(name, '', { maxAge: 0, path });
  return r;
}
