import { z } from 'zod';
import type { PoolClient } from 'pg';
import { query, transaction } from '@/lib/db';
import { ApiError } from '@/lib/errors';
import { permit, assertUnit, type Context } from '@/lib/security';
import {
  audit,
  scopeRow,
  managers,
  receptionRoles,
  readRoles,
  clinicalAccess,
  financeRoles,
} from './repository';
import { assertSpecialties } from './specialties';
// Ciclo de vida dos cadastros: desativar/reativar (nunca apagar), alta do paciente, troca de unidade,
// histórico de versões, procedimentos e preços por convênio e remoção auditada de documentos.
export const versioned = new Set([
  'patients',
  'professionals',
  'insurers',
  'rooms',
  'agents',
  'models',
  'inventory',
  'ledger',
]);
const reasonSchema = z.string().trim().min(5, 'Explique o motivo em poucas palavras.').max(1000);
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
export async function recordVersion(
  c: PoolClient,
  ctx: Context,
  type: string,
  row: Record<string, unknown>,
  reason?: string | null,
) {
  if (!versioned.has(type)) return;
  await c.query(
    'INSERT INTO record_versions(tenant_id,entity_type,entity_id,version,snapshot,reason,created_by) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(entity_type,entity_id,version) DO NOTHING',
    [ctx.tenantId, type, row.id, row.version, JSON.stringify(row), reason || null, ctx.userId],
  );
}
// Registro sem histórico (criado antes dele ou fora dos fluxos) ganha a versão anterior como ponto de partida.
export async function ensureBaseline(
  c: PoolClient,
  ctx: Context,
  type: string,
  row: Record<string, unknown>,
) {
  if (!versioned.has(type)) return;
  await c.query(
    'INSERT INTO record_versions(tenant_id,entity_type,entity_id,version,snapshot,reason) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(entity_type,entity_id,version) DO NOTHING',
    [ctx.tenantId, type, row.id, row.version, JSON.stringify(row), 'Versão anterior ao histórico'],
  );
}
// Histórico com as diferenças entre versões consecutivas (campos alterados, antes e depois).
const ignored = new Set(['version', 'updated_at', 'deactivated_at', 'discharged_at']);
export async function recordHistory(ctx: Context, type: string, id: string) {
  const t = z
    .enum([
      'patients',
      'professionals',
      'insurers',
      'rooms',
      'agents',
      'models',
      'inventory',
      'ledger',
    ])
    .parse(type);
  permit(ctx, readRoles[t] || managers);
  z.uuid().parse(id);
  const current = await transaction(async (c) => {
    const row = await scopeRow(c, ctx, t === 'models' ? 'assessment_models' : t, id);
    if (t === 'patients' && ctx.role === 'CLINICIAN') await clinicalAccess(ctx, id);
    return row;
  });
  const rows = await query(
    'SELECT v.version,v.snapshot,v.reason,v.created_at,u.name AS author FROM record_versions v LEFT JOIN users u ON u.id=v.created_by WHERE v.tenant_id=$1 AND v.entity_type=$2 AND v.entity_id=$3 ORDER BY v.version',
    [ctx.tenantId, t, id],
  );
  const flat = (o: any, prefix = ''): Record<string, unknown> =>
    Object.entries(o || {}).reduce(
      (acc, [k, v]) =>
        v && typeof v === 'object' && !Array.isArray(v)
          ? { ...acc, ...flat(v, prefix + k + '.') }
          : { ...acc, [prefix + k]: v },
      {},
    );
  // Registro que nunca foi alterado (ex.: veio do cadastro inicial) ainda não tem versões salvas:
  // mostra a versão atual como ponto de partida, em vez de um histórico vazio.
  if (!rows.length)
    return {
      data: [
        {
          version: current.version,
          reason: 'Nenhuma alteração registrada desde o cadastro.',
          author: null,
          created_at: current.created_at ?? null,
          changes: [],
        },
      ],
    };
  return {
    data: rows
      .map((r, i) => {
        const prev = i ? flat(rows[i - 1].snapshot) : null,
          cur = flat(r.snapshot);
        const changes = prev
          ? [...new Set([...Object.keys(prev), ...Object.keys(cur)])]
              .filter((k) => !ignored.has(k) && JSON.stringify(prev[k]) !== JSON.stringify(cur[k]))
              .map((k) => ({ field: k, before: prev[k] ?? null, after: cur[k] ?? null }))
          : [];
        return {
          version: r.version,
          reason: r.reason,
          author: r.author,
          created_at: r.created_at,
          changes,
        };
      })
      .reverse(),
  };
}

const activeSchema = z
  .object({
    active: z.boolean(),
    reason: reasonSchema.optional(),
    version: z.number().int().positive().optional(),
  })
  .strict();
export async function setRecordActive(ctx: Context, type: string, id: string, input: unknown) {
  const t = z.enum(['patients', 'professionals', 'insurers', 'rooms', 'inventory']).parse(type);
  z.uuid().parse(id);
  const d = activeSchema.parse(input);
  if (!d.active && !d.reason) throw new ApiError(422, 'Explique o motivo.');
  permit(ctx, t === 'patients' ? receptionRoles : t === 'inventory' ? financeRoles : managers);
  return transaction(async (c) => {
    const row = await scopeRow(c, ctx, t, id, true);
    if (d.version && row.version !== d.version)
      throw new ApiError(409, 'O cadastro mudou. Atualize antes de continuar.');
    if (row.active === d.active) return row;
    await ensureBaseline(c, ctx, t, row);
    let extra = '';
    if (t === 'rooms' && !d.active) {
      const {
        rows: [b],
      } = await c.query(
        "SELECT (SELECT count(*) FROM professionals WHERE tenant_id=$1 AND room_id=$2 AND active)::int AS professionals,(SELECT count(*) FROM appointments WHERE tenant_id=$1 AND room_id=$2 AND starts_at>now() AND status NOT IN('CANCELLED','ABSENT'))::int AS future",
        [ctx.tenantId, id],
      );
      if (b.professionals || b.future)
        throw new ApiError(
          422,
          `Antes de desativar a sala, mude a sala de ${plural(b.professionals, 'profissional', 'profissionais')} e resolva ${plural(b.future, 'sessão futura', 'sessões futuras')}.`,
        );
    }
    if (t === 'patients' && !d.active) {
      const {
        rows: [b],
      } = await c.query(
        "SELECT count(*)::int AS n FROM appointments WHERE tenant_id=$1 AND patient_id=$2 AND starts_at>now() AND status NOT IN('CANCELLED','ABSENT')",
        [ctx.tenantId, id],
      );
      if (b.n)
        throw new ApiError(
          422,
          `O paciente tem ${plural(b.n, 'sessão futura', 'sessões futuras')}. Cancele antes de dar alta.`,
        );
      const { rowCount } = await c.query(
        "UPDATE waitlist SET status='CANCELLED' WHERE tenant_id=$1 AND patient_id=$2 AND status IN('WAITING','OFFERED')",
        [ctx.tenantId, id],
      );
      if (rowCount)
        extra = `; ${plural(rowCount, 'pedido', 'pedidos')} da lista de espera cancelado(s)`;
    }
    if (t === 'professionals' && !d.active) {
      const {
        rows: [b],
      } = await c.query(
        "SELECT count(*)::int AS n FROM appointments WHERE tenant_id=$1 AND professional_id=$2 AND starts_at>now() AND status NOT IN('CANCELLED','ABSENT')",
        [ctx.tenantId, id],
      );
      if (b.n)
        throw new ApiError(
          422,
          `O profissional tem ${plural(b.n, 'sessão futura', 'sessões futuras')}. Use "Desligar e transferir carteira" ou cancele as sessões.`,
        );
      // Encaminhamentos ainda não aceitos voltam para a coordenação clínica.
      const { rowCount } = await c.query(
        "UPDATE referral_items SET professional_id=NULL,route='COORDINATION',version=version+1,updated_at=now(),history=history||$3::jsonb WHERE tenant_id=$1 AND professional_id=$2 AND state='PENDING'",
        [
          ctx.tenantId,
          id,
          JSON.stringify([
            {
              at: new Date().toISOString(),
              action: 'DECLINE',
              by: ctx.name,
              note: 'Profissional desativado: ' + d.reason,
            },
          ]),
        ],
      );
      if (rowCount)
        extra = `; ${plural(rowCount, 'encaminhamento', 'encaminhamentos')} devolvido(s) à coordenação`;
    }
    if (t === 'professionals' && d.active) {
      const {
        rows: [ok],
      } = await c.query(
        'SELECT u.active AND r.active AS ok FROM units u JOIN rooms r ON r.id=$3 WHERE u.tenant_id=$1 AND u.id=$2',
        [ctx.tenantId, row.unit_id, row.room_id],
      );
      if (!ok?.ok)
        throw new ApiError(
          422,
          'A unidade ou a sala deste profissional está desativada. Reative-a antes.',
        );
    }
    const sets =
      t === 'patients'
        ? "active=$3,discharged_at=CASE WHEN $3 THEN NULL ELSE now() END,discharge_reason=CASE WHEN $3 THEN '' ELSE $4 END"
        : t === 'professionals' || t === 'inventory'
          ? 'active=$3'
          : 'active=$3,deactivated_at=CASE WHEN $3 THEN NULL ELSE now() END';
    const {
      rows: [updated],
    } = await c.query(
      `UPDATE ${t} SET ${sets},version=version+1 WHERE tenant_id=$1 AND id=$2 RETURNING *`,
      t === 'patients'
        ? [ctx.tenantId, id, d.active, d.reason || '']
        : [ctx.tenantId, id, d.active],
    );
    const why = (d.active ? 'Reativado' : 'Desativado') + (d.reason ? ': ' + d.reason : '') + extra;
    await recordVersion(c, ctx, t, updated, why);
    await audit(
      c,
      ctx,
      `${t}.${d.active ? 'reactivated' : 'deactivated'}`,
      t,
      id,
      updated.unit_id || null,
      { reason: d.reason, extra },
    );
    return { ...updated, notice: extra ? extra.slice(2) : null };
  });
}

// Troca de unidade do paciente: sem sessões futuras nem lista de espera aberta na unidade antiga.
export async function transferPatientUnit(ctx: Context, id: string, input: unknown) {
  permit(ctx, managers);
  z.uuid().parse(id);
  const d = z
    .object({ unit_id: z.uuid(), reason: reasonSchema, version: z.number().int().positive() })
    .strict()
    .parse(input);
  assertUnit(ctx, d.unit_id);
  return transaction(async (c) => {
    const p = await scopeRow(c, ctx, 'patients', id, true);
    if (p.version !== d.version)
      throw new ApiError(409, 'O cadastro mudou. Atualize antes de continuar.');
    if (p.unit_id === d.unit_id) throw new ApiError(422, 'O paciente já é desta unidade.');
    await ensureBaseline(c, ctx, 'patients', p);
    const {
      rows: [u],
    } = await c.query('SELECT active FROM units WHERE tenant_id=$1 AND id=$2', [
      ctx.tenantId,
      d.unit_id,
    ]);
    if (!u?.active) throw new ApiError(422, 'Unidade de destino inexistente ou desativada.');
    const {
      rows: [b],
    } = await c.query(
      "SELECT (SELECT count(*) FROM appointments WHERE tenant_id=$1 AND patient_id=$2 AND starts_at>now() AND status NOT IN('CANCELLED','ABSENT'))::int AS future,(SELECT count(*) FROM waitlist WHERE tenant_id=$1 AND patient_id=$2 AND status IN('WAITING','OFFERED'))::int AS waiting",
      [ctx.tenantId, id],
    );
    if (b.future || b.waiting)
      throw new ApiError(
        422,
        `Antes de trocar de unidade, resolva ${plural(b.future, 'sessão futura', 'sessões futuras')} e ${plural(b.waiting, 'pedido na lista de espera', 'pedidos na lista de espera')}.`,
      );
    // Profissionais fixos eram da unidade antiga.
    const {
      rows: [row],
    } = await c.query(
      "UPDATE patients SET unit_id=$3,metadata=metadata-'fixed_professionals',version=version+1 WHERE tenant_id=$1 AND id=$2 RETURNING *",
      [ctx.tenantId, id, d.unit_id],
    );
    await recordVersion(c, ctx, 'patients', row, 'Troca de unidade: ' + d.reason);
    await audit(c, ctx, 'patients.unit_transferred', 'patients', id, d.unit_id, {
      from: p.unit_id,
      to: d.unit_id,
      reason: d.reason,
    });
    return row;
  });
}

// Documento removido sai das listas e do download; o registro e o motivo ficam para auditoria.
export async function removeDocument(ctx: Context, id: string, input: unknown) {
  permit(ctx, managers);
  z.uuid().parse(id);
  const d = z.object({ reason: reasonSchema }).strict().parse(input);
  return transaction(async (c) => {
    const {
      rows: [doc],
    } = await c.query(
      'SELECT id,unit_id,patient_id,professional_id,deleted_at FROM documents WHERE tenant_id=$1 AND id=$2 FOR UPDATE',
      [ctx.tenantId, id],
    );
    if (!doc || doc.deleted_at) throw new ApiError(404, 'Documento não encontrado.');
    assertUnit(ctx, doc.unit_id);
    if (
      (
        await c.query('SELECT 1 FROM payment_events WHERE tenant_id=$1 AND document_id=$2', [
          ctx.tenantId,
          id,
        ])
      ).rowCount
    )
      throw new ApiError(
        422,
        'Este documento é comprovante de um pagamento e não pode ser removido.',
      );
    await c.query(
      'UPDATE documents SET deleted_at=now(),deleted_by=$3,delete_reason=$4 WHERE tenant_id=$1 AND id=$2',
      [ctx.tenantId, id, ctx.userId, d.reason],
    );
    await audit(c, ctx, 'document.removed', 'documents', id, doc.unit_id, {
      reason: d.reason,
      patientId: doc.patient_id,
      professionalId: doc.professional_id,
    });
    return { removed: true };
  });
}

// Procedimentos e preços do convênio (código TUSS). O valor faturável usa a função session_amount do banco.
const procedureSchema = z
  .object({
    code: z
      .string()
      .trim()
      .regex(/^[0-9A-Za-z.-]{3,20}$/, 'Código do procedimento inválido.'),
    description: z.string().trim().min(3).max(200),
    specialty: z.string().trim().max(30).nullable().default(null),
    duration: z.coerce.number().int().min(15).max(240),
    price: z.coerce.number().min(0).max(1000000),
  })
  .strict();
async function insurerRow(c: PoolClient, ctx: Context, insurerId: string) {
  z.uuid().parse(insurerId);
  const {
    rows: [i],
  } = await c.query('SELECT id,name FROM insurers WHERE tenant_id=$1 AND id=$2', [
    ctx.tenantId,
    insurerId,
  ]);
  if (!i) throw new ApiError(404, 'Convênio não encontrado.');
  return i;
}
export async function listProcedures(ctx: Context, insurerId: string) {
  permit(ctx, readRoles.insurers);
  return transaction(async (c) => {
    const i = await insurerRow(c, ctx, insurerId);
    const { rows } = await c.query(
      'SELECT id,code,description,specialty,duration,price::float AS price,active FROM insurer_procedures WHERE tenant_id=$1 AND insurer_id=$2 ORDER BY active DESC,specialty NULLS FIRST,duration,code',
      [ctx.tenantId, insurerId],
    );
    return { insurer: i, data: rows };
  });
}
export async function saveProcedure(
  ctx: Context,
  insurerId: string,
  procedureId: string | null,
  input: unknown,
) {
  permit(ctx, managers);
  const body = z.object({ active: z.boolean().optional() }).passthrough().parse(input);
  return transaction(async (c) => {
    const i = await insurerRow(c, ctx, insurerId);
    try {
      if (procedureId && body.active !== undefined && Object.keys(body).length === 1) {
        z.uuid().parse(procedureId);
        const {
          rows: [row],
        } = await c.query(
          'UPDATE insurer_procedures SET active=$4,updated_at=now() WHERE tenant_id=$1 AND insurer_id=$2 AND id=$3 RETURNING *',
          [ctx.tenantId, insurerId, procedureId, body.active],
        );
        if (!row) throw new ApiError(404, 'Procedimento não encontrado.');
        await audit(
          c,
          ctx,
          'insurer.procedure_' + (body.active ? 'reactivated' : 'deactivated'),
          'insurer_procedures',
          procedureId,
          null,
          { insurer: i.name, code: row.code },
        );
        return row;
      }
      const d = procedureSchema.parse(
        Object.fromEntries(Object.entries(body).filter(([k]) => k !== 'active')),
      );
      if (d.specialty) await assertSpecialties(ctx.tenantId, [d.specialty], c);
      const {
        rows: [row],
      } = procedureId
        ? await c.query(
            'UPDATE insurer_procedures SET code=$4,description=$5,specialty=$6,duration=$7,price=$8,updated_at=now() WHERE tenant_id=$1 AND insurer_id=$2 AND id=$3 RETURNING *',
            [
              ctx.tenantId,
              insurerId,
              z.uuid().parse(procedureId),
              d.code,
              d.description,
              d.specialty,
              d.duration,
              d.price,
            ],
          )
        : await c.query(
            'INSERT INTO insurer_procedures(tenant_id,insurer_id,code,description,specialty,duration,price) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *',
            [ctx.tenantId, insurerId, d.code, d.description, d.specialty, d.duration, d.price],
          );
      if (!row) throw new ApiError(404, 'Procedimento não encontrado.');
      await audit(
        c,
        ctx,
        'insurer.procedure_' + (procedureId ? 'updated' : 'created'),
        'insurer_procedures',
        row.id,
        null,
        {
          insurer: i.name,
          code: d.code,
          price: d.price,
          duration: d.duration,
          specialty: d.specialty,
        },
      );
      return row;
    } catch (e: any) {
      if (e?.code === '23505')
        throw new ApiError(
          409,
          'Já existe um procedimento ativo para esta especialidade e duração neste convênio.',
        );
      throw e;
    }
  });
}
