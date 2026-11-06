import { z } from 'zod';
import type { PoolClient } from 'pg';
import { ApiError } from '@/lib/errors';
import { hashPassword } from '@/lib/password';
import { ensureQueues } from './sandbox';
import { temporaryPassword } from './users';
import { defaultCatalog, defaultScenarios, defaultAgents } from './tenant-defaults';
// Criação de uma clínica real: clínica, unidades, usuário de direção com senha provisória e os dados padrão
// (filas, catálogo de competências, cenários e agentes). É o único caminho de nascimento de uma clínica, inclusive a demonstração.
export const tenantSchema = z
  .object({
    name: z.string().trim().min(3).max(120),
    units: z
      .array(z.string().trim().min(2).max(80))
      .min(1)
      .max(30)
      .refine(
        (u) => new Set(u.map((x) => x.toLowerCase())).size === u.length,
        'Nomes de unidade repetidos.',
      ),
    admin: z
      .object({
        name: z.string().trim().min(3).max(120),
        email: z.email().transform((e) => e.trim().toLowerCase()),
      })
      .strict(),
  })
  .strict();
export async function applyTenantDefaults(
  c: PoolClient,
  tenantId: string,
  unitIds: string[],
  actorId: string,
) {
  for (const unitId of unitIds) await ensureQueues(c, tenantId, unitId);
  for (const k of defaultCatalog)
    await c.query(
      'INSERT INTO competency_catalog(tenant_id,code,name,description,synonyms,specialties,offered) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING',
      [tenantId, k.code, k.name, k.description, k.synonyms, k.specialties, k.offered],
    );
  // Cenários e agentes só entram se a clínica ainda não tiver os seus.
  if (
    !(await c.query('SELECT 1 FROM ai_scenarios WHERE tenant_id=$1 LIMIT 1', [tenantId])).rowCount
  )
    for (const s of defaultScenarios) {
      const {
        rows: [row],
      } = await c.query(
        "INSERT INTO ai_scenarios(tenant_id,title,situation,guidance,example,avoid,test_message,expected_action,expected_destination,tags,agent_specialties,status,created_by,updated_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'PUBLISHED',$12,$12) RETURNING *",
        [
          tenantId,
          s.title,
          s.situation,
          s.guidance,
          s.example,
          s.avoid,
          s.test_message,
          s.expected_action,
          s.expected_destination,
          s.tags,
          s.agent_specialties,
          actorId,
        ],
      );
      await c.query(
        'INSERT INTO ai_scenario_versions(tenant_id,scenario_id,version,snapshot,created_by) VALUES($1,$2,1,$3,$4)',
        [tenantId, row.id, JSON.stringify(row), actorId],
      );
    }
  if (!(await c.query('SELECT 1 FROM agents WHERE tenant_id=$1 LIMIT 1', [tenantId])).rowCount)
    for (const a of defaultAgents) {
      const {
        rows: [row],
      } = await c.query(
        'INSERT INTO agents(tenant_id,name,specialty,instructions,knowledge,confidence_threshold,use_scenarios) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *',
        [
          tenantId,
          a.name,
          a.specialty,
          a.instructions,
          a.knowledge,
          a.confidence_threshold,
          a.use_scenarios,
        ],
      );
      await c.query(
        'INSERT INTO agent_versions(tenant_id,agent_id,version,snapshot,created_by) VALUES($1,$2,1,$3,$4)',
        [tenantId, row.id, JSON.stringify(row), actorId],
      );
    }
}
export async function provisionTenant(c: PoolClient, input: unknown) {
  const d = tenantSchema.parse(input);
  if ((await c.query('SELECT 1 FROM users WHERE email=$1', [d.admin.email])).rowCount)
    throw new ApiError(
      409,
      'Já existe um usuário com este e-mail. Use outro e-mail para a direção da nova clínica.',
    );
  const {
    rows: [tenant],
  } = await c.query('INSERT INTO tenants(name) VALUES($1) RETURNING id,name', [d.name]);
  const unitIds: string[] = [];
  for (const [i, name] of d.units.entries()) {
    const {
      rows: [u],
    } = await c.query(
      'INSERT INTO units(tenant_id,name,sort_order) VALUES($1,$2,$3) RETURNING id',
      [tenant.id, name, i],
    );
    unitIds.push(u.id);
  }
  const password = temporaryPassword();
  const {
    rows: [admin],
  } = await c.query(
    'INSERT INTO users(name,email,password_hash,must_change_password,password_changed_at) VALUES($1,$2,$3,true,now()) RETURNING id',
    [d.admin.name, d.admin.email, await hashPassword(password)],
  );
  await c.query(
    "INSERT INTO memberships(tenant_id,user_id,role,unit_ids,active,created_by) VALUES($1,$2,'ADMIN',$3,true,$2)",
    [tenant.id, admin.id, unitIds],
  );
  await applyTenantDefaults(c, tenant.id, unitIds, admin.id);
  await c.query(
    "INSERT INTO audit_events(tenant_id,actor_id,action,entity_type,entity_id,details) VALUES($1,$2,'tenant.provisioned','tenants',$1,$3)",
    [tenant.id, admin.id, JSON.stringify({ units: d.units.length })],
  );
  return {
    tenantId: tenant.id as string,
    unitIds,
    adminId: admin.id as string,
    adminEmail: d.admin.email,
    temporaryPassword: password,
  };
}
