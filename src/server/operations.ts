import { unitTimezone } from './clinic-rules';
import { formatDateTime, localDate } from '@/lib/timezone';
import { clinicRulesSchema, weekHoursSchema } from '@/lib/clinic-rules';
import { timezoneIds } from '@/lib/timezone';
import { contactTemplate } from './contact-templates';
import {
  renderTemplate,
  settingsValue,
  mergeTemplates,
  unknownVariables,
} from './message-templates';
import { assertSpecialties } from './specialties';
import { specialtyCode } from '@/lib/schemas';
import { createProposal, decideProposal, conversationControl } from './conversation-workflow';
import { createAppointmentsWithClient } from './service';
import { appointmentSchema } from '@/lib/schemas';
import { prepareDueContacts } from './automations';
import { rescheduleAppointment, registerAbsence, transferProfessional } from './scheduling';
import { z } from 'zod';
import { query, transaction } from '@/lib/db';
import { ApiError } from '@/lib/errors';
import { assertUnit, permit, type Context } from '@/lib/security';
import {
  audit,
  scopeRow,
  version,
  receptionRoles,
  auditRoles,
  managers,
  clinicalAccess,
} from './repository';
import { operationalSessions, defaultSettings } from './operations-read';
import { requiredTokens } from './session-evidence';
const reason = z.string().trim().min(10).max(3000);
const base = z.object({ operation: z.string(), unit_id: z.uuid() });
export async function operation(ctx: Context, input: unknown) {
  const b = base.parse(input);
  assertUnit(ctx, b.unit_id);
  const clean = { ...(input as Record<string, unknown>) };
  delete clean.operation;
  delete clean.unit_id;
  if (b.operation === 'PROPOSAL_CREATE') return createProposal(ctx, b.unit_id, clean);
  if (b.operation === 'PROPOSAL_DECIDE') return decideProposal(ctx, b.unit_id, clean);
  if (b.operation === 'CONVERSATION_CONTROL') return conversationControl(ctx, b.unit_id, clean);
  if (b.operation === 'RESERVE_SEQUENCE') {
    permit(ctx, receptionRoles);
    const d = z
      .object({ appointments: z.array(appointmentSchema).min(1).max(30) })
      .strict()
      .parse(clean);
    if (
      d.appointments.some((a) => a.unit_id !== b.unit_id || a.occurrences !== 1) ||
      new Set(d.appointments.map((a) => a.patient_id)).size !== 1
    )
      throw new ApiError(422, 'A grade deve ser de um paciente e da mesma unidade.');
    return transaction(async (c) => {
      const rows = [];
      for (const appointment of d.appointments)
        rows.push(...(await createAppointmentsWithClient(c, ctx, appointment)));
      return { count: rows.length, ids: rows.map((r) => r.id) };
    });
  }
  if (b.operation === 'PREPARE_AUTOMATIONS') {
    permit(ctx, receptionRoles);
    return prepareDueContacts(ctx, b.unit_id);
  }
  if (b.operation === 'RESCHEDULE') return rescheduleAppointment(ctx, b.unit_id, clean);
  if (b.operation === 'PROF_ABSENCE') return registerAbsence(ctx, b.unit_id, clean);
  if (b.operation === 'PROF_TRANSFER') return transferProfessional(ctx, b.unit_id, clean);
  if (b.operation === 'REQUEST') {
    permit(ctx, [...receptionRoles, 'AUDIT']);
    const d = z
      .object({
        appointment_ids: z.array(z.uuid()).min(1).max(200),
        kind: z.enum(['TOKEN', 'SIGNATURE', 'REMINDER', 'EVOLUTION']),
      })
      .strict()
      .parse(clean);
    const tz = await unitTimezone(ctx.tenantId, b.unit_id);
    return transaction(async (c) => {
      let count = 0;
      for (const id of [...new Set(d.appointment_ids)].sort()) {
        const a = await scopeRow(c, ctx, 'appointments', id, true);
        if (a.unit_id !== b.unit_id || ['CANCELLED', 'ABSENT'].includes(a.status))
          throw new ApiError(422, 'Sessão indisponível para solicitação.');
        const {
          rows: [p],
        } = await c.query('SELECT name,guardian FROM patients WHERE tenant_id=$1 AND id=$2', [
          ctx.tenantId,
          a.patient_id,
        ]);
        const {
          rows: [setting],
        } = await c.query('SELECT value FROM clinic_settings WHERE tenant_id=$1', [ctx.tenantId]);
        const message =
          d.kind === 'TOKEN'
            ? `Olá, ${p.guardian}! Por favor, libere a autorização de ${p.name} para a sessão de ${formatDateTime(a.starts_at, tz)}.`
            : d.kind === 'SIGNATURE'
              ? `Olá, ${p.guardian}! Precisamos conferir a assinatura da guia de ${p.name}.`
              : d.kind === 'EVOLUTION'
                ? `Registrar a evolução pendente da sessão de ${p.name} em ${formatDateTime(a.starts_at, tz)}.`
                : `Olá, ${p.guardian}! Você confirma a sessão de ${p.name} em ${formatDateTime(a.starts_at, tz)}?`;
        const result = await c.query(
          'INSERT INTO operation_requests(tenant_id,unit_id,appointment_id,professional_id,kind,message,created_by) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING',
          [
            ctx.tenantId,
            b.unit_id,
            id,
            a.professional_id,
            d.kind,
            contactTemplate(
              setting?.value,
              d.kind.toLowerCase(),
              p,
              new Date(a.starts_at),
              tz,
              message,
            ),
            ctx.userId,
          ],
        );
        count += result.rowCount || 0;
        if (d.kind === 'TOKEN' || d.kind === 'SIGNATURE')
          await c.query(
            `UPDATE appointments SET ${d.kind === 'TOKEN' ? 'token_requested_at' : 'signature_requested_at'}=now(),version=version+1 WHERE tenant_id=$1 AND id=$2`,
            [ctx.tenantId, id],
          );
      }
      await audit(c, ctx, 'requests.prepared', 'operation_requests', null, b.unit_id, {
        kind: d.kind,
        count,
        transport: 'MANUAL_DRAFT',
      });
      return {
        count,
        message: 'Solicitações preparadas para envio manual. Nenhuma mensagem externa foi enviada.',
      };
    });
  }
  if (b.operation === 'REQUEST_SENT') {
    permit(ctx, receptionRoles);
    const d = z.object({ request_id: z.uuid(), reference: reason }).strict().parse(clean);
    return transaction(async (c) => {
      const {
        rows: [r],
      } = await c.query(
        'SELECT * FROM operation_requests WHERE tenant_id=$1 AND unit_id=$2 AND id=$3 FOR UPDATE',
        [ctx.tenantId, b.unit_id, d.request_id],
      );
      if (!r) throw new ApiError(404, 'Solicitação não encontrada.');
      if (r.status !== 'DRAFT') throw new ApiError(409, 'Solicitação já registrada.');
      await c.query(
        "UPDATE operation_requests SET status='SENT_MANUALLY',sent_at=now(),reference=$3 WHERE tenant_id=$1 AND id=$2",
        [ctx.tenantId, r.id, d.reference],
      );
      await audit(c, ctx, 'request.sent_manually', 'operation_requests', r.id, b.unit_id, {
        reference: d.reference,
      });
      return { ok: true };
    });
  }
  if (b.operation === 'CONTACT_RESPONSE') {
    permit(ctx, receptionRoles);
    const d = z
      .object({ request_id: z.uuid(), response: z.enum(['CONFIRMED', 'DECLINED']), reason })
      .strict()
      .parse(clean);
    return transaction(async (c) => {
      const {
        rows: [r],
      } = await c.query(
        "SELECT * FROM operation_requests WHERE tenant_id=$1 AND unit_id=$2 AND id=$3 AND kind='REMINDER' FOR UPDATE",
        [ctx.tenantId, b.unit_id, d.request_id],
      );
      if (!r || r.status === 'DONE')
        throw new ApiError(409, 'Lembrete indisponível ou já respondido.');
      await c.query(
        "UPDATE operation_requests SET status='DONE',reference=$3 WHERE tenant_id=$1 AND id=$2",
        [ctx.tenantId, r.id, d.response + ': ' + d.reason],
      );
      const {
        rows: [setting],
      } = await c.query('SELECT value FROM clinic_settings WHERE tenant_id=$1', [ctx.tenantId]);
      if (
        d.response === 'DECLINED' &&
        (setting?.value.automations || []).find((a: any) => a.id === 'reschedule')?.enabled !==
          false
      ) {
        await c.query(
          "INSERT INTO operation_requests(tenant_id,unit_id,appointment_id,professional_id,kind,message,created_by) VALUES($1,$2,$3,$4,'WAITLIST',$5,$6) ON CONFLICT DO NOTHING",
          [
            ctx.tenantId,
            b.unit_id,
            r.appointment_id,
            r.professional_id,
            'Família recusou o horário: ' +
              d.reason +
              '. A recepção deve abrir a sessão, consultar alternativas e confirmar a remarcação; o horário original permanece até essa decisão.',
            ctx.userId,
          ],
        );
      }
      await audit(c, ctx, 'contact.response_recorded', 'operation_requests', r.id, b.unit_id, {
        response: d.response,
        reason: d.reason,
      });
      return { ok: true };
    });
  }
  if (b.operation === 'TOKEN_VALIDATE') {
    permit(ctx, receptionRoles);
    const d = z
      .object({
        appointment_id: z.uuid(),
        version: z.number().int(),
        tokens: z.array(z.string().trim().min(3).max(128)).min(1).max(12),
        expires_at: z.iso.date(),
        evidence: reason,
      })
      .strict()
      .parse(clean);
    if (new Set(d.tokens).size !== d.tokens.length)
      throw new ApiError(422, 'Informe tokens distintos.');
    return transaction(async (c) => {
      const a = await scopeRow(c, ctx, 'appointments', d.appointment_id, true);
      version(a, d.version);
      if (a.unit_id !== b.unit_id || ['ABSENT', 'CANCELLED'].includes(a.status))
        throw new ApiError(422, 'Sessão indisponível.');
      const {
        rows: [r],
      } = await c.query(
        'SELECT i.rules FROM patients p JOIN insurers i ON i.id=p.insurer_id AND i.tenant_id=p.tenant_id WHERE p.tenant_id=$1 AND p.id=$2',
        [ctx.tenantId, a.patient_id],
      );
      const count = requiredTokens(
        r.rules,
        (new Date(a.ends_at).getTime() - new Date(a.starts_at).getTime()) / 60000,
      );
      if (!count || d.tokens.length !== count)
        throw new ApiError(422, `Esta sessão exige ${count} token(s).`);
      const date = localDate(a.starts_at, await unitTimezone(ctx.tenantId, a.unit_id, c));
      if (d.expires_at < date)
        throw new ApiError(422, 'O token deve ser válido na data da sessão.');
      await c.query(
        "UPDATE appointments SET token_count=$3,token_references=$4,authorization_expires=$5,authorization_status='MANUAL',authorization_evidence=$6,version=version+1 WHERE tenant_id=$1 AND id=$2",
        [ctx.tenantId, a.id, count, JSON.stringify(d.tokens), d.expires_at, d.evidence],
      );
      await c.query(
        "UPDATE operation_requests SET status='DONE' WHERE tenant_id=$1 AND appointment_id=$2 AND kind='TOKEN' AND status IN('DRAFT','SENT_MANUALLY')",
        [ctx.tenantId, a.id],
      );
      await audit(c, ctx, 'tokens.validated_manually', 'appointments', a.id, b.unit_id, {
        count,
        expiresAt: d.expires_at,
        evidence: d.evidence,
      });
      return { ok: true };
    });
  }
  if (['CONTEST', 'RESOLVE_CONTEST'].includes(b.operation)) {
    permit(ctx, b.operation === 'CONTEST' ? receptionRoles : auditRoles);
    const d = z
      .object({
        appointment_id: z.uuid(),
        version: z.number().int(),
        reason,
        decision: z.enum(['CONFIRM', 'RETURN']).optional(),
      })
      .strict()
      .parse(clean);
    return transaction(async (c) => {
      const a = await scopeRow(c, ctx, 'appointments', d.appointment_id, true);
      version(a, d.version);
      if (a.unit_id !== b.unit_id) throw new ApiError(403, 'Outra unidade.');
      if (b.operation === 'CONTEST') {
        if (a.status !== 'COMPLETED' || (a.contested_at && !a.contest_resolved_at))
          throw new ApiError(422, 'A contestação exige uma sessão realizada ainda não contestada.');
        await c.query(
          'UPDATE appointments SET contested_at=now(),contest_reason=$3,contest_resolved_at=NULL,contest_resolution=NULL,financial_hold=true,version=version+1 WHERE tenant_id=$1 AND id=$2',
          [ctx.tenantId, a.id, d.reason],
        );
      } else {
        if (!a.contested_at || a.contest_resolved_at || !d.decision)
          throw new ApiError(422, 'Contestação indisponível.');
        await c.query(
          "UPDATE appointments SET contest_resolved_at=now(),contest_resolution=$3,financial_hold=$4,audit_status=CASE WHEN $4 THEN 'RETURNED' ELSE audit_status END,version=version+1 WHERE tenant_id=$1 AND id=$2",
          [ctx.tenantId, a.id, d.reason, d.decision === 'RETURN'],
        );
      }
      await audit(
        c,
        ctx,
        b.operation === 'CONTEST' ? 'appointment.contested' : 'appointment.contest_resolved',
        'appointments',
        a.id,
        b.unit_id,
        { reason: d.reason, decision: d.decision || null },
      );
      return { ok: true };
    });
  }
  if (b.operation === 'BATCH_CREATE') {
    permit(ctx, auditRoles);
    const d = z
      .object({ appointment_ids: z.array(z.uuid()).min(1).max(200) })
      .strict()
      .parse(clean);
    return transaction(async (c) => {
      const ids = [...new Set(d.appointment_ids)].sort();
      const locked = await c.query(
        'SELECT id FROM appointments WHERE tenant_id=$1 AND unit_id=$2 AND id=ANY($3::uuid[]) ORDER BY id FOR UPDATE',
        [ctx.tenantId, b.unit_id, ids],
      );
      if (locked.rowCount !== ids.length) throw new ApiError(422, 'Seleção inválida.');
      const sessions = (await operationalSessions(ctx, b.unit_id)).filter((a) =>
        ids.includes(a.id),
      );
      if (
        sessions.length !== ids.length ||
        sessions.some(
          (a) =>
            a.authorization_type === 'PRIVATE' ||
            a.batch_id ||
            a.gaps.length ||
            a.audit_status !== 'APPROVED' ||
            Number(a.amount) <= 0,
        )
      )
        throw new ApiError(
          422,
          'Selecione somente sessões aprovadas, com evidências completas, sem contestação e ainda fora de lote.',
        );
      const groups = Map.groupBy(sessions, (a) => a.insurer_id);
      const batches = [];
      for (const [insurer, items] of groups) {
        const amount = Math.round(items.reduce((s, a) => s + Number(a.amount), 0) * 100) / 100;
        const {
          rows: [batch],
        } = await c.query(
          'INSERT INTO billing_batches(tenant_id,unit_id,insurer_id,amount,created_by) VALUES($1,$2,$3,$4,$5) RETURNING *',
          [ctx.tenantId, b.unit_id, insurer, amount, ctx.userId],
        );
        for (const a of items) {
          const snapshot = {
            patient_name: a.patient_name,
            card_number: a.card_number,
            professional_name: a.professional_name,
            specialty: a.specialty,
            starts_at: a.starts_at,
            ends_at: a.ends_at,
            authorization_status: a.authorization_status,
            signature_recorded: !!a.signature_evidence,
            evolution_recorded: a.evolution_recorded,
            amount: a.amount,
          };
          await c.query(
            'INSERT INTO billing_items(tenant_id,batch_id,appointment_id,amount,snapshot) VALUES($1,$2,$3,$4,$5)',
            [ctx.tenantId, batch.id, a.id, a.amount, JSON.stringify(snapshot)],
          );
        }
        batches.push(batch);
        await audit(c, ctx, 'billing.batch_created', 'billing_batches', batch.id, b.unit_id, {
          number: batch.number,
          count: items.length,
          amount,
          xmlValidated: false,
        });
      }
      return { batches };
    });
  }
  if (b.operation === 'BATCH_SENT') {
    permit(ctx, auditRoles);
    const d = z
      .object({ batch_id: z.uuid(), protocol: z.string().trim().min(3).max(200) })
      .strict()
      .parse(clean);
    return transaction(async (c) => {
      const {
        rows: [batch],
      } = await c.query(
        'SELECT * FROM billing_batches WHERE tenant_id=$1 AND unit_id=$2 AND id=$3 FOR UPDATE',
        [ctx.tenantId, b.unit_id, d.batch_id],
      );
      if (!batch) throw new ApiError(404, 'Lote não encontrado.');
      if (batch.status !== 'PREPARED') throw new ApiError(409, 'Envio já registrado.');
      await c.query(
        "UPDATE billing_batches SET status='SENT',sent_at=now(),sent_by=$3,protocol=$4 WHERE tenant_id=$1 AND id=$2",
        [ctx.tenantId, batch.id, ctx.userId, d.protocol],
      );
      await audit(c, ctx, 'billing.sent_manually', 'billing_batches', batch.id, b.unit_id, {
        protocol: d.protocol,
      });
      return { ok: true };
    });
  }
  if (b.operation === 'RETURN_IMPORT') {
    permit(ctx, [...auditRoles, 'FINANCE']);
    const d = z
      .object({
        batch_id: z.uuid(),
        reference: z.string().trim().min(3).max(200),
        received_at: z.iso.date(),
        items: z
          .array(
            z.object({
              item_id: z.uuid(),
              paid_amount: z.number().min(0).max(1000000),
              reason: z.string().trim().max(1000).default(''),
            }),
          )
          .min(1)
          .max(200),
      })
      .strict()
      .parse(clean);
    if (new Set(d.items.map((i) => i.item_id)).size !== d.items.length)
      throw new ApiError(422, 'Guia duplicada no demonstrativo.');
    return transaction(async (c) => {
      const {
        rows: [batch],
      } = await c.query(
        'SELECT * FROM billing_batches WHERE tenant_id=$1 AND unit_id=$2 AND id=$3 FOR UPDATE',
        [ctx.tenantId, b.unit_id, d.batch_id],
      );
      if (!batch || batch.status === 'PREPARED')
        throw new ApiError(422, 'Registre o envio do lote antes do retorno.');
      const { rows: items } = await c.query(
        'SELECT * FROM billing_items WHERE tenant_id=$1 AND batch_id=$2 FOR UPDATE',
        [ctx.tenantId, batch.id],
      );
      for (const r of d.items) {
        const item = items.find((i) => i.id === r.item_id);
        if (!item || item.status !== 'WAITING')
          throw new ApiError(422, 'Guia de outro lote ou retorno já registrado.');
        if (Math.abs(r.paid_amount - Number(item.amount)) > 0.005 && r.reason.length < 5)
          throw new ApiError(422, 'Justifique a glosa ou diferença de valor.');
        if (Math.abs(r.paid_amount * 100 - Math.round(r.paid_amount * 100)) > 0.00001)
          throw new ApiError(422, 'Use duas casas decimais.');
      }
      await c.query(
        'INSERT INTO billing_returns(tenant_id,batch_id,reference,received_at,created_by) VALUES($1,$2,$3,$4,$5)',
        [ctx.tenantId, batch.id, d.reference, d.received_at, ctx.userId],
      );
      for (const r of d.items) {
        const item = items.find((i) => i.id === r.item_id);
        const status =
          r.paid_amount === 0
            ? 'DENIED'
            : Math.abs(r.paid_amount - Number(item.amount)) < 0.005
              ? 'PAID'
              : 'PARTIAL';
        await c.query(
          'UPDATE billing_items SET status=$3,paid_amount=$4,denial_reason=$5,return_reference=$6,returned_at=now() WHERE tenant_id=$1 AND id=$2',
          [ctx.tenantId, r.item_id, status, r.paid_amount, r.reason || null, d.reference],
        );
      }
      await c.query(
        "UPDATE billing_batches SET status=CASE WHEN EXISTS(SELECT 1 FROM billing_items WHERE tenant_id=$1 AND batch_id=$2 AND status='WAITING') THEN 'SENT' ELSE 'RETURNED' END WHERE tenant_id=$1 AND id=$2",
        [ctx.tenantId, batch.id],
      );
      await audit(c, ctx, 'billing.return_registered', 'billing_batches', batch.id, b.unit_id, {
        reference: d.reference,
        items: d.items.length,
        source: 'MANUAL_DEMONSTRATIVE',
      });
      return { ok: true };
    });
  }
  if (b.operation === 'WAITLIST_ADD') {
    permit(ctx, receptionRoles);
    const d = z
      .object({
        patient_id: z.uuid(),
        specialty: specialtyCode,
        preferred_days: z.array(z.number().int().min(1).max(6)).default([]),
        preferred_period: z.enum(['ANY', 'MORNING', 'AFTERNOON']).default('ANY'),
        priority: z.enum(['NORMAL', 'HIGH']).default('NORMAL'),
        notes: z.string().max(1000).default(''),
      })
      .strict()
      .parse(clean);
    await assertSpecialties(ctx.tenantId, [d.specialty]);
    return transaction(async (c) => {
      const p = await scopeRow(c, ctx, 'patients', d.patient_id);
      if (p.unit_id !== b.unit_id) throw new ApiError(422, 'Paciente de outra unidade.');
      const {
        rows: [row],
      } = await c.query(
        'INSERT INTO waitlist(tenant_id,unit_id,patient_id,specialty,preferred_days,preferred_period,priority,notes,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *',
        [
          ctx.tenantId,
          b.unit_id,
          p.id,
          d.specialty,
          d.preferred_days,
          d.preferred_period,
          d.priority,
          d.notes,
          ctx.userId,
        ],
      );
      await audit(c, ctx, 'waitlist.created', 'waitlist', row.id, b.unit_id);
      return row;
    });
  }
  if (['WAITLIST_OFFER', 'WAITLIST_CANCEL'].includes(b.operation)) {
    permit(ctx, receptionRoles);
    const d = z.object({ waitlist_id: z.uuid(), reason }).strict().parse(clean);
    return transaction(async (c) => {
      const {
        rows: [w],
      } = await c.query(
        'SELECT w.*,p.guardian,p.name AS patient_name FROM waitlist w JOIN patients p ON p.id=w.patient_id AND p.tenant_id=w.tenant_id WHERE w.tenant_id=$1 AND w.unit_id=$2 AND w.id=$3 FOR UPDATE OF w',
        [ctx.tenantId, b.unit_id, d.waitlist_id],
      );
      if (!w || !['WAITING', 'OFFERED'].includes(w.status))
        throw new ApiError(422, 'Entrada indisponível.');
      if (b.operation === 'WAITLIST_OFFER')
        await c.query(
          "INSERT INTO operation_requests(tenant_id,unit_id,kind,message,created_by) VALUES($1,$2,'WAITLIST',$3,$4)",
          [
            ctx.tenantId,
            b.unit_id,
            renderTemplate(await settingsValue(c, ctx.tenantId), 'waitlist_offer', {
              responsavel: w.guardian,
              paciente: w.patient_name,
              detalhes: d.reason,
            }),
            ctx.userId,
          ],
        );
      await c.query('UPDATE waitlist SET status=$3,notes=$4 WHERE tenant_id=$1 AND id=$2', [
        ctx.tenantId,
        w.id,
        b.operation === 'WAITLIST_OFFER' ? 'OFFERED' : 'CANCELLED',
        d.reason,
      ]);
      await audit(
        c,
        ctx,
        b.operation === 'WAITLIST_OFFER' ? 'waitlist.offer_prepared' : 'waitlist.cancelled',
        'waitlist',
        w.id,
        b.unit_id,
        { reason: d.reason, transport: 'MANUAL' },
      );
      return { ok: true };
    });
  }
  if (b.operation === 'SETTINGS_SAVE') {
    permit(ctx, managers);
    const d = z
      .object({
        version: z.number().int().positive(),
        value: z.object({
          automations: z
            .array(
              z.object({
                id: z.string().max(50),
                name: z.string().min(2).max(200),
                enabled: z.boolean(),
                minutes_before: z.number().int().min(0).max(10080),
              }),
            )
            .max(20),
          templates: z
            .array(
              z.object({
                id: z.string().regex(/^[a-z0-9_]{2,50}$/),
                name: z.string().trim().min(2).max(200),
                content: z.string().trim().min(5).max(3000),
                variables: z.array(z.string()).optional(),
                system: z.boolean().optional(),
              }),
            )
            .max(40),
          channels: z
            .array(
              z.object({
                id: z.string().max(50),
                name: z.string().min(2).max(200),
                description: z.string().max(1000),
              }),
            )
            .max(20),
          // Horários e regras operacionais (ver src/lib/clinic-rules.ts).
          rules: clinicRulesSchema.optional(),
        }),
      })
      .strict()
      .parse(clean);
    return transaction(async (c) => {
      await c.query(
        'INSERT INTO clinic_settings(tenant_id,value) VALUES($1,$2) ON CONFLICT DO NOTHING',
        [ctx.tenantId, JSON.stringify(defaultSettings)],
      );
      const {
        rows: [s],
      } = await c.query('SELECT * FROM clinic_settings WHERE tenant_id=$1 FOR UPDATE', [
        ctx.tenantId,
      ]);
      version(s, d.version);
      // Modelos de sistema não somem; variáveis desconhecidas são recusadas antes de salvar.
      const templates = mergeTemplates(d.value.templates).filter(
        (t) => t.system || d.value.templates.some((x) => x.id === t.id),
      );
      for (const t of templates) {
        const bad = unknownVariables(t.content, t.variables);
        if (bad.length)
          throw new ApiError(
            422,
            `O modelo "${t.name}" usa variável inexistente: ${bad.map((v) => '{' + v + '}').join(', ')}. Disponíveis: ${t.variables.map((v) => '{' + v + '}').join(', ')}.`,
          );
      }
      d.value.templates = templates.map((t) => ({ id: t.id, name: t.name, content: t.content }));
      await c.query(
        'UPDATE clinic_settings SET value=$2,version=version+1,updated_by=$3,updated_at=now() WHERE tenant_id=$1',
        [ctx.tenantId, JSON.stringify(d.value), ctx.userId],
      );
      await audit(c, ctx, 'settings.updated', 'clinic_settings', null, b.unit_id, {
        version: d.version + 1,
        transport: 'NOT_CONNECTED',
      });
      return { ok: true };
    });
  }
  if (b.operation === 'UNIT_HOURS_SAVE') {
    // Horário de funcionamento e fuso próprios da unidade; null volta a usar os da clínica.
    permit(ctx, managers);
    const d = z
      .object({
        business_hours: weekHoursSchema.nullable(),
        timezone: z.enum(timezoneIds).nullable().optional(),
      })
      .strict()
      .parse(clean);
    return transaction(async (c) => {
      const {
        rows: [before],
      } = await c.query(
        'SELECT business_hours,timezone FROM units WHERE tenant_id=$1 AND id=$2 FOR UPDATE',
        [ctx.tenantId, b.unit_id],
      );
      if (!before) throw new ApiError(404, 'Unidade não encontrada.');
      // Sem "timezone" no pedido, o fuso da unidade fica como está.
      const timezone = d.timezone === undefined ? before.timezone : d.timezone;
      await c.query(
        'UPDATE units SET business_hours=$3,timezone=$4,updated_at=now() WHERE tenant_id=$1 AND id=$2',
        [
          ctx.tenantId,
          b.unit_id,
          d.business_hours ? JSON.stringify(d.business_hours) : null,
          timezone,
        ],
      );
      await audit(c, ctx, 'unit.hours_updated', 'units', b.unit_id, b.unit_id, {
        before: { business_hours: before.business_hours, timezone: before.timezone },
        after: { business_hours: d.business_hours, timezone },
      });
      return { ok: true };
    });
  }
  if (b.operation === 'PROF_CERTIFY') {
    permit(ctx, managers);
    const d = z
      .object({
        professional_id: z.uuid(),
        code: z.string().max(100),
        level: z.enum(['PRACTICE', 'TRAINED', 'CERTIFIED']),
        document_id: z.string().default(''),
        reason,
      })
      .strict()
      .parse(clean);
    return transaction(async (c) => {
      const p = await scopeRow(c, ctx, 'professionals', d.professional_id, true);
      if (p.unit_id !== b.unit_id || !p.competencies.includes(d.code))
        throw new ApiError(422, 'Competência fora do cadastro.');
      if (d.document_id) {
        const doc = await scopeRow(c, ctx, 'documents', z.uuid().parse(d.document_id));
        if (doc.professional_id !== p.id || doc.document_kind !== 'CERTIFICATE')
          throw new ApiError(422, 'Certificado de outro profissional.');
      }
      const list = (p.metadata.certifications || []).filter((v: any) => v.code !== d.code);
      list.push({
        code: d.code,
        level: d.level,
        verified: true,
        ...(d.document_id ? { document_id: d.document_id } : {}),
      });
      await c.query(
        "UPDATE professionals SET metadata=jsonb_set(metadata,'{certifications}',$3::jsonb),version=version+1 WHERE tenant_id=$1 AND id=$2",
        [ctx.tenantId, p.id, JSON.stringify(list)],
      );
      await audit(c, ctx, 'professional.competency_verified', 'professionals', p.id, b.unit_id, {
        code: d.code,
        level: d.level,
        reason: d.reason,
        documentId: d.document_id || null,
      });
      return { ok: true };
    });
  }
  if (b.operation === 'PJ_DOCUMENTS') {
    permit(ctx, managers);
    const d = z
      .object({ professional_id: z.uuid(), confirmed: z.boolean(), reason })
      .strict()
      .parse(clean);
    return transaction(async (c) => {
      const p = await scopeRow(c, ctx, 'professionals', d.professional_id, true);
      if (p.unit_id !== b.unit_id || p.contract !== 'PJ')
        throw new ApiError(422, 'Profissional PJ inválido.');
      await c.query(
        'UPDATE professionals SET metadata=metadata||$3::jsonb,version=version+1 WHERE tenant_id=$1 AND id=$2',
        [
          ctx.tenantId,
          p.id,
          JSON.stringify({ pj_documents_confirmed: d.confirmed, pj_documents_evidence: d.reason }),
        ],
      );
      await audit(c, ctx, 'professional.pj_documents', 'professionals', p.id, b.unit_id, {
        confirmed: d.confirmed,
        reason: d.reason,
        source: 'MANUAL',
      });
      return { ok: true };
    });
  }
  if (b.operation === 'ASSESSMENT_START' || b.operation === 'ASSESSMENT_PROGRESS') {
    const d = z
      .object({
        patient_id: z.uuid(),
        specialty: z.string().max(20).optional(),
        target_sessions: z.number().int().min(1).max(100).optional(),
        assessment_id: z.uuid().optional(),
        completed_sessions: z.number().int().min(0).max(100).optional(),
        notes: z.string().max(3000).default(''),
      })
      .strict()
      .parse(clean);
    await clinicalAccess(ctx, d.patient_id);
    return transaction(async (c) => {
      const p = await scopeRow(c, ctx, 'patients', d.patient_id);
      if (p.unit_id !== b.unit_id) throw new ApiError(422, 'Paciente de outra unidade.');
      if (b.operation === 'ASSESSMENT_START') {
        if (!d.specialty || !d.target_sessions)
          throw new ApiError(422, 'Informe a área e a quantidade de sessões.');
        const {
          rows: [r],
        } = await c.query(
          'INSERT INTO patient_assessments(tenant_id,patient_id,specialty,target_sessions,notes,created_by) VALUES($1,$2,$3,$4,$5,$6) RETURNING *',
          [ctx.tenantId, p.id, d.specialty, d.target_sessions, d.notes, ctx.userId],
        );
        await audit(c, ctx, 'assessment.started', 'patient_assessments', r.id, b.unit_id);
        return r;
      }
      const {
        rows: [r],
      } = await c.query(
        'SELECT * FROM patient_assessments WHERE tenant_id=$1 AND patient_id=$2 AND id=$3 FOR UPDATE',
        [ctx.tenantId, p.id, d.assessment_id],
      );
      if (!r || d.completed_sessions === undefined || d.completed_sessions > r.target_sessions)
        throw new ApiError(422, 'Progresso inválido.');
      await c.query(
        "UPDATE patient_assessments SET completed_sessions=$3,status=CASE WHEN $3=target_sessions THEN 'COMPLETED' ELSE 'IN_PROGRESS' END,notes=$4 WHERE tenant_id=$1 AND id=$2",
        [ctx.tenantId, r.id, d.completed_sessions, d.notes],
      );
      await audit(c, ctx, 'assessment.progress', 'patient_assessments', r.id, b.unit_id, {
        completed: d.completed_sessions,
      });
      return { ok: true };
    });
  }
  throw new ApiError(404, 'Operação não encontrada.');
}
