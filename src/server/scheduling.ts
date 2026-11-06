import { z } from 'zod';
import { isSharedSpecialty } from './specialties';
import type { PoolClient } from 'pg';
import { transaction } from '@/lib/db';
import { ApiError } from '@/lib/errors';
import { permit, type Context } from '@/lib/security';
import { unitRules, unitTimezone } from './clinic-rules';
import { localDate, localMinutes, localWeekday } from '@/lib/timezone';
import { fitsDay, outsideHoursMessage } from '@/lib/clinic-rules';
import { audit, scopeRow, version, receptionRoles, managers } from './repository';
export async function checkExtraConstraints(
  c: PoolClient,
  ctx: Context,
  prof: any,
  pat: any,
  start: Date,
  end: Date,
  ignore?: string,
) {
  // Dia da semana e semana do pedido médico contados no fuso da unidade do profissional.
  const tz = await unitTimezone(ctx.tenantId, prof.unit_id, c);
  const day = localWeekday(start, tz);
  if (prof.metadata.work_days?.length && !prof.metadata.work_days.includes(day))
    throw new ApiError(422, 'O profissional não atende neste dia da semana.');
  const age = (start.getTime() - new Date(pat.birth_date).getTime()) / (365.25 * 86400000);
  if (age < Number(prof.metadata.min_age || 0) || age >= Number(prof.metadata.max_age ?? 120) + 1)
    throw new ApiError(422, 'Idade fora da faixa atendida pelo profissional.');
  const { rowCount } = await c.query(
    'SELECT id FROM professional_absences WHERE tenant_id=$1 AND professional_id=$2 AND status=\x27ACTIVE\x27 AND starts_at<$4 AND ends_at>$3',
    [ctx.tenantId, prof.id, start, end],
  );
  if (rowCount) throw new ApiError(409, 'Profissional ausente neste horário.');
  const weekly = Number(pat.metadata.weekly_limits?.[prof.specialty] || 0);
  if (weekly) {
    const {
      rows: [r],
    } = await c.query(
      `SELECT count(*)::int AS count FROM appointments a JOIN professionals p ON p.id=a.professional_id AND p.tenant_id=a.tenant_id WHERE a.tenant_id=$1 AND a.patient_id=$2 AND p.specialty=$3 AND a.status NOT IN('CANCELLED','ABSENT') AND date_trunc('week',a.starts_at AT TIME ZONE $6)=date_trunc('week',$4::timestamptz AT TIME ZONE $6) AND ($5::uuid IS NULL OR a.id<>$5)`,
      [ctx.tenantId, pat.id, prof.specialty, start, ignore || null, tz],
    );
    if (r.count >= weekly) throw new ApiError(422, 'Quantidade semanal do pedido médico excedida.');
  }
  if (pat.metadata.authorized_total) {
    const {
      rows: [r],
    } = await c.query(
      "SELECT count(*)::int AS count FROM appointments WHERE tenant_id=$1 AND patient_id=$2 AND status NOT IN('CANCELLED','ABSENT') AND ($3::uuid IS NULL OR id<>$3)",
      [ctx.tenantId, pat.id, ignore || null],
    );
    if (r.count >= pat.metadata.authorized_total)
      throw new ApiError(422, 'Quantidade total autorizada esgotada.');
  }
}
export async function appointmentHooks(c: PoolClient, ctx: Context, a: any, action: string) {
  if (action === 'absent' && a.absence_kind === 'PATIENT') {
    const { rows: recent } = await c.query(
      "SELECT status,absence_kind FROM appointments WHERE tenant_id=$1 AND patient_id=$2 AND starts_at<=$3 AND status<>'CANCELLED' ORDER BY starts_at DESC LIMIT 2",
      [ctx.tenantId, a.patient_id, a.starts_at],
    );
    const {
      rows: [setting],
    } = await c.query('SELECT value FROM clinic_settings WHERE tenant_id=$1', [ctx.tenantId]);
    if (
      recent.length === 2 &&
      recent.every((r) => r.status === 'ABSENT' && r.absence_kind === 'PATIENT') &&
      (setting?.value.automations || []).find((r: any) => r.id === 'absence')?.enabled !== false
    )
      await c.query(
        "INSERT INTO operation_requests(tenant_id,unit_id,appointment_id,professional_id,kind,message,created_by) VALUES($1,$2,$3,$4,'REMINDER',$5,$6) ON CONFLICT DO NOTHING",
        [
          ctx.tenantId,
          a.unit_id,
          a.id,
          a.professional_id,
          'Duas faltas consecutivas identificadas. Entrar em contato com o responsável para entender a continuidade e reorganizar os horários.',
          ctx.userId,
        ],
      );
  }
  if (action === 'cancel' && new Date(a.starts_at) > new Date()) {
    const {
      rows: [setting],
    } = await c.query('SELECT value FROM clinic_settings WHERE tenant_id=$1', [ctx.tenantId]);
    if ((setting?.value.automations || []).find((r: any) => r.id === 'vacancy')?.enabled) {
      const {
        rows: [prof],
      } = await c.query('SELECT specialty FROM professionals WHERE tenant_id=$1 AND id=$2', [
        ctx.tenantId,
        a.professional_id,
      ]);
      const {
        rows: [waiting],
      } = await c.query(
        "SELECT w.id,p.name,p.guardian FROM waitlist w JOIN patients p ON p.id=w.patient_id AND p.tenant_id=w.tenant_id WHERE w.tenant_id=$1 AND w.unit_id=$2 AND w.specialty=$3 AND w.status='WAITING' ORDER BY CASE WHEN w.priority='HIGH' THEN 0 ELSE 1 END,w.created_at LIMIT 1 FOR UPDATE OF w",
        [ctx.tenantId, a.unit_id, prof.specialty],
      );
      if (waiting)
        await c.query(
          "INSERT INTO operation_requests(tenant_id,unit_id,appointment_id,professional_id,kind,message,created_by) VALUES($1,$2,$3,$4,'WAITLIST',$5,$6) ON CONFLICT DO NOTHING",
          [
            ctx.tenantId,
            a.unit_id,
            a.id,
            a.professional_id,
            'Vaga liberada para conferência da recepção. Candidato da lista: ' +
              waiting.name +
              '; responsável: ' +
              waiting.guardian +
              '. Verifique pedido e preferências antes de oferecer; nenhuma reserva foi realizada.',
            ctx.userId,
          ],
        );
    }
  }
  if (['absent', 'cancel'].includes(action) && a.replacement_credit_id)
    await c.query(
      "UPDATE session_credits SET status='OPEN',replacement_appointment_id=NULL WHERE tenant_id=$1 AND id=$2 AND status='RESERVED'",
      [ctx.tenantId, a.replacement_credit_id],
    );
  if (action === 'absent' && !a.replacement_credit_id) {
    const {
      rows: [p],
    } = await c.query(
      'SELECT p.insurer_id,i.rules FROM patients p JOIN insurers i ON i.id=p.insurer_id AND i.tenant_id=p.tenant_id WHERE p.tenant_id=$1 AND p.id=$2',
      [ctx.tenantId, a.patient_id],
    );
    if (
      a.absence_kind === 'PROFESSIONAL' ||
      (p.rules.token_required && a.authorization_status === 'MANUAL')
    ) {
      await c.query(
        'INSERT INTO session_credits(tenant_id,unit_id,patient_id,insurer_id,source_appointment_id,reason,created_by) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING',
        [
          ctx.tenantId,
          a.unit_id,
          a.patient_id,
          p.insurer_id,
          a.id,
          a.absence_kind === 'PROFESSIONAL'
            ? 'Ausência do profissional: reposição devida.'
            : 'Falta com autorização liberada: fora do faturamento.',
          ctx.userId,
        ],
      );
    }
  }
  if (action === 'complete' && a.replacement_credit_id)
    await c.query(
      "UPDATE session_credits SET status='USED',used_at=now() WHERE tenant_id=$1 AND id=$2 AND replacement_appointment_id=$3 AND status='RESERVED'",
      [ctx.tenantId, a.replacement_credit_id, a.id],
    );
  if (action === 'complete' && a.appointment_kind === 'EVALUATION')
    await c.query(
      "UPDATE patient_assessments SET completed_sessions=completed_sessions+1,status=CASE WHEN completed_sessions+1>=target_sessions THEN 'COMPLETED' ELSE 'IN_PROGRESS' END WHERE id=(SELECT pa.id FROM patient_assessments pa JOIN professionals p ON p.specialty=pa.specialty AND p.tenant_id=pa.tenant_id WHERE pa.tenant_id=$1 AND pa.patient_id=$2 AND p.id=$3 AND pa.status='IN_PROGRESS' ORDER BY pa.created_at DESC LIMIT 1)",
      [ctx.tenantId, a.patient_id, a.professional_id],
    );
}
export async function rescheduleAppointment(ctx: Context, unit: string, input: unknown) {
  permit(ctx, receptionRoles);
  const d = z
    .object({
      appointment_id: z.uuid(),
      version: z.number().int(),
      professional_id: z.uuid(),
      starts_at: z.iso.datetime({ offset: true }),
      duration: z.number().int().min(15).max(480),
      reason: z.string().min(10),
    })
    .strict()
    .parse(input);
  return transaction(async (c) => {
    const a = await scopeRow(c, ctx, 'appointments', d.appointment_id, true);
    version(a, d.version);
    if (a.unit_id !== unit || !['SCHEDULED', 'ARRIVED'].includes(a.status))
      throw new ApiError(422, 'Somente sessões ainda não iniciadas podem ser remarcadas.');
    const prof = await scopeRow(c, ctx, 'professionals', d.professional_id, true),
      pat = await scopeRow(c, ctx, 'patients', a.patient_id, true),
      room = await scopeRow(c, ctx, 'rooms', prof.room_id, true);
    if (
      !prof.active ||
      prof.unit_id !== unit ||
      room.unit_id !== unit ||
      !pat.metadata.specialties?.includes(prof.specialty)
    )
      throw new ApiError(422, 'Profissional incompatível com a unidade ou o pedido.');
    const start = new Date(d.starts_at),
      end = new Date(start.getTime() + d.duration * 60000);
    const tz = await unitTimezone(ctx.tenantId, unit, c),
      min = localMinutes(start, tz),
      weekday = localWeekday(start, tz);
    if (start <= new Date()) throw new ApiError(422, 'Escolha um horário futuro.');
    // Mesmas regras do agendamento: expediente da unidade (ou de domicílio) e horário do profissional.
    const home = a.location === 'HOME',
      rules = await unitRules(ctx.tenantId, unit, c),
      maxDuration = home ? rules.max_home_duration : rules.max_clinic_duration;
    if (d.duration > maxDuration)
      throw new ApiError(422, `A duração máxima é de ${maxDuration} minutos.`);
    if (!fitsDay(rules, weekday, min, d.duration, home, prof.metadata?.work_hours))
      throw new ApiError(
        422,
        fitsDay(rules, weekday, min, d.duration, home)
          ? `Fora do horário de trabalho de ${prof.name} neste dia.`
          : outsideHoursMessage(rules, weekday, home),
      );
    if (pat.metadata.order_expires && localDate(start, tz) > pat.metadata.order_expires)
      throw new ApiError(422, 'Pedido médico vencido.');
    const {
      rows: [insurer],
    } = await c.query('SELECT rules FROM insurers WHERE tenant_id=$1 AND id=$2', [
      ctx.tenantId,
      pat.insurer_id,
    ]);
    if (insurer.rules.duration !== d.duration)
      throw new ApiError(422, 'A duração deve seguir o contrato do plano.');
    await checkExtraConstraints(c, ctx, prof, pat, start, end, a.id);
    const {
      rows: [conflict],
    } = await c.query(
      `SELECT count(*) FILTER(WHERE professional_id=$2)::int AS pc,count(*) FILTER(WHERE room_id=$3 AND location='CLINIC')::int AS rc,count(*) FILTER(WHERE patient_id=$4)::int AS patient FROM appointments WHERE tenant_id=$1 AND id<>$7 AND status NOT IN('CANCELLED','ABSENT') AND starts_at<$6 AND ends_at>$5 AND (professional_id=$2 OR room_id=$3 OR patient_id=$4)`,
      [ctx.tenantId, prof.id, room.id, pat.id, start, end, a.id],
    );
    if (
      conflict.patient ||
      conflict.rc >= room.capacity ||
      conflict.pc >=
        ((await isSharedSpecialty(ctx.tenantId, prof.specialty, c)) ? room.capacity : 1)
    )
      throw new ApiError(409, 'Conflito de horário ou capacidade.');
    const {
      rows: [updated],
    } = await c.query(
      "UPDATE appointments SET professional_id=$3,room_id=$4,starts_at=$5,ends_at=$6,status='SCHEDULED',arrived_at=NULL,arrival_by=NULL,authorization_status='PENDING',authorization_evidence=NULL,token_count=0,token_references='[]',authorization_expires=NULL,signature_evidence=NULL,token_requested_at=NULL,signature_requested_at=NULL,reminder_requested_at=NULL,reason=$7,version=version+1 WHERE tenant_id=$1 AND id=$2 RETURNING *",
      [ctx.tenantId, a.id, prof.id, room.id, start, end, d.reason],
    );
    await c.query(
      "UPDATE signature_requests SET status='CANCELLED' WHERE tenant_id=$1 AND appointment_id=$2 AND status='PENDING'",
      [ctx.tenantId, a.id],
    );
    await c.query(
      "UPDATE operation_requests SET status='DONE' WHERE tenant_id=$1 AND appointment_id=$2 AND status='DRAFT'",
      [ctx.tenantId, a.id],
    );
    await audit(c, ctx, 'appointment.rescheduled', 'appointments', a.id, unit, {
      before: { starts_at: a.starts_at, professional_id: a.professional_id },
      after: { starts_at: start, professional_id: prof.id },
      reason: d.reason,
    });
    return updated;
  });
}
export async function registerAbsence(ctx: Context, unit: string, input: unknown) {
  permit(ctx, receptionRoles);
  const d = z
    .object({
      professional_id: z.uuid(),
      starts_at: z.iso.datetime({ offset: true }),
      ends_at: z.iso.datetime({ offset: true }),
      reason: z.string().min(10),
    })
    .strict()
    .parse(input);
  if (new Date(d.ends_at) <= new Date(d.starts_at)) throw new ApiError(422, 'Intervalo inválido.');
  return transaction(async (c) => {
    const p = await scopeRow(c, ctx, 'professionals', d.professional_id, true);
    if (p.unit_id !== unit) throw new ApiError(422, 'Profissional de outra unidade.');
    const {
      rows: [absence],
    } = await c.query(
      'INSERT INTO professional_absences(tenant_id,unit_id,professional_id,starts_at,ends_at,reason,created_by) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *',
      [ctx.tenantId, unit, p.id, d.starts_at, d.ends_at, d.reason, ctx.userId],
    );
    const { rows: appointments } = await c.query(
      "SELECT * FROM appointments WHERE tenant_id=$1 AND professional_id=$2 AND starts_at<$4 AND ends_at>$3 AND status IN('SCHEDULED','ARRIVED') ORDER BY id FOR UPDATE",
      [ctx.tenantId, p.id, d.starts_at, d.ends_at],
    );
    for (const a of appointments) {
      await c.query(
        "UPDATE appointments SET status='CANCELLED',absence_kind='PROFESSIONAL',reason=$3,version=version+1 WHERE tenant_id=$1 AND id=$2",
        [ctx.tenantId, a.id, d.reason],
      );
      const {
        rows: [pat],
      } = await c.query('SELECT insurer_id FROM patients WHERE tenant_id=$1 AND id=$2', [
        ctx.tenantId,
        a.patient_id,
      ]);
      if (a.replacement_credit_id) await appointmentHooks(c, ctx, a, 'cancel');
      else
        await c.query(
          'INSERT INTO session_credits(tenant_id,unit_id,patient_id,insurer_id,source_appointment_id,reason,created_by) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING',
          [
            ctx.tenantId,
            unit,
            a.patient_id,
            pat.insurer_id,
            a.id,
            'Ausência do profissional: ' + d.reason,
            ctx.userId,
          ],
        );
      await c.query(
        "UPDATE signature_requests SET status='CANCELLED' WHERE tenant_id=$1 AND appointment_id=$2 AND status='PENDING'",
        [ctx.tenantId, a.id],
      );
    }
    await audit(c, ctx, 'professional.absence', 'professional_absences', absence.id, unit, {
      count: appointments.length,
      reason: d.reason,
    });
    await c.query(
      'UPDATE professional_absences SET cancelled_appointment_ids=$3 WHERE tenant_id=$1 AND id=$2',
      [ctx.tenantId, absence.id, appointments.map((a: any) => a.id)],
    );
    return { count: appointments.length };
  });
}
export async function transferProfessional(ctx: Context, unit: string, input: unknown) {
  permit(ctx, managers);
  const d = z
    .object({ professional_id: z.uuid(), destination_id: z.uuid(), reason: z.string().min(10) })
    .strict()
    .parse(input);
  if (d.professional_id === d.destination_id)
    throw new ApiError(422, 'Escolha outro profissional.');
  return transaction(async (c) => {
    for (const id of [d.professional_id, d.destination_id].sort())
      await scopeRow(c, ctx, 'professionals', id, true);
    const from = await scopeRow(c, ctx, 'professionals', d.professional_id),
      to = await scopeRow(c, ctx, 'professionals', d.destination_id);
    if (
      from.unit_id !== unit ||
      to.unit_id !== unit ||
      from.specialty !== to.specialty ||
      !from.active ||
      !to.active
    )
      throw new ApiError(422, 'Escolha um profissional ativo da mesma especialidade e unidade.');
    const room = await scopeRow(c, ctx, 'rooms', to.room_id, true);
    const { rows: future } = await c.query(
      "SELECT * FROM appointments WHERE tenant_id=$1 AND professional_id=$2 AND starts_at>now() AND status IN('SCHEDULED','ARRIVED') ORDER BY starts_at FOR UPDATE",
      [ctx.tenantId, from.id],
    );
    for (const a of future) {
      const pat = await scopeRow(c, ctx, 'patients', a.patient_id);
      await checkExtraConstraints(
        c,
        ctx,
        to,
        pat,
        new Date(a.starts_at),
        new Date(a.ends_at),
        a.id,
      );
      const {
        rows: [r],
      } = await c.query(
        "SELECT count(*) FILTER(WHERE professional_id=$2)::int AS pc,count(*) FILTER(WHERE room_id=$3 AND location='CLINIC')::int AS rc FROM appointments WHERE tenant_id=$1 AND id<>$6 AND status NOT IN('CANCELLED','ABSENT') AND starts_at<$5 AND ends_at>$4 AND (professional_id=$2 OR room_id=$3)",
        [ctx.tenantId, to.id, room.id, a.starts_at, a.ends_at, a.id],
      );
      if (
        r.rc >= room.capacity ||
        r.pc >= ((await isSharedSpecialty(ctx.tenantId, to.specialty, c)) ? room.capacity : 1)
      )
        throw new ApiError(
          409,
          'Transferência bloqueada por conflito. Remarque as sessões antes de desligar.',
        );
      await c.query(
        'UPDATE appointments SET professional_id=$3,room_id=$4,version=version+1 WHERE tenant_id=$1 AND id=$2',
        [ctx.tenantId, a.id, to.id, room.id],
      );
    }
    const { rows: patients } = await c.query(
      "SELECT DISTINCT patient_id FROM appointments WHERE tenant_id=$1 AND professional_id IN($2,$3) UNION SELECT id AS patient_id FROM patients WHERE tenant_id=$1 AND unit_id=$4 AND metadata->'fixed_professionals'->>$5=$2::text",
      [ctx.tenantId, from.id, to.id, unit, from.specialty],
    );
    for (const p of patients) {
      const { rowCount } = await c.query(
        'SELECT id FROM appointments WHERE tenant_id=$1 AND professional_id=$2 AND patient_id=$3 LIMIT 1',
        [ctx.tenantId, from.id, p.patient_id],
      );
      const patient = await scopeRow(c, ctx, 'patients', p.patient_id, true);
      const fixed = patient.metadata.fixed_professionals?.[from.specialty] === from.id;
      if (fixed)
        await c.query(
          "UPDATE patients SET metadata=jsonb_set(metadata,ARRAY['fixed_professionals',$3],to_jsonb($4::text)),version=version+1 WHERE tenant_id=$1 AND id=$2",
          [ctx.tenantId, p.patient_id, from.specialty, to.id],
        );
      if (rowCount || fixed || future.some((a) => a.patient_id === p.patient_id))
        await c.query(
          'INSERT INTO patient_transfers(tenant_id,patient_id,from_professional_id,to_professional_id,reason,created_by) VALUES($1,$2,$3,$4,$5,$6)',
          [ctx.tenantId, p.patient_id, from.id, to.id, d.reason, ctx.userId],
        );
    }
    await c.query(
      "UPDATE professionals SET active=false,metadata=metadata||jsonb_build_object('transferred_to',$3::text),version=version+1 WHERE tenant_id=$1 AND id=$2",
      [ctx.tenantId, from.id, to.id],
    );
    if (from.metadata.user_id)
      await c.query('UPDATE memberships SET active=false WHERE tenant_id=$1 AND user_id=$2', [
        ctx.tenantId,
        from.metadata.user_id,
      ]);
    await audit(c, ctx, 'professional.portfolio_transferred', 'professionals', from.id, unit, {
      destination: to.id,
      sessions: future.length,
      reason: d.reason,
    });
    return { sessions: future.length };
  });
}
