import type { PoolClient } from 'pg';
import { query } from '@/lib/db';
import { resolveRules, type ClinicRules } from '@/lib/clinic-rules';

// Leitura das regras configuradas: as da clínica (clinic_settings.value.rules) com o horário
// próprio da unidade, quando houver. Sem nada salvo, valem os valores iniciais de defaultRules.

const sql = `SELECT cs.value->'rules' AS rules, u.business_hours, u.timezone
  FROM units u LEFT JOIN clinic_settings cs ON cs.tenant_id=u.tenant_id
  WHERE u.tenant_id=$1 AND u.id=$2`;

export async function unitRules(
  tenantId: string,
  unitId: string,
  c?: PoolClient,
): Promise<ClinicRules> {
  const rows = c
    ? (await c.query(sql, [tenantId, unitId])).rows
    : await query(sql, [tenantId, unitId]);
  return resolveRules(rows[0]?.rules, rows[0]?.business_hours, rows[0]?.timezone);
}

/** Regras da clínica sem o horário de uma unidade (repasse, assinatura, anexos). */
export async function tenantRules(tenantId: string, c?: PoolClient): Promise<ClinicRules> {
  const q = "SELECT value->'rules' AS rules FROM clinic_settings WHERE tenant_id=$1";
  const rows = c ? (await c.query(q, [tenantId])).rows : await query(q, [tenantId]);
  return resolveRules(rows[0]?.rules);
}

/** Fuso da unidade (o da clínica quando a unidade não tem fuso próprio). */
export async function unitTimezone(tenantId: string, unitId: string, c?: PoolClient) {
  return (await unitRules(tenantId, unitId, c)).timezone;
}
