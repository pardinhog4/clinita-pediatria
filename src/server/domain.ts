import { DEFAULT_TIMEZONE, localDate } from '@/lib/timezone';
import { requiredTokens } from './session-evidence';
import { ApiError } from '@/lib/errors';
export type AppointmentState = {
  status: string;
  authorization_status: string;
  authorization_evidence?: string | null;
  signature_evidence?: string | null;
  evolution?: string | null;
  audit_status: string;
  financial_hold?: boolean;
  token_count?: number;
  authorization_expires?: string | null;
  starts_at?: string | Date;
  ends_at?: string | Date;
  /** Fuso da unidade (padrão: Brasília). */
  timezone?: string;
};
export function appointmentBlock(
  a: AppointmentState,
  action: string,
  rules: {
    token_required?: boolean;
    signature_required?: boolean;
    tokens_per_30?: number;
    tokens_per_session?: number;
  } = {},
) {
  if (action === 'arrive' && a.status !== 'SCHEDULED')
    return 'Somente uma sessão agendada pode registrar chegada.';
  if (['start', 'approve'].includes(action) && a.financial_hold)
    return 'Atendimento contestado ou bloqueado para conferência.';
  if (
    ['start', 'approve'].includes(action) &&
    rules.token_required &&
    (rules.tokens_per_30 || rules.tokens_per_session) &&
    a.starts_at &&
    a.ends_at &&
    Number(a.token_count) <
      requiredTokens(
        rules,
        (new Date(a.ends_at).getTime() - new Date(a.starts_at).getTime()) / 60000,
      )
  )
    return 'Quantidade de tokens insuficiente.';
  if (
    ['start', 'approve'].includes(action) &&
    a.authorization_expires &&
    a.starts_at &&
    (typeof a.authorization_expires === 'string'
      ? a.authorization_expires.slice(0, 10)
      : localDate(a.authorization_expires, a.timezone || DEFAULT_TIMEZONE)) <
      localDate(a.starts_at, a.timezone || DEFAULT_TIMEZONE)
  )
    return 'Autorização vencida na data da sessão.';
  if (action === 'start') {
    if (a.status !== 'ARRIVED') return 'Registre a chegada antes de iniciar.';
    if (rules.token_required && a.authorization_status !== 'MANUAL')
      return 'Registre a evidência da autorização antes de iniciar.';
    if (rules.signature_required && !a.signature_evidence)
      return 'Registre a assinatura da guia antes de iniciar.';
  }
  if (action === 'complete' && a.status !== 'IN_PROGRESS')
    return 'Inicie a sessão antes de registrar evolução.';
  if (['absent', 'cancel'].includes(action) && !['SCHEDULED', 'ARRIVED'].includes(a.status))
    return 'Não é possível cancelar ou marcar falta nesta etapa.';
  if (action === 'approve') {
    if (a.status !== 'COMPLETED' || !a.evolution || a.evolution.trim().length < 40)
      return 'Atendimento e evolução completos são obrigatórios.';
    if (rules.token_required && (a.authorization_status !== 'MANUAL' || !a.authorization_evidence))
      return 'Autorização com evidência pendente.';
    if (rules.signature_required && !a.signature_evidence)
      return 'Assinatura ou guia com evidência pendente.';
    if (a.audit_status === 'APPROVED') return 'Sessão já aprovada.';
  }
  return null;
}
export function ensureAllowed(
  a: AppointmentState,
  action: string,
  rules?: { token_required?: boolean; signature_required?: boolean },
) {
  const reason = appointmentBlock(a, action, rules);
  if (reason) throw new ApiError(422, reason);
}
