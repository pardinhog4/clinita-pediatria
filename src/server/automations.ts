import { formatDateTime } from '@/lib/timezone';
import { contactTemplate } from './contact-templates';
import { transaction } from '@/lib/db';
import type { Context } from '@/lib/security';
import { requiredTokens } from './session-evidence';
export async function prepareDueContacts(scope?: Context, unit?: string) {
  return transaction(async (c) => {
    const { rows } = await c.query(
      `SELECT a.*,unit_tz(a.tenant_id,a.unit_id) AS tz,p.name AS patient_name,p.guardian,i.rules,s.value AS settings,o.user_id AS operator FROM appointments a JOIN patients p ON p.id=a.patient_id AND p.tenant_id=a.tenant_id JOIN insurers i ON i.id=p.insurer_id AND i.tenant_id=p.tenant_id LEFT JOIN clinic_settings s ON s.tenant_id=a.tenant_id JOIN LATERAL(SELECT user_id FROM memberships WHERE tenant_id=a.tenant_id AND active=true AND role IN('ADMIN','MANAGEMENT') ORDER BY role LIMIT 1)o ON true WHERE a.status IN('SCHEDULED','ARRIVED') AND a.starts_at>now() AND a.starts_at<=now()+interval '7 days' AND (a.reminder_requested_at IS NULL OR a.token_requested_at IS NULL) AND ($1::uuid IS NULL OR a.tenant_id=$1) AND ($2::uuid IS NULL OR a.unit_id=$2) ORDER BY a.starts_at LIMIT 200 FOR UPDATE OF a SKIP LOCKED`,
      [scope?.tenantId || null, unit || null],
    );
    let count = 0;
    for (const a of rows) {
      const automations = a.settings?.automations || [];
      const get = (id: string, minutes: number) =>
        automations.find((r: any) => r.id === id) || { enabled: true, minutes_before: minutes };
      const reminder = get('reminder', 1440),
        token = get('token', Number(a.rules.token_minutes_before) || 30),
        minutes = (new Date(a.starts_at).getTime() - Date.now()) / 60000;
      const todo: {
        kind: 'TOKEN' | 'REMINDER';
        column: 'token_requested_at' | 'reminder_requested_at';
        message: string;
      }[] = [];
      const date = formatDateTime(a.starts_at, a.tz);
      if (reminder.enabled && !a.reminder_requested_at && minutes <= reminder.minutes_before)
        todo.push({
          kind: 'REMINDER',
          column: 'reminder_requested_at',
          message: `Olá, ${a.guardian}! Você confirma a sessão de ${a.patient_name} em ${date}?`,
        });
      if (
        token.enabled &&
        a.rules.token_required &&
        !a.token_requested_at &&
        a.authorization_status !== 'MANUAL' &&
        minutes <= Number(a.rules.token_minutes_before || token.minutes_before)
      )
        todo.push({
          kind: 'TOKEN',
          column: 'token_requested_at',
          message: `Olá, ${a.guardian}! Por favor, libere ${requiredTokens(a.rules, (new Date(a.ends_at).getTime() - new Date(a.starts_at).getTime()) / 60000)} token(s) de ${a.patient_name} para a sessão de ${date}.`,
        });
      for (const r of todo) {
        const result = await c.query(
          'INSERT INTO operation_requests(tenant_id,unit_id,appointment_id,professional_id,kind,message,created_by) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING',
          [
            a.tenant_id,
            a.unit_id,
            a.id,
            a.professional_id,
            r.kind,
            contactTemplate(
              a.settings,
              r.kind.toLowerCase(),
              a,
              new Date(a.starts_at),
              a.tz,
              r.message,
            ),
            scope?.userId || a.operator,
          ],
        );
        count += result.rowCount || 0;
        await c.query(`UPDATE appointments SET ${r.column}=now() WHERE tenant_id=$1 AND id=$2`, [
          a.tenant_id,
          a.id,
        ]);
        if (result.rowCount)
          await c.query(
            "INSERT INTO audit_events(tenant_id,unit_id,actor_id,action,entity_type,entity_id,details) VALUES($1,$2,$3,'automation.contact_prepared','appointments',$4,$5)",
            [
              a.tenant_id,
              a.unit_id,
              scope?.userId || a.operator,
              a.id,
              JSON.stringify({ kind: r.kind, transport: 'LOCAL_DRAFT', sent: false }),
            ],
          );
      }
    }
    return {
      count,
      message: `${count} contato(s) preparado(s) na fila local. Nenhum envio externo foi realizado.`,
    };
  });
}
