import { Pool, type PoolClient, type QueryResultRow } from 'pg';
const globalDb = globalThis as unknown as { pgPool?: Pool };
export const pool =
  globalDb.pgPool ??
  new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 5,
    idleTimeoutMillis: 20000,
    connectionTimeoutMillis: 10000,
    ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: true } : false,
  });
if (process.env.NODE_ENV !== 'production') globalDb.pgPool = pool;
export async function query<T extends QueryResultRow = QueryResultRow>(
  sql: string,
  values: unknown[] = [],
) {
  return (await pool.query<T>(sql, values)).rows;
}
export async function transaction<T>(fn: (client: PoolClient) => Promise<T>) {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const value = await fn(c);
    await c.query('COMMIT');
    return value;
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    c.release();
  }
}
