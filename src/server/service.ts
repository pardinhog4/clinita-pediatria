import type { PoolClient } from 'pg';
import { checkExtraConstraints, appointmentHooks } from './scheduling';
import { assertLedgerEditable } from './operational-lifecycle';
import { recordVersion, ensureBaseline } from './lifecycle';
import { assertSpecialties, isSharedSpecialty } from './specialties';
import { requiredTokens } from './session-evidence';
import { reviewPayout, requireApprovedPayout } from './payouts';
import { tenantRules, unitRules, unitTimezone } from './clinic-rules';
import { randomUUID } from 'node:crypto';
import { fitsDay, outsideHoursMessage } from '@/lib/clinic-rules';
import {
  addDaysTo,
  localDate,
  localMinutes,
  localTime,
  localWeekday,
  zonedInstant,
} from '@/lib/timezone';
import { z } from 'zod';
import { query, transaction } from '@/lib/db';
import { ApiError } from '@/lib/errors';
import { assertUnit, permit, type Context } from '@/lib/security';
import * as s from '@/lib/schemas';
import {
  audit,
  scopeRow,
  version,
  clinicalAccess,
  tableMap,
  managers,
  financeRoles,
  clinicRoles,
  receptionRoles,
  auditRoles,
  readRoles,
} from './repository';
import { ensureAllowed } from './domain';
import { resolveCounterparty } from './directory';
import { transferConversation } from './transfers';
const schemas = {
  patients: s.patientSchema,
  professionals: s.professionalSchema,
  ledger: s.ledgerSchema,
  inventory: s.inventorySchema,
  agents: s.agentSchema,
  conversations: s.conversationSchema,
  models: s.modelSchema,
  rooms: s.roomSchema,
  insurers: s.insurerSchema,
};
const writeRoles = {
  patients: receptionRoles,
  professionals: managers,
  ledger: financeRoles,
  inventory: financeRoles,
  agents: managers,
  conversations: receptionRoles,
  models: managers,
  rooms: managers,
  insurers: managers,
};
async function validateRelations(
  c: import('pg').PoolClient,
  ctx: Context,
  resource: string,
  data: Record<string, unknown>,
  existingId?: string,
) {
  if (resource === 'insurers') {
    const r = data.rules as Record<string, any>;
    if (r.authorization_type) {
      r.token_required = r.authorization_type === 'TOKEN';
      r.signature_required = r.authorization_type === 'GUIDE';
    }
  }
  if (resource === 'professionals') {
    const m = data.metadata as Record<string, any>;
    if (m.max_age < m.min_age) throw new ApiError(422, 'Faixa etária inválida.');
  }

  if (data.unit_id) {
    assertUnit(ctx, String(data.unit_id));
    const {
      rows: [unit],
    } = await c.query('SELECT id FROM units WHERE tenant_id=$1 AND id=$2', [
      ctx.tenantId,
      data.unit_id,
    ]);
    if (!unit) throw new ApiError(422, 'Unidade inválida.');
  }
  if (resource === 'patients') {
    await c.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
      ctx.tenantId +
        ':' +
        String(data.name).toLowerCase().replace(/\s+/g, ' ') +
        ':' +
        data.birth_date,
    ]);
    const duplicates = await c.query(
      "SELECT id FROM patients WHERE tenant_id=$1 AND unit_id=$2 AND lower(regexp_replace(name,'\\s+',' ','g'))=lower(regexp_replace($3,'\\s+',' ','g')) AND birth_date=$4 AND ($5::uuid IS NULL OR id<>$5)",
      [ctx.tenantId, data.unit_id, data.name, data.birth_date, existingId || null],
    );
    if (duplicates.rowCount)
      throw new ApiError(409, 'Já existe paciente com este nome e nascimento na unidade.');
    const {
      rows: [insurer],
    } = await c.query('SELECT id,active FROM insurers WHERE id=$1 AND tenant_id=$2', [
      data.insurer_id,
      ctx.tenantId,
    ]);
    if (!insurer) throw new ApiError(422, 'Convênio inválido.');
    if (!insurer.active) {
      const {
        rows: [cur],
      } = existingId
        ? await c.query('SELECT insurer_id FROM patients WHERE id=$1', [existingId])
        : { rows: [] };
      if (cur?.insurer_id !== data.insurer_id)
        throw new ApiError(422, 'Convênio desativado. Escolha um convênio ativo.');
    }
  }
  if (resource === 'professionals') {
    const room = await scopeRow(c, ctx, 'rooms', String(data.room_id));
    if (!room.active) {
      const {
        rows: [cur],
      } = existingId
        ? await c.query('SELECT room_id FROM professionals WHERE id=$1', [existingId])
        : { rows: [] };
      if (cur?.room_id !== data.room_id)
        throw new ApiError(422, 'Sala desativada. Escolha uma sala ativa.');
    }
    if (room.unit_id !== data.unit_id) throw new ApiError(422, 'Sala de outra unidade.');
    if (room.capacity > 1 && !(await isSharedSpecialty(ctx.tenantId, String(data.specialty), c)))
      throw new ApiError(
        422,
        'Salas coletivas exigem especialidade com atendimento em grupo (configurada em Especialidades).',
      );
  }
  if (resource === 'professionals' || resource === 'models')
    await assertSpecialties(ctx.tenantId, [data.specialty], c);
  if (resource === 'patients')
    await assertSpecialties(ctx.tenantId, (data.metadata as any)?.specialties || [], c);
  if (resource === 'ledger' && data.counterparty_ref)
    data.counterparty = await resolveCounterparty(
      ctx,
      String(data.counterparty_ref),
      String(data.unit_id),
    );
  if (resource === 'conversations' && data.patient_id) {
    const patient = await scopeRow(c, ctx, 'patients', String(data.patient_id));
    if (patient.unit_id !== data.unit_id) throw new ApiError(422, 'Paciente de outra unidade.');
    data.guardian = patient.guardian;
  }
}
export async function create(ctx: Context, resource: string, input: unknown) {
  if (resource === 'appointments') return createAppointments(ctx, input);
  if (resource === 'clinical') {
    permit(ctx, clinicRoles);
    const d = s.clinicalSchema.parse(input);
    await clinicalAccess(ctx, d.patient_id);
    return transaction(async (c) => {
      let snapshot: any =
        d.kind === 'REPORT' ? { report: { recipient: d.recipient || 'Não informado' } } : null;
      if (d.kind === 'REPORT' && (!d.recipient || d.recipient.trim().length < 3))
        throw new ApiError(422, 'Informe o destinatário do relatório.');
      if (d.model_id) {
        const m = await scopeRow(c, ctx, 'assessment_models', d.model_id);
        for (const [index, q] of m.questions.entries()) {
          const answer = d.answers?.[String(index)];
          if (
            (q.type === 'number' && (typeof answer !== 'number' || !Number.isFinite(answer))) ||
            (q.type !== 'number' && (typeof answer !== 'string' || !answer.trim())) ||
            (q.type === 'select' && !q.options?.includes(answer))
          )
            throw new ApiError(422, 'Responda todas as perguntas do modelo com valores válidos.');
        }
        if (ctx.role === 'CLINICIAN') {
          const {
            rows: [prof],
          } = await c.query(
            "SELECT specialty FROM professionals WHERE tenant_id=$1 AND metadata->>'user_id'=$2",
            [ctx.tenantId, ctx.userId],
          );
          if (!prof || prof.specialty !== m.specialty)
            throw new ApiError(403, 'Modelo de outra especialidade.');
        }
        snapshot = { model: m, answers: d.answers };
      }
      const {
        rows: [row],
      } = await c.query(
        'INSERT INTO clinical_entries(tenant_id,patient_id,kind,content,model_snapshot,created_by) VALUES($1,$2,$3,$4,$5,$6) RETURNING *',
        [
          ctx.tenantId,
          d.patient_id,
          d.kind,
          d.content,
          snapshot ? JSON.stringify(snapshot) : null,
          ctx.userId,
        ],
      );
      await audit(c, ctx, 'clinical.created', 'clinical', row.id, null, {
        patientId: d.patient_id,
        kind: d.kind,
      });
      return row;
    });
  }
  return transaction((c) => createWithClient(c, ctx, resource, input));
}

/**
 * Cadastro simples (paciente, profissional, convênio, sala…) dentro de uma transação já aberta.
 * Usado pela tela de cadastro e pela importação de planilha (mesmas regras, versão e auditoria).
 */
export async function createWithClient(
  c: PoolClient,
  ctx: Context,
  resource: string,
  input: unknown,
) {
  if (!(resource in schemas)) throw new ApiError(404, 'Recurso não encontrado.');
  const key = resource as keyof typeof schemas;
  permit(ctx, writeRoles[key]);
  const parsed = schemas[key].parse(input);
  const data = { ...parsed } as Record<string, unknown>;
  {
    await validateRelations(c, ctx, resource, data);
    const columns = Object.keys(data);
    const values = [
      ctx.tenantId,
      ...columns.map((k) =>
        ['metadata', 'rules', 'questions'].includes(k) ? JSON.stringify(data[k]) : data[k],
      ),
    ];
    const {
      rows: [row],
    } = await c.query(
      `INSERT INTO ${tableMap[resource]}(tenant_id,${columns.join(',')}) VALUES(${values.map((_, i) => '$' + (i + 1)).join(',')}) RETURNING *`,
      values,
    );
    if (resource === 'agents')
      await c.query(
        'INSERT INTO agent_versions(tenant_id,agent_id,version,snapshot,created_by) VALUES($1,$2,1,$3,$4)',
        [ctx.tenantId, row.id, JSON.stringify(row), ctx.userId],
      );
    await recordVersion(c, ctx, resource, row, 'Cadastro criado');
    await audit(c, ctx, 'record.created', resource, row.id, row.unit_id || null);
    return row;
  }
}
export async function update(ctx: Context, resource: string, id: string, input: unknown) {
  s.uuid.parse(id);
  if (
    ![
      'patients',
      'professionals',
      'agents',
      'models',
      'rooms',
      'insurers',
      'inventory',
      'ledger',
    ].includes(resource)
  )
    throw new ApiError(405, 'Use o fluxo específico deste registro.');
  const key = resource as keyof typeof schemas;
  permit(ctx, writeRoles[key]);
  const envelope = z
    .object({
      version: z.number().int().positive(),
      data: schemas[key],
      reason: z.string().trim().max(3000).optional(),
    })
    .strict()
    .parse(input);
  const data = envelope.data as Record<string, unknown>;
  return transaction(async (c) => {
    const current = await scopeRow(c, ctx, tableMap[resource], id, true);
    version(current, envelope.version);
    if (
      resource === 'insurers' &&
      JSON.stringify(current.rules) !== JSON.stringify(data.rules) &&
      (!envelope.reason || envelope.reason.length < 10)
    )
      throw new ApiError(422, 'Justifique a alteração das regras do plano.');
    if (current.unit_id && data.unit_id !== current.unit_id)
      throw new ApiError(422, 'Transferência de unidade requer fluxo dedicado.');
    if (resource === 'inventory' && data.quantity !== current.quantity)
      throw new ApiError(422, 'O saldo muda só por movimentação de estoque.');
    if (resource === 'inventory' && current.active === false)
      throw new ApiError(422, 'Item arquivado. Reative antes de editar.');
    if (resource === 'ledger') {
      await assertLedgerEditable(c, ctx, current);
      if (!envelope.reason || envelope.reason.length < 10)
        throw new ApiError(422, 'Explique a correção do lançamento.');
    }
    await validateRelations(c, ctx, resource, data, id);
    const columns = Object.keys(data);
    const values = [
      ctx.tenantId,
      id,
      envelope.version,
      ...columns.map((k) =>
        ['metadata', 'rules', 'questions'].includes(k) ? JSON.stringify(data[k]) : data[k],
      ),
    ];
    const {
      rows: [row],
    } = await c.query(
      `UPDATE ${tableMap[resource]} SET ${columns.map((k, i) => k + '=$' + (i + 4)).join(',')},version=version+1 WHERE tenant_id=$1 AND id=$2 AND version=$3 RETURNING *`,
      values,
    );
    if (!row) throw new ApiError(409, 'Registro alterado.');
    if (resource === 'agents')
      await c.query(
        'INSERT INTO agent_versions(tenant_id,agent_id,version,snapshot,created_by) VALUES($1,$2,$3,$4,$5)',
        [ctx.tenantId, id, row.version, JSON.stringify(row), ctx.userId],
      );
    await ensureBaseline(c, ctx, resource, current);
    await recordVersion(c, ctx, resource, row, envelope.reason || null);
    await audit(c, ctx, 'record.updated', resource, id, row.unit_id || null, {
      fromVersion: envelope.version,
      toVersion: row.version,
      reason: envelope.reason || null,
      changes: Object.fromEntries(
        columns
          .filter((k) => JSON.stringify(current[k]) !== JSON.stringify(row[k]))
          .map((k) => [k, { before: current[k], after: row[k] }]),
      ),
    });
    return row;
  });
}
export async function detail(ctx: Context, resource: string, id: string) {
  s.uuid.parse(id);
  if (!tableMap[resource]) throw new ApiError(404, 'Recurso não encontrado.');
  permit(ctx, readRoles[resource]);
  return transaction(async (c) => {
    const row = await scopeRow(c, ctx, tableMap[resource], id);
    if (resource === 'patients') {
      let clinical: unknown[] = [],
        documents: unknown[] = [];
      if (clinicRoles.includes(ctx.role)) {
        await clinicalAccess(ctx, id);
        clinical = (
          await c.query(
            'SELECT e.*,u.name AS author FROM clinical_entries e JOIN users u ON u.id=e.created_by WHERE e.tenant_id=$1 AND e.patient_id=$2 ORDER BY e.created_at DESC LIMIT 100',
            [ctx.tenantId, id],
          )
        ).rows;
        documents = (
          await c.query(
            'SELECT id,name,created_at FROM documents WHERE tenant_id=$1 AND patient_id=$2 AND deleted_at IS NULL ORDER BY created_at DESC',
            [ctx.tenantId, id],
          )
        ).rows;
        await audit(c, ctx, 'clinical.viewed', 'patients', id, row.unit_id);
      }
      const appointments = (
        await c.query(
          'SELECT a.*,pr.name AS professional_name,pr.specialty FROM appointments a JOIN professionals pr ON pr.id=a.professional_id AND pr.tenant_id=a.tenant_id WHERE a.tenant_id=$1 AND a.patient_id=$2 ORDER BY starts_at DESC LIMIT 100',
          [ctx.tenantId, id],
        )
      ).rows.map((a) => (clinicRoles.includes(ctx.role) ? a : { ...a, evolution: undefined }));
      const statistics = (
        await c.query(
          "SELECT count(*)::int AS total,count(*) FILTER(WHERE status='COMPLETED')::int AS completed,count(*) FILTER(WHERE status='ABSENT' AND absence_kind='PATIENT')::int AS absent,count(*) FILTER(WHERE status='CANCELLED' AND absence_kind='PATIENT')::int AS cancelled,count(*) FILTER(WHERE absence_kind='PROFESSIONAL')::int AS professional_absences FROM appointments WHERE tenant_id=$1 AND patient_id=$2",
          [ctx.tenantId, id],
        )
      ).rows[0];
      const credits = (
        await c.query(
          "SELECT c.*,i.name AS insurer_name,i.rules->>'contract_end' AS contract_end FROM session_credits c JOIN insurers i ON i.id=c.insurer_id AND i.tenant_id=c.tenant_id WHERE c.tenant_id=$1 AND c.patient_id=$2 ORDER BY c.created_at DESC",
          [ctx.tenantId, id],
        )
      ).rows;
      const care_team = (
        await c.query(
          'SELECT DISTINCT p.id,p.name,p.specialty,p.active FROM professionals p JOIN appointments a ON a.professional_id=p.id AND a.tenant_id=p.tenant_id WHERE a.tenant_id=$1 AND a.patient_id=$2 ORDER BY p.name',
          [ctx.tenantId, id],
        )
      ).rows;
      const assessments = (
        await c.query(
          'SELECT id,specialty,target_sessions,completed_sessions,status,created_at FROM patient_assessments WHERE tenant_id=$1 AND patient_id=$2 ORDER BY created_at DESC',
          [ctx.tenantId, id],
        )
      ).rows;
      const plan = (
        await c.query('SELECT name,rules FROM insurers WHERE tenant_id=$1 AND id=$2', [
          ctx.tenantId,
          row.insurer_id,
        ])
      ).rows[0];
      const copayment_items = row.metadata.coparticipation
        ? (
            await c.query(
              'SELECT bi.id,bi.amount::float,bi.snapshot,b.number AS batch_number FROM billing_items bi JOIN billing_batches b ON b.id=bi.batch_id AND b.tenant_id=bi.tenant_id JOIN appointments a ON a.id=bi.appointment_id AND a.tenant_id=bi.tenant_id WHERE a.tenant_id=$1 AND a.patient_id=$2 AND a.financial_hold=false ORDER BY a.starts_at DESC',
              [ctx.tenantId, id],
            )
          ).rows
        : [];
      return {
        ...row,
        clinical,
        documents,
        appointments,
        statistics,
        credits,
        care_team,
        assessments,
        copayment: {
          enabled: !!row.metadata.coparticipation,
          rate: Number(plan.rules.co_payment || 0),
          insurer_name: plan.name,
          items: copayment_items,
        },
        clinical_access: clinicRoles.includes(ctx.role),
      };
    }
    if (resource === 'conversations' && row.sandbox)
      throw new ApiError(404, 'Use a aba Sandbox para esta conversa.');
    if (resource === 'conversations')
      return {
        ...row,
        messages: (
          await c.query(
            'SELECT m.*,u.name AS author FROM messages m LEFT JOIN users u ON u.id=m.created_by WHERE m.tenant_id=$1 AND m.conversation_id=$2 ORDER BY m.created_at,m.id LIMIT 300',
            [ctx.tenantId, id],
          )
        ).rows,
      };
    if (resource === 'ledger')
      return {
        ...row,
        events: (
          await c.query(
            'SELECT e.*,u.name AS author,d.name AS document_name FROM payment_events e JOIN users u ON u.id=e.created_by LEFT JOIN documents d ON d.id=e.document_id AND d.tenant_id=e.tenant_id WHERE e.tenant_id=$1 AND e.ledger_id=$2 ORDER BY e.created_at DESC',
            [ctx.tenantId, id],
          )
        ).rows,
      };
    if (resource === 'agents')
      return {
        ...row,
        versions: (
          await c.query(
            'SELECT version,created_at FROM agent_versions WHERE tenant_id=$1 AND agent_id=$2 ORDER BY version DESC',
            [ctx.tenantId, id],
          )
        ).rows,
      };
    if (resource === 'professionals') {
      row.caseload_count = (
        await c.query(
          'SELECT count(DISTINCT patient_id)::int AS count FROM appointments WHERE tenant_id=$1 AND professional_id=$2',
          [ctx.tenantId, id],
        )
      ).rows[0].count;
      row.future_sessions = (
        await c.query(
          "SELECT count(*)::int AS count FROM appointments WHERE tenant_id=$1 AND professional_id=$2 AND starts_at>now() AND status IN('SCHEDULED','ARRIVED')",
          [ctx.tenantId, id],
        )
      ).rows[0].count;
      row.documents = (
        await c.query(
          "SELECT id,name,document_kind,created_at FROM documents WHERE tenant_id=$1 AND professional_id=$2 AND deleted_at IS NULL AND ($3::boolean OR document_kind='CERTIFICATE') ORDER BY created_at DESC",
          [ctx.tenantId, id, financeRoles.includes(ctx.role)],
        )
      ).rows;
      row.transfers = (
        await c.query(
          'SELECT t.id,t.reason,p.name AS patient_name,pf.name AS from_name,pt.name AS to_name FROM patient_transfers t JOIN patients p ON p.id=t.patient_id AND p.tenant_id=t.tenant_id JOIN professionals pf ON pf.id=t.from_professional_id AND pf.tenant_id=t.tenant_id JOIN professionals pt ON pt.id=t.to_professional_id AND pt.tenant_id=t.tenant_id WHERE t.tenant_id=$1 AND (t.from_professional_id=$2 OR t.to_professional_id=$2)',
          [ctx.tenantId, id],
        )
      ).rows;
      if (!financeRoles.includes(ctx.role)) {
        delete row.hourly_rate;
        const m = row.metadata;
        row.metadata = {
          min_age: m.min_age,
          max_age: m.max_age,
          work_days: m.work_days,
          certifications: m.certifications,
          pj_documents_confirmed: m.pj_documents_confirmed,
          assistant_names: m.assistant_names,
        };
      }
    }

    if (resource === 'appointments') {
      const {
        rows: [extra],
      } = await c.query(
        'SELECT p.name AS patient_name,pr.name AS professional_name,pr.specialty,i.rules FROM patients p JOIN professionals pr ON pr.tenant_id=p.tenant_id AND pr.id=$3 JOIN insurers i ON i.tenant_id=p.tenant_id AND i.id=p.insurer_id WHERE p.tenant_id=$1 AND p.id=$2',
        [ctx.tenantId, row.patient_id, row.professional_id],
      );
      Object.assign(row, extra);
      if (ctx.role === 'CLINICIAN') await clinicalAccess(ctx, row.patient_id);
      if (!clinicRoles.includes(ctx.role)) delete row.evolution;
    }
    return row;
  });
}
export async function createAppointments(ctx: Context, input: unknown) {
  permit(ctx, receptionRoles);
  const d = s.appointmentSchema.parse(input);
  assertUnit(ctx, d.unit_id);
  return transaction((c) => createAppointmentsWithClient(c, ctx, d));
}
export async function createAppointmentsWithClient(
  c: import('pg').PoolClient,
  ctx: Context,
  d: z.infer<typeof s.appointmentSchema>,
) {
  permit(ctx, receptionRoles);
  assertUnit(ctx, d.unit_id);
  const prof = await scopeRow(c, ctx, 'professionals', d.professional_id, true),
    pat = await scopeRow(c, ctx, 'patients', d.patient_id, true);
  const room = await scopeRow(c, ctx, 'rooms', prof.room_id, true);
  if (d.conversation_id) {
    const conv = await scopeRow(c, ctx, 'conversations', d.conversation_id);
    if (
      conv.unit_id !== d.unit_id ||
      conv.deleted_at ||
      (conv.patient_id && conv.patient_id !== pat.id)
    )
      throw new ApiError(422, 'Conversa incompatível com o paciente e a unidade.');
  }
  if (!pat.active)
    throw new ApiError(422, 'Paciente com alta. Reative o cadastro antes de agendar.');
  if (
    !prof.active ||
    prof.unit_id !== d.unit_id ||
    pat.unit_id !== d.unit_id ||
    room.unit_id !== d.unit_id
  )
    throw new ApiError(422, 'Paciente, profissional e sala devem pertencer à unidade.');
  const {
    rows: [insurer],
  } = await c.query('SELECT rules FROM insurers WHERE tenant_id=$1 AND id=$2', [
    ctx.tenantId,
    pat.insurer_id,
  ]);
  // Em domicílio o bloco é contado em sessões do convênio (ex.: 4 h = 4 sessões de 60 min).
  const home = d.location === 'HOME';
  const rules = await unitRules(ctx.tenantId, d.unit_id, c);
  const maxDuration = home ? rules.max_home_duration : rules.max_clinic_duration;
  if (d.duration > maxDuration)
    throw new ApiError(
      422,
      `${home ? 'Blocos em domicílio' : 'Sessões na clínica'} têm até ${maxDuration} minutos.`,
    );
  if (
    (home ? d.duration % insurer.rules.duration !== 0 : insurer.rules.duration !== d.duration) &&
    !(d.override_duration && d.reason.length >= 10)
  )
    throw new ApiError(
      422,
      home
        ? 'Em domicílio, a duração deve ser múltipla da sessão do convênio (' +
          insurer.rules.duration +
          ' min).'
        : 'A duração deve seguir o contrato do convênio: ' + insurer.rules.duration + ' min.',
    );
  if (
    pat.metadata.fixed_professionals?.[prof.specialty] &&
    pat.metadata.fixed_professionals[prof.specialty] !== prof.id &&
    d.reason.length < 10
  )
    throw new ApiError(
      422,
      'O paciente possui profissional fixo para esta área. Justifique a troca.',
    );
  if (!(pat.metadata.specialties || []).includes(prof.specialty))
    throw new ApiError(422, 'A especialidade não consta no pedido do paciente.');
  if (d.replacement_credit_id && d.occurrences !== 1)
    throw new ApiError(422, 'Uma reposição utiliza um crédito por vez.');
  let credit: any = null;
  if (d.replacement_credit_id) {
    const result = await c.query(
      'SELECT * FROM session_credits WHERE tenant_id=$1 AND unit_id=$2 AND id=$3 FOR UPDATE',
      [ctx.tenantId, d.unit_id, d.replacement_credit_id],
    );
    credit = result.rows[0];
    if (
      !credit ||
      credit.status !== 'OPEN' ||
      credit.patient_id !== pat.id ||
      credit.insurer_id !== pat.insurer_id
    )
      throw new ApiError(422, 'Crédito indisponível ou de outro paciente/plano.');
  }
  const series = d.occurrences > 1 ? randomUUID() : null;
  const rows = [];
  // Série semanal no relógio local da unidade: mesma hora local toda semana, mesmo se o fuso
  // mudar de deslocamento no meio da série.
  const tz = rules.timezone,
    firstDate = localDate(d.starts_at, tz),
    firstTime = localTime(d.starts_at, tz);
  for (let i = 0; i < d.occurrences; i++) {
    const start = zonedInstant(addDaysTo(firstDate, i * 7), firstTime, tz),
      end = new Date(start.getTime() + d.duration * 60000);
    const weekday = localWeekday(start, tz),
      mins = localMinutes(start, tz);
    if (start.getTime() < Date.now() - 60000)
      throw new ApiError(422, 'Não é possível agendar no passado.');
    // Expediente configurado da unidade (clínica) ou de domicílio, mais o horário do profissional.
    if (!fitsDay(rules, weekday, mins, d.duration, home, prof.metadata?.work_hours))
      throw new ApiError(
        422,
        fitsDay(rules, weekday, mins, d.duration, home)
          ? `Fora do horário de trabalho de ${prof.name} neste dia.`
          : outsideHoursMessage(rules, weekday, home),
      );
    if (pat.metadata.order_expires && localDate(start, tz) > pat.metadata.order_expires)
      throw new ApiError(422, 'Pedido médico vencido nesta ocorrência.');
    await checkExtraConstraints(c, ctx, prof, pat, start, end);
    if (insurer.rules.contract_end && localDate(start, tz) > insurer.rules.contract_end)
      throw new ApiError(422, 'O contrato do plano termina antes da sessão.');
    const {
      rows: [conflict],
    } = await c.query(
      `SELECT count(*) FILTER(WHERE professional_id=$2)::int AS professional_count,count(*) FILTER(WHERE room_id=$3 AND location='CLINIC')::int AS room_count,count(*) FILTER(WHERE patient_id=$4)::int AS patient_count FROM appointments WHERE tenant_id=$1 AND status NOT IN('CANCELLED','ABSENT') AND starts_at<$6 AND ends_at>$5 AND (professional_id=$2 OR room_id=$3 OR patient_id=$4)`,
      [ctx.tenantId, prof.id, room.id, pat.id, start, end],
    );
    if (
      conflict.patient_count ||
      (!home && conflict.room_count >= room.capacity) ||
      conflict.professional_count >=
        (home ? 1 : (await isSharedSpecialty(ctx.tenantId, prof.specialty, c)) ? room.capacity : 1)
    )
      throw new ApiError(
        409,
        'Conflito de paciente, profissional ou capacidade da sala em ' +
          start.toLocaleString('pt-BR', { timeZone: tz }) +
          '.',
      );
    const {
      rows: [row],
    } = await c.query(
      'INSERT INTO appointments(tenant_id,unit_id,patient_id,professional_id,room_id,starts_at,ends_at,series_id,appointment_kind,replacement_credit_id,reason,conversation_id,location) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *',
      [
        ctx.tenantId,
        d.unit_id,
        pat.id,
        prof.id,
        room.id,
        start,
        end,
        series,
        d.appointment_kind,
        d.replacement_credit_id || null,
        d.reason || null,
        d.conversation_id || null,
        d.location,
      ],
    );
    rows.push(row);
  }
  if (credit)
    await c.query(
      "UPDATE session_credits SET status='RESERVED',replacement_appointment_id=$3 WHERE tenant_id=$1 AND id=$2",
      [ctx.tenantId, credit.id, rows[0].id],
    );
  if (d.waitlist_id) {
    const changed = await c.query(
      "UPDATE waitlist SET status='SCHEDULED',appointment_id=$4 WHERE tenant_id=$1 AND unit_id=$2 AND id=$3 AND patient_id=$5 AND status IN('WAITING','OFFERED')",
      [ctx.tenantId, d.unit_id, d.waitlist_id, rows[0].id, pat.id],
    );
    if (!changed.rowCount) throw new ApiError(422, 'Entrada da lista de espera indisponível.');
  }
  await audit(c, ctx, 'appointments.created', 'appointments', rows[0].id, d.unit_id, {
    count: rows.length,
    seriesId: series,
  });
  return rows;
}
export async function appointmentEvent(ctx: Context, id: string, input: unknown) {
  const d = s.eventSchema.parse(input);
  const clinical = ['start', 'complete'].includes(d.action),
    auditing = ['approve', 'return'].includes(d.action);
  permit(ctx, clinical ? clinicRoles : auditing ? auditRoles : receptionRoles);
  return transaction(async (c) => {
    const a = await scopeRow(c, ctx, 'appointments', id, true);
    version(a, d.version);
    if (clinical) {
      await clinicalAccess(ctx, a.patient_id);
      if (ctx.role === 'CLINICIAN') {
        const prof = await scopeRow(c, ctx, 'professionals', a.professional_id);
        if (prof.metadata.user_id !== ctx.userId)
          throw new ApiError(403, 'Somente o profissional da sessão pode executá-la.');
      }
    }
    const {
      rows: [p],
    } = await c.query(
      'SELECT p.insurer_id,i.rules FROM patients p JOIN insurers i ON i.id=p.insurer_id AND i.tenant_id=p.tenant_id WHERE p.tenant_id=$1 AND p.id=$2',
      [ctx.tenantId, a.patient_id],
    );
    ensureAllowed(
      { ...a, timezone: await unitTimezone(ctx.tenantId, a.unit_id, c) },
      d.action,
      p.rules,
    );
    if (
      ['return', 'cancel'].includes(d.action) &&
      (
        await c.query('SELECT id FROM payout_items WHERE tenant_id=$1 AND appointment_id=$2', [
          ctx.tenantId,
          id,
        ])
      ).rowCount
    )
      throw new ApiError(
        409,
        'Sessão já vinculada a repasse. Encaminhe a divergência à gestão financeira para revisão.',
      );
    if (
      ['authorize', 'sign', 'absent', 'cancel', 'return'].includes(d.action) &&
      d.reason.length < 10
    )
      throw new ApiError(
        422,
        'Descreva a justificativa ou evidência com pelo menos 10 caracteres.',
      );
    if (
      ['approve', 'return'].includes(d.action) &&
      (
        await c.query('SELECT id FROM billing_items WHERE tenant_id=$1 AND appointment_id=$2', [
          ctx.tenantId,
          id,
        ])
      ).rowCount
    )
      throw new ApiError(
        409,
        'Sessão já em lote. Registre a divergência no retorno ou por contestação.',
      );
    if (
      d.action === 'arrive' &&
      localDate(a.starts_at, await unitTimezone(ctx.tenantId, a.unit_id, c)) >
        localDate(new Date(), await unitTimezone(ctx.tenantId, a.unit_id, c))
    )
      throw new ApiError(422, 'A chegada só pode ser registrada no dia da sessão ou depois.');
    if (d.action === 'absent' && new Date(a.starts_at) > new Date())
      throw new ApiError(
        422,
        'A sessão ainda não ocorreu. Use cancelamento para alterações futuras.',
      );
    if (['authorize', 'sign'].includes(d.action) && ['CANCELLED', 'ABSENT'].includes(a.status))
      throw new ApiError(422, 'Sessão cancelada ou ausente.');
    let sql = '',
      values: unknown[] = [ctx.tenantId, id];
    if (d.action === 'arrive') {
      sql = "status='ARRIVED',arrived_at=now(),arrival_by=$3";
      values.push(ctx.userId);
    }
    if (d.action === 'authorize') {
      const expected = requiredTokens(
        p.rules,
        (new Date(a.ends_at).getTime() - new Date(a.starts_at).getTime()) / 60000,
      );
      if (
        expected &&
        (p.rules.tokens_per_30 || p.rules.tokens_per_session) &&
        d.tokens?.length !== expected
      )
        throw new ApiError(422, 'Informe a quantidade correta de tokens: ' + expected);
      if (d.tokens && new Set(d.tokens).size !== d.tokens.length)
        throw new ApiError(422, 'Não repita tokens.');
      sql =
        "authorization_status='MANUAL',authorization_evidence=$3,token_count=$4,token_references=$5,authorization_expires=$6";
      values.push(
        d.reason,
        d.tokens?.length || 0,
        JSON.stringify(d.tokens || []),
        d.authorization_expires || null,
      );
    }
    if (d.action === 'sign') {
      sql = 'signature_evidence=$3';
      values.push(d.reason);
    }
    if (d.action === 'start') {
      await scopeRow(c, ctx, 'professionals', a.professional_id, true);
      const { early_start_minutes } = await unitRules(ctx.tenantId, a.unit_id, c);
      if (new Date(a.starts_at).getTime() > Date.now() + early_start_minutes * 60000)
        throw new ApiError(
          422,
          `A sessão só pode ser iniciada a partir de ${early_start_minutes} min antes do horário.`,
        );
      const prof = await scopeRow(c, ctx, 'professionals', a.professional_id);
      const { rowCount } = await c.query(
        "SELECT id FROM appointments WHERE tenant_id=$1 AND professional_id=$2 AND status='IN_PROGRESS' AND id<>$3 AND NOT($4::boolean AND starts_at=$5 AND ends_at=$6 AND room_id=$7)",
        [
          ctx.tenantId,
          a.professional_id,
          id,
          await isSharedSpecialty(ctx.tenantId, prof.specialty, c),
          a.starts_at,
          a.ends_at,
          a.room_id,
        ],
      );
      if (rowCount)
        throw new ApiError(422, 'Finalize a evolução anterior antes de iniciar outra sessão.');
      sql = "status='IN_PROGRESS',started_at=now()";
    }
    if (d.action === 'complete') {
      if (d.content.length < 40)
        throw new ApiError(
          422,
          'Descreva atividade, apoio e resultado em pelo menos 40 caracteres.',
        );
      sql = "status='COMPLETED',evolution=$3,assistant_names=$4";
      values.push(d.content, d.assistant_names);
      await c.query(
        "INSERT INTO clinical_entries(tenant_id,patient_id,professional_id,kind,content,created_by) VALUES($1,$2,$3,'EVOLUTION',$4,$5)",
        [ctx.tenantId, a.patient_id, a.professional_id, d.content, ctx.userId],
      );
    }
    if (['absent', 'cancel'].includes(d.action)) {
      sql = 'status=$3,reason=$4,absence_kind=$5';
      values.push(d.action === 'absent' ? 'ABSENT' : 'CANCELLED', d.reason, d.absence_kind);
    }
    if (['approve', 'return'].includes(d.action)) {
      sql = 'audit_status=$3,reason=$4';
      values.push(d.action === 'approve' ? 'APPROVED' : 'RETURNED', d.reason || null);
    }
    const {
      rows: [row],
    } = await c.query(
      `UPDATE appointments SET ${sql},version=version+1 WHERE tenant_id=$1 AND id=$2 RETURNING *`,
      values,
    );
    await appointmentHooks(c, ctx, row, d.action);
    await audit(c, ctx, 'appointment.' + d.action, 'appointments', id, a.unit_id, {
      from: a.status,
      to: row.status,
      evidenceRecorded: !!d.reason,
    });
    return row;
  });
}
export async function command(
  ctx: Context,
  resource: string,
  id: string,
  action: string,
  input: unknown,
) {
  s.uuid.parse(id);
  if (resource === 'conversations' && action === 'transfer')
    return transferConversation(ctx, id, input);
  if (resource === 'professionals' && action === 'payout-review')
    return reviewPayout(ctx, id, input);
  if (resource === 'professionals' && action === 'payout') {
    permit(ctx, financeRoles);
    const d = z
      .object({
        unit_id: s.uuid,
        period_from: z.iso.date().optional(),
        period_to: z.iso.date().optional(),
      })
      .strict()
      .parse(input);
    assertUnit(ctx, d.unit_id);
    return transaction(async (c) => {
      const p = await scopeRow(c, ctx, 'professionals', id, true);
      const rules = await tenantRules(ctx.tenantId, c);
      if (p.contract !== 'PJ' || !p.active || p.unit_id !== d.unit_id)
        throw new ApiError(422, 'Profissional PJ e unidade válidos são obrigatórios.');
      const { rows: sessions } = await c.query(
        `SELECT a.*,CASE WHEN extract(epoch FROM(a.ends_at-a.starts_at))=$7::int*60 THEN $6::numeric ELSE extract(epoch FROM(a.ends_at-a.starts_at))/3600*$3::numeric END AS payout_amount FROM appointments a WHERE a.tenant_id=$1 AND a.professional_id=$2 AND a.status='COMPLETED' AND a.audit_status='APPROVED' AND a.financial_hold=false AND a.arrived_at IS NOT NULL AND a.evolution IS NOT NULL AND ($4::date IS NULL OR (a.starts_at AT TIME ZONE unit_tz(a.tenant_id,a.unit_id))::date BETWEEN $4 AND $5) AND NOT EXISTS(SELECT 1 FROM payout_items pi WHERE pi.tenant_id=a.tenant_id AND pi.appointment_id=a.id) ORDER BY a.id FOR UPDATE`,
        [
          ctx.tenantId,
          id,
          p.hourly_rate,
          d.period_from || null,
          d.period_to || null,
          Number(p.metadata.session_rate_30) ||
            (Number(p.hourly_rate) * rules.half_session_minutes) / 60,
          rules.half_session_minutes,
        ],
      );
      if (!sessions.length || Number(p.hourly_rate) <= 0)
        throw new ApiError(422, 'Não há sessões elegíveis ou valor por hora configurado.');
      const approved = await requireApprovedPayout(c, ctx, id, p.unit_id, {
        from: d.period_from,
        to: d.period_to,
      });
      const amount =
        Math.round(
          (sessions.reduce((sum, a) => sum + Number(a.payout_amount), 0) +
            Number(approved.adjustment_amount)) *
            100,
        ) / 100;
      const {
        rows: [ledger],
      } = await c.query(
        "INSERT INTO ledger(tenant_id,unit_id,description,kind,amount,due_date,category,counterparty,counterparty_ref) VALUES($1,$2,$3,'EXPENSE',$4,coalesce((date_trunc('month',$6::date)+interval '1 month')::date+($8::int-1),CURRENT_DATE),'Repasse PJ',$5,$7) RETURNING *",
        [
          ctx.tenantId,
          p.unit_id,
          'Repasse PJ · ' + p.name + ' · ' + sessions.length + ' sessões',
          amount,
          p.name,
          d.period_to || null,
          'professional:' + p.id,
          rules.payout_due_day,
        ],
      );
      if (approved.adjustments.length)
        await c.query(
          'UPDATE payout_adjustments SET ledger_id=$3 WHERE tenant_id=$1 AND id=ANY($2::uuid[]) AND ledger_id IS NULL',
          [ctx.tenantId, approved.adjustments.map((a: any) => a.id), ledger.id],
        );
      for (const a of sessions)
        await c.query(
          'INSERT INTO payout_items(tenant_id,ledger_id,appointment_id,amount) VALUES($1,$2,$3,$4)',
          [ctx.tenantId, ledger.id, a.id, Math.round(Number(a.payout_amount) * 100) / 100],
        );
      await audit(c, ctx, 'payout.created', 'ledger', ledger.id, p.unit_id, {
        professionalId: id,
        sessions: sessions.length,
      });
      return ledger;
    });
  }
  if (resource === 'appointments' && action === 'events') return appointmentEvent(ctx, id, input);
  if (resource === 'ledger' && ['settle', 'reverse'].includes(action)) {
    permit(ctx, financeRoles);
    const d = action === 'settle' ? s.paymentSchema.parse(input) : s.reverseSchema.parse(input);
    return transaction(async (c) => {
      const f = await scopeRow(c, ctx, 'ledger', id, true);
      version(f, d.version);
      if (action === 'settle') {
        if (f.status !== 'OPEN') throw new ApiError(409, 'Registro já baixado.');
        const held = await c.query(
          'SELECT a.id FROM payout_items pi JOIN appointments a ON a.id=pi.appointment_id AND a.tenant_id=pi.tenant_id WHERE pi.tenant_id=$1 AND pi.ledger_id=$2 AND a.financial_hold=true LIMIT 1',
          [ctx.tenantId, f.id],
        );
        if (held.rowCount)
          throw new ApiError(409, 'Pagamento bloqueado: há sessão contestada no repasse.');
        const p = d as z.infer<typeof s.paymentSchema>;
        if (p.counterparty_ref)
          p.counterparty = await resolveCounterparty(ctx, p.counterparty_ref, f.unit_id);
        if (p.document_id) {
          const doc = await scopeRow(c, ctx, 'documents', p.document_id);
          if (doc.patient_id)
            throw new ApiError(422, 'Use um comprovante financeiro, não documento clínico.');
        }
        await c.query(
          "INSERT INTO payment_events(tenant_id,ledger_id,kind,paid_date,method,counterparty,reference,notes,document_id,created_by,counterparty_ref) VALUES($1,$2,'SETTLEMENT',$3,$4,$5,$6,$7,$8,$9,$10)",
          [
            ctx.tenantId,
            id,
            p.paid_date,
            p.method,
            p.counterparty,
            p.reference,
            p.notes,
            p.document_id || null,
            ctx.userId,
            p.counterparty_ref || null,
          ],
        );
      } else {
        if (f.status !== 'SETTLED') throw new ApiError(409, 'Lançamento já está aberto.');
        await c.query(
          "INSERT INTO payment_events(tenant_id,ledger_id,kind,notes,created_by) VALUES($1,$2,'REVERSAL',$3,$4)",
          [ctx.tenantId, id, (d as z.infer<typeof s.reverseSchema>).reason, ctx.userId],
        );
      }
      const {
        rows: [row],
      } = await c.query(
        'UPDATE ledger SET status=$3,version=version+1 WHERE tenant_id=$1 AND id=$2 RETURNING *',
        [ctx.tenantId, id, action === 'settle' ? 'SETTLED' : 'OPEN'],
      );
      await audit(c, ctx, 'ledger.' + action, 'ledger', id, f.unit_id);
      return row;
    });
  }
  if (resource === 'inventory' && action === 'move') {
    permit(ctx, financeRoles);
    const d = z
      .object({
        version: z.number().int().positive(),
        delta: z
          .number()
          .int()
          .min(-100000)
          .max(100000)
          .refine((v) => v !== 0),
        reason: z.string().trim().min(10).max(1000),
      })
      .strict()
      .parse(input);
    return transaction(async (c) => {
      const row = await scopeRow(c, ctx, 'inventory', id, true);
      if (row.active === false) throw new ApiError(422, 'Item arquivado não recebe movimentação.');
      version(row, d.version);
      if (row.quantity + d.delta < 0) throw new ApiError(422, 'Estoque insuficiente.');
      await c.query(
        'INSERT INTO inventory_movements(tenant_id,item_id,delta,reason,created_by) VALUES($1,$2,$3,$4,$5)',
        [ctx.tenantId, id, d.delta, d.reason, ctx.userId],
      );
      const {
        rows: [updated],
      } = await c.query(
        'UPDATE inventory SET quantity=quantity+$3,version=version+1 WHERE tenant_id=$1 AND id=$2 RETURNING *',
        [ctx.tenantId, id, d.delta],
      );
      await audit(c, ctx, 'inventory.moved', 'inventory', id, row.unit_id, { delta: d.delta });
      return updated;
    });
  }
  if (resource === 'conversations' && action === 'messages') {
    permit(ctx, receptionRoles);
    const d = z
      .object({ content: z.string().trim().min(1).max(10000) })
      .strict()
      .parse(input);
    return transaction(async (c) => {
      const conv = await scopeRow(c, ctx, 'conversations', id);
      if (conv.deleted_at || conv.status === 'DONE')
        throw new ApiError(422, 'Reabra o atendimento antes de responder.');
      const {
        rows: [msg],
      } = await c.query(
        "INSERT INTO messages(tenant_id,conversation_id,direction,content,created_by) VALUES($1,$2,'OUTBOUND',$3,$4) RETURNING *",
        [ctx.tenantId, id, d.content, ctx.userId],
      );
      await audit(c, ctx, 'message.local_created', 'conversations', id, conv.unit_id);
      return msg;
    });
  }

  throw new ApiError(404, 'Ação não encontrada.');
}
