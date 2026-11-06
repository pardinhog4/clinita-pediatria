import { z } from 'zod';
import { query } from '@/lib/db';
import { ApiError } from '@/lib/errors';
import { assertUnit, permit, type Context } from '@/lib/security';
import { financeRoles, receptionRoles } from './repository';
export async function directory(ctx: Context, params: URLSearchParams) {
  const unit = z.uuid().parse(params.get('unit'));
  assertUnit(ctx, unit);
  const kind = params.get('kind') || 'patients';
  const q =
    '%' +
    (params.get('q') || '')
      .trim()
      .slice(0, 100)
      .replace(/[%_\\]/g, '\\$&') +
    '%';
  // ?id= traz um registro específico (o já selecionado no formulário), mesmo fora da busca.
  const only = params.get('id') ? z.uuid().parse(params.get('id')) : null;
  if (kind === 'queues') {
    permit(ctx, receptionRoles);
    return {
      data: await query(
        'SELECT id,id::text AS value,name AS label,code FROM service_queues WHERE tenant_id=$1 AND unit_id=$2 AND active=true ORDER BY sort_order,name',
        [ctx.tenantId, unit],
      ),
    };
  }
  if (kind === 'users') {
    permit(ctx, receptionRoles);
    return {
      data: await query(
        'SELECT u.id,u.id::text AS value,u.name AS label FROM users u JOIN memberships m ON m.user_id=u.id WHERE m.tenant_id=$1 AND $2::uuid=ANY(m.unit_ids) AND m.active=true AND u.name ILIKE $3 ORDER BY u.name LIMIT 200',
        [ctx.tenantId, unit, q],
      ),
    };
  }
  if (kind === 'patients') {
    permit(ctx, receptionRoles);
    return {
      data: await query(
        "SELECT id,id::text AS value,name||' · '||guardian AS label,guardian FROM patients WHERE tenant_id=$1 AND unit_id=$2 AND (name ILIKE $3 OR guardian ILIKE $3) AND ($4::uuid IS NULL OR id=$4) ORDER BY name LIMIT 200",
        [ctx.tenantId, unit, q, only],
      ),
    };
  }
  if (kind === 'professionals') {
    // Só profissionais ativos: é a lista usada para agendar.
    permit(ctx, receptionRoles);
    return {
      data: await query(
        "SELECT p.id,p.id::text AS value,p.name||' · '||coalesce(s.name,p.specialty) AS label,p.specialty FROM professionals p LEFT JOIN specialties s ON s.tenant_id=p.tenant_id AND s.code=p.specialty WHERE p.tenant_id=$1 AND p.unit_id=$2 AND p.active=true AND (p.name ILIKE $3 OR coalesce(s.name,p.specialty) ILIKE $3) AND ($4::uuid IS NULL OR p.id=$4) ORDER BY p.name LIMIT 200",
        [ctx.tenantId, unit, q, only],
      ),
    };
  }
  if (kind === 'counterparties') {
    permit(ctx, financeRoles);
    const data = await query(
      `SELECT * FROM(SELECT 'patient:'||id::text AS value,guardian||' · responsável por '||name AS label FROM patients WHERE tenant_id=$1 AND unit_id=$2 UNION ALL SELECT 'professional:'||id::text,name||' · profissional' FROM professionals WHERE tenant_id=$1 AND unit_id=$2 AND active=true UNION ALL SELECT 'insurer:'||id::text,name||' · convênio' FROM insurers WHERE tenant_id=$1 UNION ALL SELECT 'ledger:'||id::text,counterparty||' · favorecido registrado' FROM ledger WHERE tenant_id=$1 AND unit_id=$2 AND counterparty<>'') records WHERE label ILIKE $3 ORDER BY label LIMIT 200`,
      [ctx.tenantId, unit, q],
    );
    return { data };
  }
  throw new ApiError(404, 'Diretório não encontrado.');
}
export async function resolveCounterparty(ctx: Context, ref: string, unitId: string) {
  assertUnit(ctx, unitId);
  const [kind, id] = ref.split(':');
  z.uuid().parse(id);
  let rows;
  if (kind === 'patient')
    rows = await query(
      'SELECT guardian AS name FROM patients WHERE tenant_id=$1 AND unit_id=$2 AND id=$3',
      [ctx.tenantId, unitId, id],
    );
  else if (kind === 'professional')
    rows = await query(
      'SELECT name FROM professionals WHERE tenant_id=$1 AND unit_id=$2 AND id=$3 AND active=true',
      [ctx.tenantId, unitId, id],
    );
  else if (kind === 'insurer')
    rows = await query('SELECT name FROM insurers WHERE tenant_id=$1 AND id=$2', [
      ctx.tenantId,
      id,
    ]);
  else if (kind === 'ledger')
    rows = await query(
      "SELECT counterparty AS name FROM ledger WHERE tenant_id=$1 AND unit_id=$2 AND id=$3 AND counterparty<>''",
      [ctx.tenantId, unitId, id],
    );
  else throw new ApiError(422, 'Selecione uma pessoa ou entidade cadastrada.');
  if (!rows[0]) throw new ApiError(422, 'Pessoa ou entidade não encontrada nesta unidade.');
  return String(rows[0].name);
}
