import type { PoolClient } from 'pg';
import { query } from '@/lib/db';
import { ApiError } from '@/lib/errors';
// Especialidades da clínica (tabela specialties). Substitui a lista fixa e a regra "só ABA usa sala coletiva" (shared_room).
export type Specialty = { code: string; name: string; shared_room: boolean; active: boolean };
const run = (c?: PoolClient) =>
  c ? (sql: string, v: unknown[]) => c.query(sql, v).then((r) => r.rows) : query;
export async function tenantSpecialties(tenantId: string, c?: PoolClient): Promise<Specialty[]> {
  return run(c)(
    'SELECT code,name,shared_room,active FROM specialties WHERE tenant_id=$1 ORDER BY sort_order,name',
    [tenantId],
  ) as Promise<Specialty[]>;
}
// Novos registros só usam especialidades ativas; registros antigos continuam exibindo as desativadas.
export async function assertSpecialties(tenantId: string, codes: unknown[], c?: PoolClient) {
  const wanted = [...new Set(codes.filter(Boolean).map(String))];
  if (!wanted.length) return;
  const active = new Set(
    (await tenantSpecialties(tenantId, c)).filter((s) => s.active).map((s) => s.code),
  );
  const bad = wanted.filter((s) => !active.has(s));
  if (bad.length)
    throw new ApiError(422, `Especialidade inexistente ou desativada: ${bad.join(', ')}.`);
}
export async function isSharedSpecialty(tenantId: string, code: string, c?: PoolClient) {
  const [s] = await run(c)('SELECT shared_room FROM specialties WHERE tenant_id=$1 AND code=$2', [
    tenantId,
    code,
  ]);
  return !!s?.shared_room;
}
