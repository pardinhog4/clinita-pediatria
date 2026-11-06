export function requiredTokens(rules: Record<string, any>, minutes: number) {
  if (!rules.token_required) return 0;
  return rules.tokens_per_30
    ? Math.ceil(minutes / 30) * Math.max(1, Number(rules.tokens_per_30))
    : Math.max(1, Number(rules.tokens_per_session) || 1);
}
export function authorizationType(rules: Record<string, any>, name = '') {
  return (
    rules.authorization_type ||
    (/particular/i.test(name)
      ? 'PRIVATE'
      : rules.token_required
        ? 'TOKEN'
        : rules.signature_required
          ? 'GUIDE'
          : 'QUOTA')
  );
}
export function evidenceGaps(a: Record<string, any>) {
  const rules = a.rules || {},
    gaps: string[] = [];
  if (a.status !== 'COMPLETED')
    gaps.push(a.status === 'IN_PROGRESS' ? 'Sessão em andamento' : 'Sessão não realizada');
  if (!a.arrived_at) gaps.push('Chegada');
  if (!a.evolution_recorded && !a.evolution) gaps.push('Evolução');
  if (rules.token_required && a.authorization_status !== 'MANUAL') gaps.push('Token/autorização');
  if (
    rules.token_required &&
    (rules.tokens_per_30 || rules.tokens_per_session) &&
    Number(a.token_count) < requiredTokens(rules, Number(a.duration))
  )
    gaps.push('Quantidade de tokens');
  if (
    a.authorization_expires &&
    String(a.authorization_expires).slice(0, 10) < String(a.session_date).slice(0, 10)
  )
    gaps.push('Autorização vencida');
  if (rules.signature_required && !a.signature_evidence) gaps.push('Assinatura da guia');
  if (a.financial_hold || (a.contested_at && !a.contest_resolved_at)) gaps.push('Contestação');
  if (a.audit_status === 'RETURNED') gaps.push('Devolvido para correção');
  if (a.audit_status === 'REJECTED') gaps.push('Auditoria rejeitada');
  return gaps;
}
