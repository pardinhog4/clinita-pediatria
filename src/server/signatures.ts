import { tenantRules, unitTimezone } from './clinic-rules';
import { localTime } from '@/lib/timezone';
import { randomBytes } from 'node:crypto';
import { renderTemplate, settingsValue } from './message-templates';
import { z } from 'zod';
import { NextRequest } from 'next/server';
import { query, transaction } from '@/lib/db';
import { ApiError } from '@/lib/errors';
import { hash, permit, checkOrigin, rateLimit, type Context } from '@/lib/security';
import { audit, scopeRow, receptionRoles } from './repository';
const tokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
export async function createSignatureLink(ctx: Context, unit: string, id: string) {
  permit(ctx, receptionRoles);
  return transaction(async (c) => {
    const a = await scopeRow(c, ctx, 'appointments', z.uuid().parse(id), true);
    if (a.unit_id !== unit || ['ABSENT', 'CANCELLED'].includes(a.status))
      throw new ApiError(422, 'Sessão indisponível para assinatura.');
    const {
      rows: [p],
    } = await c.query(
      'SELECT p.name,p.guardian,p.metadata,i.rules FROM patients p JOIN insurers i ON i.id=p.insurer_id AND i.tenant_id=p.tenant_id WHERE p.tenant_id=$1 AND p.id=$2',
      [ctx.tenantId, a.patient_id],
    );
    if (!p.rules.signature_required)
      throw new ApiError(422, 'Esta operadora não exige guia assinada.');
    if (p.metadata.biometric_required)
      throw new ApiError(
        422,
        'Paciente exige validação biométrica; registre a conferência presencial.',
      );
    if (a.signature_evidence) throw new ApiError(409, 'A guia já possui evidência.');
    const token = randomBytes(32).toString('base64url');
    await c.query(
      "UPDATE signature_requests SET status='CANCELLED' WHERE tenant_id=$1 AND appointment_id=$2 AND status='PENDING'",
      [ctx.tenantId, a.id],
    );
    const {
      rows: [r],
    } = await c.query(
      'INSERT INTO signature_requests(tenant_id,unit_id,appointment_id,token_hash,expires_at,created_by) VALUES($1,$2,$3,$4,now()+make_interval(hours=>$6),$5) RETURNING id,expires_at',
      [
        ctx.tenantId,
        unit,
        a.id,
        hash(token),
        ctx.userId,
        (await tenantRules(ctx.tenantId, c)).signature_link_hours,
      ],
    );
    const url = (process.env.APP_ORIGIN || 'http://localhost:3005') + '/assinatura/' + token;
    await c.query(
      'UPDATE appointments SET signature_requested_at=now(),version=version+1 WHERE tenant_id=$1 AND id=$2',
      [ctx.tenantId, a.id],
    );
    await c.query(
      "INSERT INTO operation_requests(tenant_id,unit_id,appointment_id,professional_id,kind,message,created_by) VALUES($1,$2,$3,$4,'SIGNATURE',$5,$6) ON CONFLICT(tenant_id,appointment_id,kind) WHERE appointment_id IS NOT NULL AND status='DRAFT' DO UPDATE SET message=EXCLUDED.message",
      [
        ctx.tenantId,
        unit,
        a.id,
        a.professional_id,
        renderTemplate(await settingsValue(c, ctx.tenantId), 'signature', {
          responsavel: p.guardian,
          paciente: p.name,
          data: new Date(a.starts_at).toLocaleDateString('pt-BR', {
            timeZone: await unitTimezone(ctx.tenantId, unit, c),
          }),
          hora: localTime(a.starts_at, await unitTimezone(ctx.tenantId, unit, c)),
          link: url,
        }),
        ctx.userId,
      ],
    );
    await audit(c, ctx, 'signature.link_created', 'signature_requests', r.id, unit, {
      appointmentId: a.id,
      qualifiedSignature: false,
    });
    return { url, expires_at: r.expires_at, id: r.id };
  });
}
export async function signatureInfo(token: string) {
  tokenSchema.parse(token);
  await rateLimit('signature-read:' + hash(token).slice(0, 16), 50);
  const [r] = await query(
    `SELECT s.id,s.status,s.expires_at,a.starts_at,a.status AS appointment_status,p.name AS patient_name,p.guardian,pr.specialty,u.name AS unit_name,unit_tz(s.tenant_id,s.unit_id) AS timezone FROM signature_requests s JOIN appointments a ON a.id=s.appointment_id AND a.tenant_id=s.tenant_id JOIN patients p ON p.id=a.patient_id AND p.tenant_id=a.tenant_id JOIN professionals pr ON pr.id=a.professional_id AND pr.tenant_id=a.tenant_id JOIN units u ON u.id=s.unit_id AND u.tenant_id=s.tenant_id WHERE s.token_hash=$1`,
    [hash(token)],
  );
  if (
    !r ||
    r.status === 'CANCELLED' ||
    new Date(r.expires_at) < new Date() ||
    ['ABSENT', 'CANCELLED'].includes(r.appointment_status)
  )
    throw new ApiError(410, 'Link expirado ou indisponível. Solicite outro à recepção.');
  return {
    id: r.id,
    status: r.status,
    expires_at: r.expires_at,
    starts_at: r.starts_at,
    timezone: r.timezone,
    patient_name: r.patient_name.split(' ')[0],
    guardian_first_name: r.guardian.split(' ')[0],
    specialty: r.specialty,
    unit_name: r.unit_name,
  };
}
export async function signGuide(req: NextRequest, token: string, input: unknown) {
  checkOrigin(req);
  tokenSchema.parse(token);
  await rateLimit('signature-write:' + hash(token).slice(0, 16), 10);
  const d = z
    .object({
      name: z.string().trim().min(3).max(200),
      consent: z.literal(true),
      strokes: z
        .array(
          z
            .array(z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) }).strict())
            .min(2)
            .max(3000),
        )
        .min(1)
        .max(100),
    })
    .strict()
    .parse(input);
  const points = d.strokes.flat();
  if (
    points.length < 5 ||
    Math.max(...points.map((p) => p.x)) - Math.min(...points.map((p) => p.x)) < 0.05
  )
    throw new ApiError(422, 'Assine no quadro antes de confirmar.');
  return transaction(async (c) => {
    const {
      rows: [r],
    } = await c.query('SELECT * FROM signature_requests WHERE token_hash=$1 FOR UPDATE', [
      hash(token),
    ]);
    if (!r || r.status === 'CANCELLED' || new Date(r.expires_at) < new Date())
      throw new ApiError(410, 'Link expirado.');
    if (r.status === 'SIGNED') return { signed: true };
    const {
      rows: [a],
    } = await c.query('SELECT * FROM appointments WHERE tenant_id=$1 AND id=$2 FOR UPDATE', [
      r.tenant_id,
      r.appointment_id,
    ]);
    if (['ABSENT', 'CANCELLED'].includes(a.status)) throw new ApiError(422, 'Sessão indisponível.');
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 200">' +
      d.strokes
        .map(
          (s) =>
            '<polyline fill="none" stroke="#123d35" stroke-width="2" points="' +
            s.map((p) => (p.x * 600).toFixed(2) + ',' + (p.y * 200).toFixed(2)).join(' ') +
            '"/>',
        )
        .join('') +
      '</svg>';
    await c.query(
      "UPDATE signature_requests SET status='SIGNED',signer_name=$2,consent=$3,signature_svg=$4,signed_at=now() WHERE id=$1",
      [
        r.id,
        d.name,
        'Confirmo o atendimento e autorizo o registro eletrônico local desta guia.',
        svg,
      ],
    );
    await c.query(
      'UPDATE appointments SET signature_evidence=$3,version=version+1 WHERE tenant_id=$1 AND id=$2',
      [
        r.tenant_id,
        a.id,
        `Registro eletrônico local por ${d.name}; solicitação ${r.id}. Sujeito à conferência da operadora.`,
      ],
    );
    await c.query(
      "UPDATE operation_requests SET status='DONE' WHERE tenant_id=$1 AND appointment_id=$2 AND kind='SIGNATURE' AND status IN('DRAFT','SENT_MANUALLY')",
      [r.tenant_id, a.id],
    );
    await c.query(
      "INSERT INTO audit_events(tenant_id,unit_id,actor_id,action,entity_type,entity_id,details) VALUES($1,$2,$3,'signature.recorded','signature_requests',$4,$5)",
      [
        r.tenant_id,
        r.unit_id,
        r.created_by,
        r.id,
        JSON.stringify({
          signer: d.name,
          consent: true,
          source: 'PUBLIC_SINGLE_USE_LINK',
          qualifiedSignature: false,
        }),
      ],
    );
    return { signed: true };
  });
}
