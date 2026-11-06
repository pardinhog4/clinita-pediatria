import { randomInt } from 'node:crypto';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { query, transaction } from '@/lib/db';
import { ApiError } from '@/lib/errors';
import { permit, hash, type Context, type Role } from '@/lib/security';
import { hashPassword } from '@/lib/password';
import { audit, managers } from './repository';
import { queueInvite } from './access-links';
import { deliverSoon, mailMode } from './mail';
const roles = ['ADMIN', 'MANAGEMENT', 'RECEPTION', 'CLINICIAN', 'AUDIT', 'FINANCE'] as const;

// Senha provisória legível (sem 0/O, 1/l/I), em três grupos, sempre com letras e números.
export function temporaryPassword() {
  const letters = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ',
    digits = '23456789',
    all = letters + digits;
  for (;;) {
    const raw = Array.from({ length: 12 }, () => all[randomInt(all.length)]).join('');
    if (/\d/.test(raw) && /[a-zA-Z]/.test(raw)) return raw.match(/.{4}/g)!.join('-');
  }
}

const input = z
  .object({
    name: z.string().trim().min(3, 'Informe o nome completo.').max(120),
    email: z.string().trim().toLowerCase().pipe(z.email('E-mail inválido.').max(200)),
    role: z.enum(roles),
    unit_ids: z.array(z.uuid()).max(50).default([]),
    professional_id: z.uuid().nullable().optional(),
    job_title: z
      .string()
      .trim()
      .max(80)
      .transform((v) => v || null)
      .optional(),
  })
  .strict();

function guardRole(ctx: Context, role: Role) {
  if (role === 'ADMIN' && ctx.role !== 'ADMIN')
    throw new ApiError(403, 'Somente a direção clínica concede o perfil de direção.');
}
async function target(c: PoolClient, ctx: Context, id: string) {
  z.uuid().parse(id);
  if (id === ctx.userId)
    throw new ApiError(
      422,
      'Seus próprios dados e acessos são ajustados em Meu perfil ou por outro gestor.',
    );
  const {
    rows: [row],
  } = await c.query(
    `SELECT u.id,u.name,u.email,u.job_title,m.role,m.unit_ids,m.active FROM users u JOIN memberships m ON m.user_id=u.id AND m.tenant_id=$1 WHERE u.id=$2 FOR UPDATE OF m`,
    [ctx.tenantId, id],
  );
  if (!row) throw new ApiError(404, 'Usuário não encontrado.');
  if (row.role === 'ADMIN') guardRole(ctx, 'ADMIN');
  return row;
}
async function assertOtherAdmin(c: PoolClient, ctx: Context, id: string) {
  const {
    rows: [{ count }],
  } = await c.query(
    `SELECT count(*)::int AS count FROM memberships WHERE tenant_id=$1 AND role='ADMIN' AND active=true AND user_id<>$2`,
    [ctx.tenantId, id],
  );
  if (!count) throw new ApiError(422, 'A clínica precisa de ao menos uma conta ativa de direção.');
}
// Resolve unidades e vínculo profissional: o profissional define a unidade de quem atende.
async function access(
  c: PoolClient,
  ctx: Context,
  d: z.infer<typeof input>,
  userId: string | null,
) {
  let unitIds = [...new Set(d.unit_ids)],
    professional: any = null;
  if (d.role === 'CLINICIAN') {
    if (!d.professional_id)
      throw new ApiError(
        422,
        'Vincule o cadastro do profissional para liberar a agenda e os prontuários dele.',
      );
    const {
      rows: [p],
    } = await c.query(
      "SELECT p.id,p.name,p.unit_id,p.metadata->>'user_id' AS user_id,lu.email AS linked_email FROM professionals p LEFT JOIN users lu ON lu.id::text=p.metadata->>'user_id' WHERE p.tenant_id=$1 AND p.id=$2 AND p.active=true FOR UPDATE OF p",
      [ctx.tenantId, d.professional_id],
    );
    if (!p) throw new ApiError(422, 'Profissional inválido ou desligado.');
    if (p.user_id && p.user_id !== userId)
      throw new ApiError(409, 'Este profissional já está vinculado a outro usuário.');
    professional = p;
    unitIds = [p.unit_id];
  }
  if (!unitIds.length) throw new ApiError(422, 'Selecione ao menos uma unidade.');
  if (unitIds.some((u) => !ctx.unitIds.includes(u)))
    throw new ApiError(403, 'Você só concede acesso às unidades que administra.');
  return { unitIds, professional };
}
async function relink(c: PoolClient, ctx: Context, userId: string, professionalId: string | null) {
  await c.query(
    "UPDATE professionals SET metadata=metadata-'user_id',version=version+1 WHERE tenant_id=$1 AND metadata->>'user_id'=$2::text AND id IS DISTINCT FROM $3::uuid",
    [ctx.tenantId, userId, professionalId],
  );
  if (professionalId)
    await c.query(
      "UPDATE professionals SET metadata=metadata||jsonb_build_object('user_id',$3::text),version=version+1 WHERE tenant_id=$1 AND id=$2 AND metadata->>'user_id' IS DISTINCT FROM $3::text",
      [ctx.tenantId, professionalId, userId],
    );
}

export async function listUsers(ctx: Context, params: URLSearchParams) {
  permit(ctx, managers);
  const q = '%' + (params.get('q') || '').trim().slice(0, 100) + '%',
    role = params.get('role') || '',
    status = params.get('status') || 'active';
  const rows = await query(
    `SELECT u.id,u.name,u.email,u.job_title,u.last_login_at,(u.password_hash IS NOT NULL) AS has_password,u.must_change_password,m.role,m.unit_ids,m.active,m.created_at,m.deactivated_at,(u.id=$2) AS is_self,p.id AS professional_id,p.name AS professional_name
  FROM users u JOIN memberships m ON m.user_id=u.id AND m.tenant_id=$1 LEFT JOIN professionals p ON p.tenant_id=m.tenant_id AND p.metadata->>'user_id'=u.id::text
  WHERE (u.name ILIKE $3 OR u.email ILIKE $3) AND ($4='' OR m.role=$4) AND ($5='all' OR m.active=($5='active')) ORDER BY m.active DESC,u.name LIMIT 500`,
    [ctx.tenantId, ctx.userId, q, role, status],
  );
  const [summary] = await query(
    `SELECT count(*) FILTER (WHERE m.active)::int AS active,count(*) FILTER (WHERE NOT m.active)::int AS inactive,count(*) FILTER (WHERE m.active AND u.must_change_password)::int AS pending,count(*) FILTER (WHERE m.active AND u.password_hash IS NULL)::int AS without_password FROM users u JOIN memberships m ON m.user_id=u.id AND m.tenant_id=$1`,
    [ctx.tenantId],
  );
  const units = await query(
    'SELECT id,name FROM units WHERE tenant_id=$1 AND id=ANY($2::uuid[]) ORDER BY name',
    [ctx.tenantId, ctx.unitIds],
  );
  const professionals = await query(
    `SELECT p.id,p.name,p.specialty,p.unit_id,lu.id AS user_id FROM professionals p LEFT JOIN users lu ON lu.id::text=p.metadata->>'user_id' WHERE p.tenant_id=$1 AND p.active=true AND p.unit_id=ANY($2::uuid[]) ORDER BY p.name`,
    [ctx.tenantId, ctx.unitIds],
  );
  return { data: rows, summary, units, professionals, canGrantAdmin: ctx.role === 'ADMIN' };
}

export async function createUser(ctx: Context, raw: unknown) {
  permit(ctx, managers);
  const d = input.parse(raw);
  guardRole(ctx, d.role);
  const password = temporaryPassword(),
    passwordHash = await hashPassword(password);
  const user = await transaction(async (c) => {
    const {
      rows: [existing],
    } = await c.query(
      'SELECT u.id,m.user_id IS NOT NULL AS member FROM users u LEFT JOIN memberships m ON m.user_id=u.id AND m.tenant_id=$2 WHERE lower(u.email)=$1',
      [d.email, ctx.tenantId],
    );
    if (existing?.member)
      throw new ApiError(
        409,
        'Já existe um usuário com este e-mail. Reative ou edite o cadastro existente.',
      );
    const {
      rows: [u],
    } = existing
      ? await c.query(
          'UPDATE users SET name=$2,job_title=coalesce($3,job_title),password_hash=$4,must_change_password=true,password_changed_at=now(),updated_at=now() WHERE id=$1 RETURNING id',
          [existing.id, d.name, d.job_title ?? null, passwordHash],
        )
      : await c.query(
          'INSERT INTO users(name,email,job_title,password_hash,must_change_password,password_changed_at) VALUES($1,$2,$3,$4,true,now()) RETURNING id',
          [d.name, d.email, d.job_title ?? null, passwordHash],
        );
    const { unitIds, professional } = await access(c, ctx, d, u.id);
    await c.query(
      'INSERT INTO memberships(tenant_id,user_id,role,unit_ids,active,created_by) VALUES($1,$2,$3,$4,true,$5)',
      [ctx.tenantId, u.id, d.role, unitIds, ctx.userId],
    );
    await relink(c, ctx, u.id, professional?.id || null);
    await audit(c, ctx, 'user.created', 'users', u.id, null, {
      email: d.email,
      role: d.role,
      unitIds,
      professionalId: professional?.id || null,
    });
    // Convite por e-mail com link para a pessoa definir a própria senha (72 h).
    const mailId = await queueInvite(c, ctx, { id: u.id, name: d.name, email: d.email });
    return { ...u, mailId };
  });
  await deliverSoon(user.mailId);
  return {
    id: user.id,
    email: d.email,
    temporaryPassword: password,
    invite: { mode: mailMode() },
  };
}

export async function updateUser(ctx: Context, id: string, raw: unknown) {
  permit(ctx, managers);
  const d = input.parse(raw);
  guardRole(ctx, d.role);
  return transaction(async (c) => {
    const before = await target(c, ctx, id);
    if (before.role === 'ADMIN' && d.role !== 'ADMIN' && before.active)
      await assertOtherAdmin(c, ctx, id);
    const {
      rows: [clash],
    } = await c.query('SELECT id FROM users WHERE lower(email)=$1 AND id<>$2', [d.email, id]);
    if (clash) throw new ApiError(409, 'Outro usuário já usa este e-mail.');
    const { unitIds, professional } = await access(c, ctx, d, id);
    await c.query('UPDATE users SET name=$2,email=$3,job_title=$4,updated_at=now() WHERE id=$1', [
      id,
      d.name,
      d.email,
      d.job_title ?? null,
    ]);
    await c.query(
      'UPDATE memberships SET role=$3,unit_ids=$4,updated_at=now() WHERE tenant_id=$1 AND user_id=$2',
      [ctx.tenantId, id, d.role, unitIds],
    );
    await relink(c, ctx, id, professional?.id || null);
    // E-mail é a identidade de login: trocá-lo encerra as sessões abertas.
    if (before.email !== d.email)
      await c.query(
        'UPDATE sessions SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL',
        [id],
      );
    await audit(c, ctx, 'user.updated', 'users', id, null, {
      before: {
        name: before.name,
        email: before.email,
        role: before.role,
        unitIds: before.unit_ids,
      },
      after: {
        name: d.name,
        email: d.email,
        role: d.role,
        unitIds,
        professionalId: professional?.id || null,
      },
    });
    return { ok: true };
  });
}

export async function setUserActive(ctx: Context, id: string, raw: unknown) {
  permit(ctx, managers);
  const { active, reason } = z
    .object({ active: z.boolean(), reason: z.string().trim().max(300).optional() })
    .strict()
    .parse(raw);
  return transaction(async (c) => {
    const before = await target(c, ctx, id);
    if (before.active === active) return { ok: true };
    if (!active && before.role === 'ADMIN') await assertOtherAdmin(c, ctx, id);
    if (!active && !reason) throw new ApiError(422, 'Informe o motivo da desativação.');
    await c.query(
      'UPDATE memberships SET active=$3,deactivated_at=CASE WHEN $3 THEN NULL ELSE now() END,updated_at=now() WHERE tenant_id=$1 AND user_id=$2',
      [ctx.tenantId, id, active],
    );
    let revoked = 0;
    if (!active)
      revoked =
        (
          await c.query(
            'UPDATE sessions SET revoked_at=now() WHERE user_id=$1 AND tenant_id=$2 AND revoked_at IS NULL',
            [id, ctx.tenantId],
          )
        ).rowCount || 0;
    await audit(c, ctx, active ? 'user.reactivated' : 'user.deactivated', 'users', id, null, {
      reason: reason || null,
      revokedSessions: revoked,
    });
    return { ok: true, revoked };
  });
}

export async function resetUserPassword(ctx: Context, id: string) {
  permit(ctx, managers);
  const password = temporaryPassword(),
    passwordHash = await hashPassword(password);
  return transaction(async (c) => {
    const before = await target(c, ctx, id);
    if (!before.active) throw new ApiError(422, 'Reative o acesso antes de redefinir a senha.');
    await c.query(
      'UPDATE users SET password_hash=$2,must_change_password=true,password_changed_at=now(),updated_at=now() WHERE id=$1',
      [id, passwordHash],
    );
    const revoked =
      (
        await c.query(
          'UPDATE sessions SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL',
          [id],
        )
      ).rowCount || 0;
    await c.query('DELETE FROM rate_limits WHERE key=$1', [
      'login-account:' + hash(before.email).slice(0, 32),
    ]);
    await audit(c, ctx, 'user.password_reset', 'users', id, null, { revokedSessions: revoked });
    return { id, email: before.email, temporaryPassword: password };
  });
}

/** Reenvia o convite por e-mail (novo link; os anteriores deixam de valer). */
export async function resendInvite(ctx: Context, id: string) {
  permit(ctx, managers);
  const r = await transaction(async (c) => {
    const user = await target(c, ctx, id);
    if (!user.active) throw new ApiError(422, 'Reative o acesso antes de reenviar o convite.');
    const mailId = await queueInvite(c, ctx, user);
    await audit(c, ctx, 'user.invite_sent', 'users', id, null, { email: user.email });
    return { mailId, email: user.email };
  });
  await deliverSoon(r.mailId);
  return { id, email: r.email, invite: { mode: mailMode() } };
}
