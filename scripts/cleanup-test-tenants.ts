import 'dotenv/config';
import { pool, query, transaction } from '../src/lib/db';
// Remove do banco do dia a dia as clínicas que não são reais:
// - padrão: clínicas deixadas pelos testes antigos (nomes exatos usados pelos testes);
// - --demo: a clínica fictícia de demonstração (tenants.demo_admin_user_id preenchido).
// Uso: npm run db:cleanup-tests [-- --demo]            (só mostra o que seria apagado)
//      npm run db:cleanup-tests -- [--demo] --apply    (apaga; faça backup antes)
const testNames = [
  'Teste navegador isolado',
  'Sandbox testes isolados',
  'Outra clínica de teste',
  'Teste integração',
  'Paridade navegador',
  'Paridade teste isolado',
  'Encaminhamentos testes',
  'Teste usuários',
  'Cenários testes',
];
async function main() {
  const apply = process.argv.includes('--apply'),
    demo = process.argv.includes('--demo');
  const tenants = demo
    ? await query<{ id: string; name: string }>(
        'SELECT id,name FROM tenants WHERE demo_admin_user_id IS NOT NULL',
      )
    : await query<{ id: string; name: string }>(
        'SELECT id,name FROM tenants WHERE name=ANY($1) AND demo_admin_user_id IS NULL',
        [testNames],
      );
  const ids = tenants.map((t) => t.id);
  const tables = (
    await query<{ table_name: string }>(
      "SELECT c.table_name FROM information_schema.columns c JOIN information_schema.tables t ON t.table_name=c.table_name AND t.table_schema=c.table_schema AND t.table_type='BASE TABLE' WHERE c.column_name='tenant_id' AND c.table_schema='public' ORDER BY 1",
    )
  ).map((r) => r.table_name);
  const users = (
    await query<{ user_id: string }>(
      'SELECT DISTINCT user_id FROM memberships WHERE tenant_id=ANY($1::uuid[])',
      [ids],
    )
  ).map((r) => r.user_id);
  console.log(
    `${tenants.length} clínica(s) ${demo ? 'de demonstração' : 'de teste'} encontrada(s):`,
  );
  for (const [name, n] of Object.entries(
    tenants.reduce(
      (m, t) => ({ ...m, [t.name]: (m[t.name] || 0) + 1 }),
      {} as Record<string, number>,
    ),
  ))
    console.log(`  ${name}: ${n}`);
  if (!tenants.length) return;
  let total = 0;
  for (const t of tables) {
    const [r] = await query(
      `SELECT count(*)::int AS n FROM "${t}" WHERE tenant_id=ANY($1::uuid[])`,
      [ids],
    );
    if (r.n) {
      total += r.n;
      console.log(`  ${t}: ${r.n}`);
    }
  }
  console.log(
    `Total: ${total} registros em ${tables.length} tabelas, mais as próprias clínicas e até ${users.length} usuários que só pertenciam a elas.`,
  );
  if (!apply) {
    console.log('\nNada foi apagado. Rode com -- --apply para apagar.');
    return;
  }
  await transaction(async (c) => {
    // Desliga gatilhos (incluindo os de imutabilidade da auditoria) e checagem de chave estrangeira só nesta transação.
    await c.query("SET LOCAL session_replication_role='replica'");
    for (const t of tables)
      await c.query(`DELETE FROM "${t}" WHERE tenant_id=ANY($1::uuid[])`, [ids]);
    const { rowCount: removedUsers } = await c.query(
      'DELETE FROM users u WHERE u.id=ANY($1::uuid[]) AND NOT EXISTS(SELECT 1 FROM memberships m WHERE m.user_id=u.id)',
      [users],
    );
    await c.query('DELETE FROM tenants WHERE id=ANY($1::uuid[])', [ids]);
    console.log(
      `\nApagado: ${tenants.length} clínicas, ${total} registros e ${removedUsers} usuários.`,
    );
  });
}
main()
  .catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
