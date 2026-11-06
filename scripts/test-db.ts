import 'dotenv/config';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { Client } from 'pg';
import { hashPassword } from '../src/lib/password';

/** Contas da clínica fictícia por perfil (o ADMIN é local@integrar.test). */
export const testAccounts = {
  ADMIN: 'local@integrar.test',
  MANAGEMENT: 'gestao@clinica.teste',
  RECEPTION: 'recepcao@clinica.teste',
  CENTRAL: 'central@clinica.teste',
  CLINICIAN: 'profissional@clinica.teste',
  AUDIT: 'auditoria@clinica.teste',
  FINANCE: 'financeiro@clinica.teste',
} as const;
export type TestRole = keyof typeof testAccounts;
// Banco exclusivo dos testes: recriado do zero a cada execução, com todas as migrações.
// Com demo=true, carrega também a clínica FICTÍCIA de teste (tests/fixtures/demo-clinic) e cria uma conta com senha
// para cada perfil, usada pelos testes de navegador. A clínica fictícia não existe fora do banco de testes.
// Comando: npm run db:test-reset [-- --demo] (scripts/test-db-reset.ts).
export function testDatabaseUrl() {
  const test = process.env.TEST_DATABASE_URL,
    main = process.env.DATABASE_URL;
  if (!test)
    throw new Error(
      'Defina TEST_DATABASE_URL no .env (ex.: o mesmo endereço do DATABASE_URL com o banco integrar_test).',
    );
  const name = new URL(test).pathname.slice(1);
  if (!/_test$/.test(name))
    throw new Error('Por segurança, o banco de testes precisa terminar em _test.');
  if (
    main &&
    new URL(main).pathname === new URL(test).pathname &&
    new URL(main).host === new URL(test).host
  )
    throw new Error('TEST_DATABASE_URL não pode apontar para o mesmo banco do DATABASE_URL.');
  return test;
}
function run(script: string, env: Record<string, string>) {
  const r = spawnSync(
    process.execPath,
    [
      path.resolve('node_modules/tsx/dist/cli.mjs'),
      script,
      ...(env.ARGS ? env.ARGS.split(' ') : []),
    ],
    { env: { ...process.env, ...env }, encoding: 'utf8' },
  );
  if (r.status !== 0)
    throw new Error(`${script} falhou no banco de testes:\n${r.stderr || r.stdout}`);
}
export async function resetTestDatabase({ demo = false } = {}) {
  const url = testDatabaseUrl(),
    name = new URL(url).pathname.slice(1),
    admin = new URL(url);
  admin.pathname = '/postgres';
  const c = new Client({ connectionString: admin.toString() });
  await c.connect();
  try {
    await c.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    await c.query(`CREATE DATABASE "${name}"`);
  } finally {
    await c.end();
  }
  run('scripts/migrate.ts', { DATABASE_URL: url });
  if (!demo) return {};
  run('tests/fixtures/demo-clinic/seed.ts', { DATABASE_URL: url });
  run('tests/fixtures/demo-clinic/enrich-profiles.ts', { DATABASE_URL: url });
  const password = 'Teste' + randomBytes(9).toString('hex') + '9';
  await createTestAccounts(url, password);
  return { adminPassword: password };
}

// Uma conta com senha por perfil na clínica fictícia (mesma senha para todas, só no banco de testes).
async function createTestAccounts(url: string, password: string) {
  const c = new Client({ connectionString: url });
  await c.connect();
  try {
    const passwordHash = await hashPassword(password);
    const {
      rows: [tenant],
    } = await c.query('SELECT id FROM tenants WHERE demo_admin_user_id IS NOT NULL LIMIT 1');
    const units = (
      await c.query('SELECT id FROM units WHERE tenant_id=$1 ORDER BY sort_order,name', [tenant.id])
    ).rows.map((r) => r.id as string);
    const {
      rows: [professional],
    } = await c.query(
      'SELECT id,unit_id FROM professionals WHERE tenant_id=$1 AND unit_id=$2 AND active=true ORDER BY name LIMIT 1',
      [tenant.id, units[0]],
    );
    const roles: [TestRole, string, string, string[]][] = [
      ['MANAGEMENT', 'MANAGEMENT', 'Gestão (teste)', units],
      ['RECEPTION', 'RECEPTION', 'Recepção (teste)', [units[0]]],
      ['CENTRAL', 'RECEPTION', 'Central de atendimento (teste)', units],
      ['CLINICIAN', 'CLINICIAN', 'Profissional (teste)', [professional.unit_id]],
      ['AUDIT', 'AUDIT', 'Auditoria (teste)', units],
      ['FINANCE', 'FINANCE', 'Financeiro (teste)', units],
    ];
    await c.query(
      'UPDATE users SET password_hash=$2,must_change_password=false,password_changed_at=now() WHERE email=$1',
      [testAccounts.ADMIN, passwordHash],
    );
    for (const [key, role, name, unitIds] of roles) {
      const {
        rows: [u],
      } = await c.query(
        'INSERT INTO users(name,email,password_hash,must_change_password,password_changed_at) VALUES($1,$2,$3,false,now()) RETURNING id',
        [name, testAccounts[key], passwordHash],
      );
      await c.query(
        'INSERT INTO memberships(tenant_id,user_id,role,unit_ids) VALUES($1,$2,$3,$4)',
        [tenant.id, u.id, role, unitIds],
      );
      if (role === 'CLINICIAN')
        await c.query(
          "UPDATE professionals SET metadata=metadata||jsonb_build_object('user_id',$2::text) WHERE id=$1",
          [professional.id, u.id],
        );
    }
  } finally {
    await c.end();
  }
}
