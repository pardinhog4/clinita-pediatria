import { z } from 'zod';
import type { PoolClient } from 'pg';
import { query, transaction } from '@/lib/db';
import { ApiError } from '@/lib/errors';
import { permit, assertUnit, type Context } from '@/lib/security';
import { audit, managers, receptionRoles } from './repository';
import { normalize } from './professional-profiles';
import { assertSpecialties } from './specialties';
// Cadastros base da clínica: unidades, filas de atendimento, especialidades e catálogo de competências.
// Padrão: listar, criar, editar e desativar/reativar (nunca apagar: há histórico e auditoria apontando para eles).
export const registryKinds = ['units', 'queues', 'specialties', 'competencies'] as const;
export type RegistryKind = (typeof registryKinds)[number];
const slug = (v: string) =>
  normalize(v)
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/^(\d)/, 'x$1')
    .slice(0, 30);
const code = z
  .string()
  .trim()
  .regex(/^[a-z][a-z0-9_]{1,29}$/, 'Use letras minúsculas, números e _ (ex.: musicoterapia).');
const reason = z.string().trim().min(5, 'Explique o motivo em poucas palavras.').max(500);
const isAdmin = (ctx: Context) => ctx.role === 'ADMIN';

export async function listRegistry(ctx: Context, kind: string, params: URLSearchParams) {
  const k = z.enum(registryKinds).parse(kind);
  if (k === 'units') {
    permit(ctx, managers);
    return {
      data: await query(
        `SELECT u.id,u.name,u.sort_order,u.active,u.deactivated_at,(SELECT count(*) FROM professionals p WHERE p.tenant_id=u.tenant_id AND p.unit_id=u.id AND p.active)::int AS professionals,(SELECT count(*) FROM patients p WHERE p.tenant_id=u.tenant_id AND p.unit_id=u.id)::int AS patients FROM units u WHERE u.tenant_id=$1 AND ($2::boolean OR u.id=ANY($3::uuid[])) ORDER BY u.active DESC,u.sort_order,u.name`,
        [ctx.tenantId, isAdmin(ctx), ctx.unitIds],
      ),
      canCreate: isAdmin(ctx),
    };
  }
  if (k === 'queues') {
    permit(ctx, receptionRoles);
    const unit = params.get('unit') || ctx.unitIds[0];
    assertUnit(ctx, unit);
    return {
      data: await query(
        `SELECT q.id,q.code,q.name,q.system,q.sort_order,q.active,(SELECT count(*) FROM conversations c WHERE c.tenant_id=q.tenant_id AND c.queue_id=q.id AND c.status<>'DONE' AND c.deleted_at IS NULL)::int AS open_conversations FROM service_queues q WHERE q.tenant_id=$1 AND q.unit_id=$2 ORDER BY q.active DESC,q.sort_order,q.name`,
        [ctx.tenantId, unit],
      ),
      canCreate: managers.includes(ctx.role),
    };
  }
  if (k === 'specialties') {
    return {
      data: await query(
        `SELECT s.code AS id,s.code,s.name,s.shared_room,s.sort_order,s.active,(SELECT count(*) FROM professionals p WHERE p.tenant_id=s.tenant_id AND p.specialty=s.code AND p.active)::int AS professionals FROM specialties s WHERE s.tenant_id=$1 ORDER BY s.active DESC,s.sort_order,s.name`,
        [ctx.tenantId],
      ),
      canCreate: managers.includes(ctx.role),
    };
  }
  permit(ctx, managers);
  return {
    data: await query(
      `SELECT c.code AS id,c.code,c.name,c.description,c.synonyms,c.specialties,c.offered,c.active,(SELECT count(*) FROM professionals p WHERE p.tenant_id=c.tenant_id AND c.code=ANY(p.competencies) AND p.active)::int AS professionals FROM competency_catalog c WHERE c.tenant_id=$1 ORDER BY c.active DESC,c.name`,
      [ctx.tenantId],
    ),
    canCreate: true,
  };
}

const unitSchema = z
  .object({
    name: z.string().trim().min(2).max(80),
    sort_order: z.coerce.number().int().min(0).max(999).default(100),
  })
  .strict();
const queueSchema = z
  .object({
    name: z.string().trim().min(2).max(80),
    sort_order: z.coerce.number().int().min(0).max(999).default(100),
  })
  .strict();
const specialtySchema = z
  .object({
    code: code.optional(),
    name: z.string().trim().min(2).max(80),
    shared_room: z.boolean().default(false),
    sort_order: z.coerce.number().int().min(0).max(999).default(100),
  })
  .strict();
const competencySchema = z
  .object({
    code: code.optional(),
    name: z.string().trim().min(2).max(120),
    description: z.string().trim().max(600).default(''),
    synonyms: z.array(z.string().trim().min(1).max(80)).max(30).default([]),
    specialties: z.array(code).max(20).default([]),
    offered: z.boolean().default(true),
  })
  .strict();
async function unique(c: PoolClient, sql: string, values: unknown[], message: string) {
  if ((await c.query(sql, values)).rowCount) throw new ApiError(409, message);
}

export async function saveRegistry(ctx: Context, kind: string, id: string | null, input: unknown) {
  const k = z.enum(registryKinds).parse(kind);
  permit(ctx, managers);
  return transaction(async (c) => {
    let row: any,
      action = id ? 'updated' : 'created';
    if (k === 'units') {
      const d = unitSchema.parse(input);
      if (id) {
        z.uuid().parse(id);
        assertUnit(ctx, id);
        await unique(
          c,
          'SELECT 1 FROM units WHERE tenant_id=$1 AND lower(name)=lower($2) AND id<>$3',
          [ctx.tenantId, d.name, id],
          'Já existe uma unidade com este nome.',
        );
        ({
          rows: [row],
        } = await c.query(
          'UPDATE units SET name=$3,sort_order=$4,updated_at=now() WHERE tenant_id=$1 AND id=$2 RETURNING *',
          [ctx.tenantId, id, d.name, d.sort_order],
        ));
      } else {
        if (!isAdmin(ctx)) throw new ApiError(403, 'Somente a direção cria unidades.');
        await unique(
          c,
          'SELECT 1 FROM units WHERE tenant_id=$1 AND lower(name)=lower($2)',
          [ctx.tenantId, d.name],
          'Já existe uma unidade com este nome.',
        );
        // O gatilho do banco cria as 6 filas de sistema; a direção (e quem criou) passa a ter acesso à unidade.
        ({
          rows: [row],
        } = await c.query(
          'INSERT INTO units(tenant_id,name,sort_order) VALUES($1,$2,$3) RETURNING *',
          [ctx.tenantId, d.name, d.sort_order],
        ));
        await c.query(
          "UPDATE memberships SET unit_ids=array_append(unit_ids,$2) WHERE tenant_id=$1 AND active AND (role='ADMIN' OR user_id=$3) AND NOT $2=ANY(unit_ids)",
          [ctx.tenantId, row.id, ctx.userId],
        );
      }
      if (!row) throw new ApiError(404, 'Unidade não encontrada.');
      await audit(c, ctx, 'unit.' + action, 'units', row.id, row.id, { name: row.name });
      return row;
    }
    if (k === 'queues') {
      const body = z.object({ unit_id: z.uuid().optional() }).passthrough().parse(input),
        { unit_id, ...rest } = body as any;
      const d = queueSchema.parse(rest);
      if (id) {
        z.uuid().parse(id);
        const {
          rows: [q],
        } = await c.query('SELECT * FROM service_queues WHERE tenant_id=$1 AND id=$2 FOR UPDATE', [
          ctx.tenantId,
          id,
        ]);
        if (!q) throw new ApiError(404, 'Fila não encontrada.');
        assertUnit(ctx, q.unit_id);
        await unique(
          c,
          'SELECT 1 FROM service_queues WHERE tenant_id=$1 AND unit_id=$2 AND lower(name)=lower($3) AND id<>$4',
          [ctx.tenantId, q.unit_id, d.name, id],
          'Já existe uma fila com este nome na unidade.',
        );
        ({
          rows: [row],
        } = await c.query(
          'UPDATE service_queues SET name=$3,sort_order=$4 WHERE tenant_id=$1 AND id=$2 RETURNING *',
          [ctx.tenantId, id, d.name, d.sort_order],
        ));
      } else {
        if (!unit_id) throw new ApiError(422, 'Informe a unidade da fila.');
        assertUnit(ctx, unit_id);
        const base = slug(d.name) || 'fila';
        let qcode = base,
          n = 1;
        while (
          (
            await c.query(
              'SELECT 1 FROM service_queues WHERE tenant_id=$1 AND unit_id=$2 AND code=$3',
              [ctx.tenantId, unit_id, qcode],
            )
          ).rowCount
        )
          qcode = base.slice(0, 26) + '_' + ++n;
        await unique(
          c,
          'SELECT 1 FROM service_queues WHERE tenant_id=$1 AND unit_id=$2 AND lower(name)=lower($3)',
          [ctx.tenantId, unit_id, d.name],
          'Já existe uma fila com este nome na unidade.',
        );
        ({
          rows: [row],
        } = await c.query(
          'INSERT INTO service_queues(tenant_id,unit_id,code,name,sort_order,system) VALUES($1,$2,$3,$4,$5,false) RETURNING *',
          [ctx.tenantId, unit_id, qcode, d.name, d.sort_order],
        ));
      }
      await audit(c, ctx, 'queue.' + action, 'service_queues', row.id, row.unit_id, {
        name: row.name,
        code: row.code,
      });
      return row;
    }
    if (k === 'specialties') {
      const d = specialtySchema.parse(input);
      if (id) {
        const {
          rows: [s],
        } = await c.query('SELECT * FROM specialties WHERE tenant_id=$1 AND code=$2 FOR UPDATE', [
          ctx.tenantId,
          id,
        ]);
        if (!s) throw new ApiError(404, 'Especialidade não encontrada.');
        if (d.code && d.code !== id)
          throw new ApiError(422, 'O código da especialidade não muda depois de criado.');
        await unique(
          c,
          'SELECT 1 FROM specialties WHERE tenant_id=$1 AND lower(name)=lower($2) AND code<>$3',
          [ctx.tenantId, d.name, id],
          'Já existe uma especialidade com este nome.',
        );
        ({
          rows: [row],
        } = await c.query(
          'UPDATE specialties SET name=$3,shared_room=$4,sort_order=$5,updated_at=now() WHERE tenant_id=$1 AND code=$2 RETURNING *',
          [ctx.tenantId, id, d.name, d.shared_room, d.sort_order],
        ));
      } else {
        const scode = d.code || slug(d.name);
        code.parse(scode);
        await unique(
          c,
          'SELECT 1 FROM specialties WHERE tenant_id=$1 AND (code=$2 OR lower(name)=lower($3))',
          [ctx.tenantId, scode, d.name],
          'Já existe uma especialidade com este código ou nome.',
        );
        ({
          rows: [row],
        } = await c.query(
          'INSERT INTO specialties(tenant_id,code,name,shared_room,sort_order) VALUES($1,$2,$3,$4,$5) RETURNING *',
          [ctx.tenantId, scode, d.name, d.shared_room, d.sort_order],
        ));
      }
      await audit(c, ctx, 'specialty.' + action, 'specialties', null, null, {
        code: row.code,
        name: row.name,
        shared_room: row.shared_room,
      });
      return { ...row, id: row.code };
    }
    const d = competencySchema.parse(input);
    await assertSpecialties(ctx.tenantId, d.specialties, c);
    if (id) {
      const {
        rows: [k0],
      } = await c.query(
        'SELECT 1 FROM competency_catalog WHERE tenant_id=$1 AND code=$2 FOR UPDATE',
        [ctx.tenantId, id],
      );
      if (!k0) throw new ApiError(404, 'Competência não encontrada.');
      if (d.code && d.code !== id)
        throw new ApiError(422, 'O código da competência não muda depois de criado.');
      ({
        rows: [row],
      } = await c.query(
        'UPDATE competency_catalog SET name=$3,description=$4,synonyms=$5,specialties=$6,offered=$7,updated_at=now() WHERE tenant_id=$1 AND code=$2 RETURNING *',
        [ctx.tenantId, id, d.name, d.description, d.synonyms, d.specialties, d.offered],
      ));
    } else {
      const ccode = d.code || slug(d.name);
      code.parse(ccode);
      await unique(
        c,
        'SELECT 1 FROM competency_catalog WHERE tenant_id=$1 AND code=$2',
        [ctx.tenantId, ccode],
        'Já existe uma competência com este código.',
      );
      ({
        rows: [row],
      } = await c.query(
        'INSERT INTO competency_catalog(tenant_id,code,name,description,synonyms,specialties,offered) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *',
        [ctx.tenantId, ccode, d.name, d.description, d.synonyms, d.specialties, d.offered],
      ));
    }
    await audit(c, ctx, 'competency.' + action, 'competency_catalog', null, null, {
      code: row.code,
      name: row.name,
      offered: row.offered,
    });
    return { ...row, id: row.code };
  });
}

export async function setRegistryActive(ctx: Context, kind: string, id: string, input: unknown) {
  const k = z.enum(registryKinds).parse(kind);
  permit(ctx, managers);
  const d = z.object({ active: z.boolean(), reason: reason.optional() }).strict().parse(input);
  if (!d.active && !d.reason) throw new ApiError(422, 'Explique o motivo da desativação.');
  return transaction(async (c) => {
    if (k === 'units') {
      if (!isAdmin(ctx)) throw new ApiError(403, 'Somente a direção ativa ou desativa unidades.');
      z.uuid().parse(id);
      const {
        rows: [u],
      } = await c.query('SELECT * FROM units WHERE tenant_id=$1 AND id=$2 FOR UPDATE', [
        ctx.tenantId,
        id,
      ]);
      if (!u) throw new ApiError(404, 'Unidade não encontrada.');
      if (!d.active) {
        const {
          rows: [n],
        } = await c.query(
          'SELECT count(*)::int AS n FROM units WHERE tenant_id=$1 AND active AND id<>$2',
          [ctx.tenantId, id],
        );
        if (!n.n) throw new ApiError(422, 'A clínica precisa de ao menos uma unidade ativa.');
        const {
          rows: [busy],
        } = await c.query(
          "SELECT (SELECT count(*) FROM professionals WHERE tenant_id=$1 AND unit_id=$2 AND active)::int AS professionals,(SELECT count(*) FROM appointments WHERE tenant_id=$1 AND unit_id=$2 AND starts_at>now() AND status NOT IN('CANCELLED','ABSENT'))::int AS future",
          [ctx.tenantId, id],
        );
        if (busy.professionals || busy.future)
          throw new ApiError(
            422,
            `Antes de desativar, transfira ${busy.professionals} profissional(is) ativo(s) e resolva ${busy.future} sessão(ões) futura(s) desta unidade.`,
          );
      }
      const {
        rows: [row],
      } = await c.query(
        'UPDATE units SET active=$3,deactivated_at=CASE WHEN $3 THEN NULL ELSE now() END,updated_at=now() WHERE tenant_id=$1 AND id=$2 RETURNING *',
        [ctx.tenantId, id, d.active],
      );
      await audit(c, ctx, d.active ? 'unit.reactivated' : 'unit.deactivated', 'units', id, id, {
        reason: d.reason,
      });
      return row;
    }
    if (k === 'queues') {
      z.uuid().parse(id);
      const {
        rows: [q],
      } = await c.query('SELECT * FROM service_queues WHERE tenant_id=$1 AND id=$2 FOR UPDATE', [
        ctx.tenantId,
        id,
      ]);
      if (!q) throw new ApiError(404, 'Fila não encontrada.');
      assertUnit(ctx, q.unit_id);
      if (q.system && !d.active)
        throw new ApiError(
          422,
          'Filas de sistema são usadas pela IA e pelos fluxos e não podem ser desativadas. Você pode renomear.',
        );
      if (!d.active) {
        const {
          rows: [o],
        } = await c.query(
          "SELECT count(*)::int AS n FROM conversations WHERE tenant_id=$1 AND queue_id=$2 AND status<>'DONE' AND deleted_at IS NULL",
          [ctx.tenantId, id],
        );
        if (o.n)
          throw new ApiError(
            422,
            `Há ${o.n} atendimento(s) aberto(s) nesta fila. Transfira ou encerre antes de desativar.`,
          );
      }
      const {
        rows: [row],
      } = await c.query(
        'UPDATE service_queues SET active=$3 WHERE tenant_id=$1 AND id=$2 RETURNING *',
        [ctx.tenantId, id, d.active],
      );
      await audit(
        c,
        ctx,
        d.active ? 'queue.reactivated' : 'queue.deactivated',
        'service_queues',
        id,
        q.unit_id,
        { reason: d.reason },
      );
      return row;
    }
    const table = k === 'specialties' ? 'specialties' : 'competency_catalog';
    const {
      rows: [row],
    } = await c.query(
      `UPDATE ${table} SET active=$3,updated_at=now() WHERE tenant_id=$1 AND code=$2 RETURNING *`,
      [ctx.tenantId, id, d.active],
    );
    if (!row) throw new ApiError(404, 'Registro não encontrado.');
    if (k === 'specialties' && !d.active) {
      const {
        rows: [n],
      } = await c.query(
        'SELECT count(*)::int AS n FROM specialties WHERE tenant_id=$1 AND active',
        [ctx.tenantId],
      );
      if (!n.n) throw new ApiError(422, 'A clínica precisa de ao menos uma especialidade ativa.');
    }
    await audit(
      c,
      ctx,
      (k === 'specialties' ? 'specialty.' : 'competency.') +
        (d.active ? 'reactivated' : 'deactivated'),
      table,
      null,
      null,
      { code: id, reason: d.reason },
    );
    return { ...row, id: row.code };
  });
}
