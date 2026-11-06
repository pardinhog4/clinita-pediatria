import type { PoolClient } from 'pg';
import { query } from '@/lib/db';
import { ApiError } from '@/lib/errors';
import { assertUnit, permit, type Context, type Role } from '@/lib/security';
export const managers: Role[] = ['ADMIN', 'MANAGEMENT'];
export const financeRoles: Role[] = [...managers, 'FINANCE'];
export const clinicRoles: Role[] = [...managers, 'CLINICIAN'];
export const receptionRoles: Role[] = [...managers, 'RECEPTION'];
export const auditRoles: Role[] = [...managers, 'AUDIT'];
export const readRoles: Record<string, Role[]> = {
  patients: [...receptionRoles, 'CLINICIAN', 'AUDIT'],
  professionals: [...receptionRoles, 'CLINICIAN', 'FINANCE', 'AUDIT'],
  appointments: [...receptionRoles, 'CLINICIAN', 'AUDIT'],
  rooms: [...receptionRoles, 'CLINICIAN'],
  insurers: [...receptionRoles, 'CLINICIAN', 'AUDIT', 'FINANCE'],
  ledger: financeRoles,
  inventory: financeRoles,
  agents: managers,
  models: clinicRoles,
  conversations: receptionRoles,
  audit: managers,
};
export const tableMap: Record<string, string> = {
  patients: 'patients',
  professionals: 'professionals',
  appointments: 'appointments',
  rooms: 'rooms',
  insurers: 'insurers',
  ledger: 'ledger',
  inventory: 'inventory',
  agents: 'agents',
  models: 'assessment_models',
  conversations: 'conversations',
  audit: 'audit_events',
};
export const unitTables = new Set([
  'patients',
  'professionals',
  'appointments',
  'rooms',
  'ledger',
  'inventory',
  'conversations',
  'audit_events',
  'documents',
]);
export async function audit(
  c: PoolClient,
  ctx: Context,
  action: string,
  type: string,
  id: string | null,
  unit: string | null,
  details: Record<string, unknown> = {},
) {
  await c.query(
    'INSERT INTO audit_events(tenant_id,unit_id,actor_id,action,entity_type,entity_id,details) VALUES($1,$2,$3,$4,$5,$6,$7)',
    [ctx.tenantId, unit, ctx.userId, action, type, id, JSON.stringify(details)],
  );
}
export async function scopeRow(
  c: PoolClient,
  ctx: Context,
  table: string,
  id: string,
  lock = false,
) {
  if (
    !Object.values(tableMap).includes(table) &&
    !['documents', 'clinical_entries'].includes(table)
  )
    throw new ApiError(404, 'Recurso não encontrado.');
  const unitScope = unitTables.has(table) ? ' AND unit_id=ANY($3::uuid[])' : '';
  const {
    rows: [row],
  } = await c.query(
    `SELECT * FROM ${table} WHERE tenant_id=$1 AND id=$2${unitScope}${lock ? ' FOR UPDATE' : ''}`,
    unitScope ? [ctx.tenantId, id, ctx.unitIds] : [ctx.tenantId, id],
  );
  if (!row) throw new ApiError(404, 'Registro não encontrado.');
  return row;
}
export function version(row: { version: number }, expected: number) {
  if (row.version !== expected)
    throw new ApiError(409, 'O registro foi alterado por outra pessoa. Atualize antes de salvar.');
}
export async function clinicalAccess(ctx: Context, patientId: string) {
  permit(ctx, clinicRoles);
  const [p] = await query(
    'SELECT id FROM patients WHERE id=$1 AND tenant_id=$2 AND unit_id=ANY($3::uuid[])',
    [patientId, ctx.tenantId, ctx.unitIds],
  );
  if (!p) throw new ApiError(404, 'Paciente não encontrado.');
  if (ctx.role === 'CLINICIAN') {
    const [assignment] = await query(
      `SELECT a.id FROM appointments a JOIN professionals p ON p.id=a.professional_id AND p.tenant_id=a.tenant_id WHERE a.tenant_id=$1 AND a.patient_id=$2 AND p.active=true AND p.metadata->>'user_id'=$3 UNION SELECT t.id FROM patient_transfers t JOIN professionals p ON p.id=t.to_professional_id AND p.tenant_id=t.tenant_id WHERE t.tenant_id=$1 AND t.patient_id=$2 AND p.active=true AND p.metadata->>'user_id'=$3 LIMIT 1`,
      [ctx.tenantId, patientId, ctx.userId],
    );
    if (!assignment) throw new ApiError(403, 'Paciente fora da sua equipe de cuidado.');
  }
}
export async function list(ctx: Context, resource: string, params: URLSearchParams) {
  const table = tableMap[resource];
  if (!table) throw new ApiError(404, 'Recurso não encontrado.');
  permit(ctx, readRoles[resource]);
  const page = Math.max(1, Math.min(10000, Number(params.get('page')) || 1)),
    limit = Math.min(
      resource === 'appointments' ? 500 : 100,
      Math.max(1, Number(params.get('limit')) || 50),
    );
  const values: unknown[] = [ctx.tenantId];
  const conditions = ['x.tenant_id=$1'];
  if (resource === 'conversations') conditions.push('x.sandbox=false AND x.deleted_at IS NULL');
  if (unitTables.has(table)) {
    const unit = params.get('unit');
    if (unit) assertUnit(ctx, unit);
    values.push(unit ? [unit] : ctx.unitIds);
    conditions.push(`x.unit_id=ANY($${values.length}::uuid[])`);
  }
  if (ctx.role === 'CLINICIAN' && ['patients', 'appointments'].includes(resource)) {
    values.push(ctx.userId);
    conditions.push(
      resource === 'patients'
        ? `(EXISTS(SELECT 1 FROM appointments ca JOIN professionals cp ON cp.id=ca.professional_id AND cp.tenant_id=ca.tenant_id WHERE ca.tenant_id=x.tenant_id AND ca.patient_id=x.id AND cp.active=true AND cp.metadata->>'user_id'=$${values.length}) OR EXISTS(SELECT 1 FROM patient_transfers t JOIN professionals tp ON tp.id=t.to_professional_id AND tp.tenant_id=t.tenant_id WHERE t.tenant_id=x.tenant_id AND t.patient_id=x.id AND tp.active=true AND tp.metadata->>'user_id'=$${values.length}))`
        : `EXISTS(SELECT 1 FROM professionals cp WHERE cp.id=x.professional_id AND cp.tenant_id=x.tenant_id AND cp.metadata->>'user_id'=$${values.length})`,
    );
  }
  if (resource === 'models' && ctx.role === 'CLINICIAN') {
    values.push(ctx.userId);
    conditions.push(
      `EXISTS(SELECT 1 FROM professionals mp WHERE mp.tenant_id=x.tenant_id AND mp.metadata->>'user_id'=$${values.length} AND mp.active=true AND mp.specialty=x.specialty)`,
    );
  }
  const search = params.get('q')?.trim().slice(0, 100);
  const searchField =
    (
      { ledger: 'description', conversations: 'guardian', audit: 'action' } as Record<
        string,
        string
      >
    )[resource] || 'name';
  if (search && resource !== 'appointments') {
    values.push('%' + search.replace(/[%_\\]/g, '\\$&') + '%');
    conditions.push(`x.${searchField} ILIKE $${values.length}`);
  }
  if (resource === 'appointments' && params.get('date')) {
    values.push(params.get('date'));
    conditions.push(
      `(x.starts_at AT TIME ZONE unit_tz(x.tenant_id,x.unit_id))::date=$${values.length}::date`,
    );
  }
  if (resource === 'appointments' && params.get('from') && params.get('to')) {
    values.push(params.get('from'), params.get('to'));
    conditions.push(
      `(x.starts_at AT TIME ZONE unit_tz(x.tenant_id,x.unit_id))::date BETWEEN $${values.length - 1}::date AND $${values.length}::date`,
    );
  }
  if (resource === 'conversations') {
    for (const key of ['status', 'channel', 'priority', 'stage', 'queue_id', 'assigned_user_id']) {
      const value = params.get(key);
      if (value) {
        values.push(value);
        conditions.push(`x.${key}=$${values.length}`);
      }
    }
  }
  if (resource === 'appointments') {
    for (const key of ['professional_id', 'room_id', 'patient_id']) {
      if (params.get(key)) {
        values.push(params.get(key));
        conditions.push(`x.${key}=$${values.length}::uuid`);
      }
    }
    if (params.get('specialty')) {
      values.push(params.get('specialty'));
      conditions.push(
        `EXISTS(SELECT 1 FROM professionals pf WHERE pf.tenant_id=x.tenant_id AND pf.id=x.professional_id AND pf.specialty=$${values.length})`,
      );
    }
  }
  if (resource === 'appointments' && params.get('status')) {
    values.push(params.get('status'));
    conditions.push(`x.status=$${values.length}`);
  }
  if (resource === 'patients') {
    for (const key of ['insurer_id'])
      if (params.get(key)) {
        values.push(params.get(key));
        conditions.push(`x.${key}=$${values.length}::uuid`);
      }
    if (params.get('specialty')) {
      values.push(params.get('specialty'));
      conditions.push(`x.metadata->'specialties' ? $${values.length}`);
    }
  }
  if (['agents', 'models'].includes(resource) && params.get('archived') !== 'true')
    conditions.push('x.archived_at IS NULL');
  if (
    ['patients', 'rooms', 'insurers', 'inventory'].includes(resource) &&
    ['true', 'false'].includes(params.get('active') || '')
  ) {
    values.push(params.get('active'));
    conditions.push(`x.active=${values.length}::boolean`);
  }
  if (resource === 'professionals') {
    if (params.get('specialty')) {
      values.push(params.get('specialty'));
      conditions.push(`x.specialty=$${values.length}`);
    }
    if (['true', 'false'].includes(params.get('active') || '')) {
      values.push(params.get('active'));
      conditions.push(`x.active=$${values.length}::boolean`);
    }
  }
  if (resource === 'audit') {
    for (const key of ['entity_type', 'actor_id'])
      if (params.get(key)) {
        values.push(params.get(key));
        conditions.push(`x.${key}=$${values.length}`);
      }
    for (const [key, op] of [
      ['from', '>='],
      ['to', '<='],
    ])
      if (params.get(key)) {
        values.push(params.get(key));
        conditions.push(
          `(x.created_at AT TIME ZONE unit_tz(x.tenant_id,x.unit_id))::date ${op} $${values.length}::date`,
        );
      }
  }
  const where = conditions.join(' AND ');
  const [total] = await query(
    `SELECT count(*)::int AS count FROM ${table} x WHERE ${where}`,
    values,
  );
  const columns =
    resource === 'professionals' && ['RECEPTION', 'CLINICIAN', 'AUDIT'].includes(ctx.role)
      ? 'x.id,x.tenant_id,x.unit_id,x.room_id,x.name,x.specialty,x.contract,x.active,x.competencies,x.version'
      : 'x.*';
  const join =
    resource === 'appointments'
      ? ' JOIN patients p ON p.id=x.patient_id AND p.tenant_id=x.tenant_id JOIN professionals pr ON pr.id=x.professional_id AND pr.tenant_id=x.tenant_id JOIN rooms r ON r.id=x.room_id AND r.tenant_id=x.tenant_id'
      : resource === 'audit'
        ? ' JOIN users au ON au.id=x.actor_id'
        : '';
  const extras =
    resource === 'appointments'
      ? ',p.name AS patient_name,pr.name AS professional_name,pr.specialty,r.name AS room_name'
      : resource === 'audit'
        ? ',au.name AS actor_name'
        : resource === 'conversations'
          ? `,(SELECT q.name FROM service_queues q WHERE q.id=x.queue_id AND q.tenant_id=x.tenant_id) AS queue_name,(SELECT max(m.created_at) FROM messages m WHERE m.tenant_id=x.tenant_id AND m.conversation_id=x.id) AS last_message_at,coalesce((SELECT greatest(0,extract(epoch FROM(now()-max(m.created_at)))/60)::int FROM messages m WHERE m.tenant_id=x.tenant_id AND m.conversation_id=x.id AND m.direction='INBOUND' HAVING max(m.created_at)>coalesce((SELECT max(o.created_at) FROM messages o WHERE o.tenant_id=x.tenant_id AND o.conversation_id=x.id AND o.direction='OUTBOUND'),'-infinity'::timestamptz)),0) AS wait_minutes`
          : '';
  const sort =
    resource === 'appointments'
      ? 'x.starts_at'
      : resource === 'audit'
        ? 'x.created_at DESC'
        : resource === 'conversations'
          ? 'x.created_at DESC'
          : resource === 'ledger'
            ? 'x.due_date,x.created_at DESC'
            : 'x.name';
  values.push(limit, (page - 1) * limit);
  const data = await query(
    `SELECT ${columns}${extras} FROM ${table} x${join} WHERE ${where} ORDER BY ${sort} LIMIT $${values.length - 1} OFFSET $${values.length}`,
    values,
  );
  if (resource === 'appointments' && !clinicRoles.includes(ctx.role))
    for (const row of data) delete row.evolution;
  return { data, total: total.count, page, limit };
}
