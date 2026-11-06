import { timingSafeEqual, createHash } from 'node:crypto';
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { query, transaction } from '@/lib/db';
import { ApiError } from '@/lib/errors';
import { checkOrigin, clientInfo, hash, rateLimit } from '@/lib/security';
import { hashPassword, passwordRule, strongEnough } from '@/lib/password';
import { provisionTenant, tenantSchema } from './provisioning';
import { appOrigin } from './mail';

// Cadastro inicial: cria a primeira clínica real (nome, unidades e a conta da direção com senha).
// Só fica disponível enquanto não existe nenhuma clínica real (clínicas de teste, marcadas com
// demo_admin_user_id, não contam). Depois disso, a tela se fecha sozinha.
// Em servidor público (APP_ORIGIN fora de localhost) exige SETUP_TOKEN do .env, para que ninguém
// além de quem instalou consiga criar a clínica primeiro.

const isLocalOrigin = () =>
  ['localhost', '127.0.0.1', '[::1]'].includes(new URL(appOrigin()).hostname);

async function realTenants() {
  const [r] = await query<{ n: number }>(
    'SELECT count(*)::int AS n FROM tenants WHERE demo_admin_user_id IS NULL',
  );
  return r.n;
}

export async function setupStatus() {
  if (await realTenants()) return { available: false, reason: 'DONE' as const };
  if (!isLocalOrigin() && !process.env.SETUP_TOKEN)
    return { available: false, reason: 'TOKEN_NOT_CONFIGURED' as const };
  return { available: true, needsToken: !isLocalOrigin() };
}

const sameSecret = (a: string, b: string) => {
  const x = createHash('sha256').update(a).digest(),
    y = createHash('sha256').update(b).digest();
  return timingSafeEqual(x, y);
};

export async function runSetup(req: NextRequest, input: unknown) {
  checkOrigin(req);
  await rateLimit('setup:' + hash(clientInfo(req).ip).slice(0, 32), 10, 900);
  const d = tenantSchema
    .extend({
      admin: tenantSchema.shape.admin.extend({
        password: z.string().max(200),
        confirm: z.string().max(200),
      }),
      setup_token: z.string().max(200).optional(),
    })
    .strict()
    .parse(input);
  const status = await setupStatus();
  if (!status.available)
    throw new ApiError(
      409,
      status.reason === 'DONE'
        ? 'A clínica já foi cadastrada. Entre com a conta da direção.'
        : 'Cadastro inicial bloqueado: defina SETUP_TOKEN no servidor.',
    );
  if (status.needsToken && !sameSecret(d.setup_token || '', process.env.SETUP_TOKEN || ''))
    throw new ApiError(403, 'Código de instalação incorreto.');
  if (d.admin.password !== d.admin.confirm)
    throw new ApiError(422, 'A confirmação não corresponde à senha.');
  if (!strongEnough(d.admin.password)) throw new ApiError(422, passwordRule);
  const passwordHash = await hashPassword(d.admin.password);
  return transaction(async (c) => {
    // Duas pessoas enviando ao mesmo tempo: só a primeira cria a clínica.
    await c.query("SELECT pg_advisory_xact_lock(hashtext('integrar-setup'))");
    const {
      rows: [{ n }],
    } = await c.query('SELECT count(*)::int AS n FROM tenants WHERE demo_admin_user_id IS NULL');
    if (n) throw new ApiError(409, 'A clínica já foi cadastrada. Entre com a conta da direção.');
    const r = await provisionTenant(c, {
      name: d.name,
      units: d.units,
      admin: { name: d.admin.name, email: d.admin.email },
    });
    // No cadastro inicial a direção escolhe a própria senha (não há provisória).
    await c.query(
      'UPDATE users SET password_hash=$2,must_change_password=false,password_changed_at=now() WHERE lower(email)=$1',
      [r.adminEmail, passwordHash],
    );
    await c.query(
      "INSERT INTO audit_events(tenant_id,unit_id,actor_id,action,entity_type,details) SELECT $1,NULL,id,'platform.setup','platform',$3 FROM users WHERE lower(email)=$2",
      [r.tenantId, r.adminEmail, JSON.stringify({ units: d.units.length })],
    );
    return { ok: true, email: r.adminEmail };
  });
}
