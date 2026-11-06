import {
  clock,
  dayTimes,
  fitsDay,
  megabytes,
  resolveRules,
  type WorkHours,
} from '@/lib/clinic-rules';
import { tenantRules, unitRules } from './clinic-rules';
import { weekdayOf, zonedInstant } from '@/lib/timezone';
import { NextRequest, NextResponse } from 'next/server';
import { tenantSpecialties } from './specialties';
import { ApiError } from '@/lib/errors';
import { query, transaction } from '@/lib/db';
import { context, assertUnit, permit, type Context } from '@/lib/security';
import { uuid, specialtyCode } from '@/lib/schemas';
import { z } from 'zod';
import {
  audit,
  scopeRow,
  clinicalAccess,
  financeRoles,
  clinicRoles,
  receptionRoles,
  managers,
  readRoles,
} from './repository';
export async function readLimited(req: NextRequest, max = 128 * 1024) {
  const reader = req.body?.getReader();
  if (!reader) throw new ApiError(400, 'Corpo obrigatório.');
  let size = 0;
  const chunks: Uint8Array[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel();
      throw new ApiError(413, 'Arquivo ou corpo acima do limite.');
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}
export async function jsonInput(req: NextRequest) {
  if (!req.headers.get('content-type')?.startsWith('application/json'))
    throw new ApiError(415, 'Envie JSON.');
  try {
    return JSON.parse((await readLimited(req)).toString('utf8'));
  } catch (e) {
    if (e instanceof ApiError) throw e;
    throw new ApiError(400, 'JSON inválido.');
  }
}
export async function uploadDocument(req: NextRequest, ctx: Context) {
  const { upload_max_mb } = await tenantRules(ctx.tenantId);
  const bytes = await readLimited(req, megabytes(upload_max_mb) + 300000);
  const form = await new Response(new Uint8Array(bytes), {
    headers: { 'content-type': req.headers.get('content-type') || '' },
  }).formData();
  const professionalId = form.get('professional_id')?.toString() || null,
    documentKind = z
      .enum(['GENERAL', 'CERTIFICATE', 'CNPJ', 'BANK', 'MEDICAL_ORDER', 'REPORT'])
      .parse(form.get('document_kind') || 'GENERAL');
  if (professionalId && form.get('patient_id'))
    throw new ApiError(422, 'Vincule o documento a um paciente ou profissional.');
  const file = form.get('file'),
    patientId = form.get('patient_id')?.toString() || null,
    unitId = uuid.parse(form.get('unit_id'));
  assertUnit(ctx, unitId);
  if (!(file instanceof File) || file.size > megabytes(upload_max_mb) || file.size < 5)
    throw new ApiError(422, `Escolha um PDF de até ${upload_max_mb} MB.`);
  const content = Buffer.from(await file.arrayBuffer());
  if (content.subarray(0, 5).toString() !== '%PDF-')
    throw new ApiError(422, 'O documento precisa ser um PDF.');
  if (patientId) {
    uuid.parse(patientId);
    await clinicalAccess(ctx, patientId);
    const [p] = await query('SELECT unit_id FROM patients WHERE tenant_id=$1 AND id=$2', [
      ctx.tenantId,
      patientId,
    ]);
    if (p.unit_id !== unitId) throw new ApiError(422, 'Unidade do paciente inválida.');
  } else if (professionalId) {
    permit(ctx, managers);
    const [p] = await query('SELECT id,unit_id FROM professionals WHERE tenant_id=$1 AND id=$2', [
      ctx.tenantId,
      uuid.parse(professionalId),
    ]);
    if (!p || p.unit_id !== unitId) throw new ApiError(422, 'Profissional de outra unidade.');
  } else permit(ctx, financeRoles);
  return transaction(async (c) => {
    const {
      rows: [d],
    } = await c.query(
      "INSERT INTO documents(tenant_id,unit_id,patient_id,name,mime,content,created_by,professional_id,document_kind) VALUES($1,$2,$3,$4,'application/pdf',$5,$6,$7,$8) RETURNING id,name,created_at",
      [
        ctx.tenantId,
        unitId,
        patientId,
        file.name.slice(0, 180),
        content,
        ctx.userId,
        professionalId,
        documentKind,
      ],
    );
    await audit(c, ctx, 'document.uploaded', 'documents', d.id, unitId, { clinical: !!patientId });
    return d;
  });
}
export async function downloadDocument(ctx: Context, id: string) {
  uuid.parse(id);
  return transaction(async (c) => {
    const d = await scopeRow(c, ctx, 'documents', id);
    if (d.deleted_at) throw new ApiError(404, 'Documento removido.');
    if (d.patient_id) await clinicalAccess(ctx, d.patient_id);
    else if (d.professional_id) {
      permit(ctx, d.document_kind === 'CERTIFICATE' ? readRoles.professionals : financeRoles);
    } else permit(ctx, financeRoles);
    await audit(c, ctx, 'document.downloaded', 'documents', id, d.unit_id);
    return new NextResponse(new Uint8Array(d.content), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(d.name)}`,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  });
}
export async function appMeta(ctx: Context) {
  const units = await query(
    "SELECT u.id,u.name,u.business_hours,u.timezone,cs.value->'rules' AS rules FROM units u LEFT JOIN clinic_settings cs ON cs.tenant_id=u.tenant_id WHERE u.tenant_id=$1 AND u.id=ANY($2::uuid[]) ORDER BY u.sort_order,u.name",
    [ctx.tenantId, ctx.unitIds],
  );
  const [session] = await query<{ method: string }>('SELECT method FROM sessions WHERE id=$1', [
    ctx.sessionId,
  ]);
  return {
    user: ctx,
    // Cada unidade leva as regras já resolvidas (clínica + horário próprio da unidade).
    units: units.map((u) => ({
      id: u.id,
      name: u.name,
      rules: resolveRules(u.rules, u.business_hours, u.timezone),
      own_hours: !!u.business_hours,
      own_timezone: !!u.timezone,
    })),
    specialties: await tenantSpecialties(ctx.tenantId),
    sessionMethod: session?.method || 'PASSWORD',
    clinical: clinicRoles.includes(ctx.role),
    financial: financeRoles.includes(ctx.role),
  };
}
export async function availability(ctx: Context, params: URLSearchParams) {
  permit(ctx, receptionRoles);
  const unit = uuid.parse(params.get('unit')),
    date = z.iso.date().parse(params.get('date')),
    specialty = specialtyCode.parse(params.get('specialty')),
    duration = z.coerce
      .number()
      .int()
      .min(15)
      .parse(params.get('duration') || 60);
  assertUnit(ctx, unit);
  const rules = await unitRules(ctx.tenantId, unit);
  if (duration > rules.max_clinic_duration)
    throw new ApiError(422, `Sessões na clínica têm até ${rules.max_clinic_duration} minutos.`);
  const professionals = await query<{
    id: string;
    name: string;
    specialty: string;
    competencies: string[];
    room_id: string;
    room_name: string;
    capacity: number;
    min_age: number;
    max_age: number;
    work_days: number[];
    work_hours: WorkHours | null;
    certifications: any[];
    shared_room: boolean;
  }>(
    `SELECT p.id,p.name,p.specialty,p.competencies,p.room_id,r.name AS room_name,r.capacity,coalesce((SELECT s.shared_room FROM specialties s WHERE s.tenant_id=p.tenant_id AND s.code=p.specialty),false) AS shared_room,coalesce((p.metadata->>'min_age')::int,0) AS min_age,coalesce((p.metadata->>'max_age')::int,120) AS max_age,coalesce(p.metadata->'work_days','[1,2,3,4,5,6]'::jsonb) AS work_days,p.metadata->'work_hours' AS work_hours,coalesce(p.metadata->'certifications','[]'::jsonb) AS certifications FROM professionals p JOIN rooms r ON r.id=p.room_id AND r.tenant_id=p.tenant_id WHERE p.tenant_id=$1 AND p.unit_id=$2 AND p.specialty=$3 AND p.active=true ORDER BY p.name`,
    [ctx.tenantId, unit, specialty],
  );
  const sessions = await query(
    "SELECT professional_id,CASE WHEN location='CLINIC' THEN room_id END AS room_id,patient_id,starts_at,ends_at FROM appointments WHERE tenant_id=$1 AND unit_id=$2 AND (starts_at AT TIME ZONE $4)::date=$3 AND status NOT IN('CANCELLED','ABSENT')",
    [ctx.tenantId, unit, date, rules.timezone],
  );
  const weekday = weekdayOf(date);
  let age = params.get('age') ? z.coerce.number().min(0).max(120).parse(params.get('age')) : null;
  const competency = params.get('competency')?.trim().toLowerCase().slice(0, 100) || '';
  if (params.get('patient')) {
    const patientId = uuid.parse(params.get('patient'));
    const [p] = await query(
      'SELECT birth_date,metadata FROM patients WHERE tenant_id=$1 AND unit_id=$2 AND id=$3',
      [ctx.tenantId, unit, patientId],
    );
    if (!p) throw new ApiError(404, 'Paciente não encontrado.');
    const birth = new Date(p.birth_date),
      on = new Date(date + 'T12:00:00Z');
    age =
      on.getFullYear() -
      birth.getFullYear() -
      (on.getMonth() < birth.getMonth() ||
      (on.getMonth() === birth.getMonth() && on.getDate() < birth.getDate())
        ? 1
        : 0);
    if (p.metadata.order_expires && date > p.metadata.order_expires)
      throw new ApiError(422, 'Pedido médico vencido nesta data.');
    if (!p.metadata.specialties?.includes(specialty))
      throw new ApiError(422, 'Especialidade fora do pedido médico.');
  }
  const absences = await query(
    'SELECT professional_id,starts_at,ends_at FROM professional_absences WHERE tenant_id=$1 AND unit_id=$2 AND status=\x27ACTIVE\x27 AND starts_at<($3::date+2)::timestamptz AND ends_at>=($3::date-1)::timestamptz',
    [ctx.tenantId, unit, date],
  );
  return {
    data: professionals
      .filter((p) => age === null || (age >= p.min_age && age <= p.max_age))
      .map((p) => ({
        ...p,
        compatibility:
          age !== null &&
          (!competency || p.competencies.some((c) => c.toLowerCase() === competency))
            ? 'HIGH'
            : 'MANUAL',
        competency_match:
          !competency || p.competencies.some((c) => c.toLowerCase().includes(competency)),
        certificate_verified:
          !competency ||
          p.certifications.some((c) => c.code.toLowerCase().includes(competency) && c.verified),
        // Grade da unidade; o horário próprio do profissional limita quais ficam livres.
        slots: dayTimes(rules, weekday, duration).map((m) => {
          const time = clock(m),
            start = zonedInstant(date, time, rules.timezone),
            end = new Date(start.getTime() + duration * 60000),
            overlaps = sessions.filter(
              (a) => new Date(a.starts_at) < end && new Date(a.ends_at) > start,
            ),
            available =
              (!p.work_days.length || p.work_days.includes(weekday)) &&
              fitsDay(rules, weekday, m, duration, false, p.work_hours) &&
              !absences.some(
                (a) =>
                  a.professional_id === p.id &&
                  new Date(a.starts_at) < end &&
                  new Date(a.ends_at) > start,
              ) &&
              (!params.get('patient') ||
                !overlaps.some((a) => a.patient_id === params.get('patient'))) &&
              start > new Date() &&
              overlaps.filter((a) => a.professional_id === p.id).length <
                (p.shared_room ? p.capacity : 1) &&
              overlaps.filter((a) => a.room_id === p.room_id).length < p.capacity;
          return { time, available };
        }),
      })),
  };
}
export { payouts } from './payouts';
export { dashboard } from './dashboard';
