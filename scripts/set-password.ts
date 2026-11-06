import 'dotenv/config';
import fs from 'node:fs';
import { randomBytes } from 'node:crypto';
import { pool, transaction } from '../src/lib/db';
import { hashPassword, strongEnough, passwordRule } from '../src/lib/password';
// Uso: npm run user:password -- <email> [--env-key=NOME]
// Gera uma senha forte, grava o hash e revoga as sessões do usuário. Com --env-key a senha vai para o .env (não versionado) em vez do terminal.
async function main() {
  const email = process.argv[2]?.trim().toLowerCase(),
    envKey = process.argv.find((a) => a.startsWith('--env-key='))?.slice(10);
  if (!email || email.startsWith('--'))
    throw new Error('Informe o e-mail: npm run user:password -- usuario@clinica.com.br');
  if (envKey && !/^[A-Z][A-Z0-9_]{2,60}$/.test(envKey))
    throw new Error('Nome de variável inválido.');
  const password =
    process.env.USER_PASSWORD || randomBytes(12).toString('base64url').replace(/[-_]/g, 'x') + '7a';
  if (!strongEnough(password)) throw new Error(passwordRule);
  const passwordHash = await hashPassword(password);
  await transaction(async (c) => {
    const {
      rows: [user],
    } = await c.query(
      'SELECT u.id,m.tenant_id FROM users u LEFT JOIN memberships m ON m.user_id=u.id WHERE lower(u.email)=$1 LIMIT 1',
      [email],
    );
    if (!user) throw new Error('Usuário não encontrado: ' + email);
    await c.query(
      'UPDATE users SET password_hash=$2,password_changed_at=now(),updated_at=now() WHERE id=$1',
      [user.id, passwordHash],
    );
    await c.query('UPDATE sessions SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL', [
      user.id,
    ]);
    if (user.tenant_id)
      await c.query(
        "INSERT INTO audit_events(tenant_id,actor_id,action,entity_type,entity_id,details) VALUES($1,$2,'auth.password_reset_cli','users',$2,$3)",
        [user.tenant_id, user.id, JSON.stringify({ source: 'scripts/set-password.ts' })],
      );
  });
  if (envKey) {
    const current = fs.existsSync('.env') ? fs.readFileSync('.env', 'utf8') : '';
    const line = envKey + '=' + password;
    fs.writeFileSync(
      '.env',
      new RegExp('^' + envKey + '=.*$', 'm').test(current)
        ? current.replace(new RegExp('^' + envKey + '=.*$', 'm'), line)
        : current.replace(/\n?$/, '\n') + line + '\n',
    );
    console.log(`Senha de ${email} definida e salva no .env em ${envKey}.`);
  } else
    console.log(
      `Senha de ${email} definida. Entregue com segurança e peça a troca no perfil:\n${password}`,
    );
}
main()
  .catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
