import 'dotenv/config';
import fs from 'node:fs';
import { pool, transaction } from '../src/lib/db';
async function main() {
  await pool.query(
    'CREATE TABLE IF NOT EXISTS schema_migrations(version text PRIMARY KEY,applied_at timestamptz NOT NULL DEFAULT now())',
  );
  for (const file of fs
    .readdirSync('migrations')
    .filter((f) => f.endsWith('.sql'))
    .sort()) {
    await transaction(async (c) => {
      await c.query("SELECT pg_advisory_xact_lock(hashtext('integrar-migrations'))");
      if ((await c.query('SELECT 1 FROM schema_migrations WHERE version=$1', [file])).rowCount)
        return;
      await c.query(fs.readFileSync('migrations/' + file, 'utf8'));
      await c.query('INSERT INTO schema_migrations(version) VALUES($1)', [file]);
      console.log('Migration aplicada:', file);
    });
  }
}
main()
  .catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
