// Modelos de mensagem da clínica. Os de sistema são usados pelos fluxos (lembrete, token, assinatura, lista de espera,
// espelho de repasse...) e podem ter o texto editado, mas não ser removidos. A clínica pode criar modelos próprios.
export type TemplateDef = { id: string; name: string; content: string; variables: string[] };
const patientVars = ['responsavel', 'paciente', 'data', 'hora'];
export const systemTemplates: TemplateDef[] = [
  {
    id: 'welcome',
    name: 'Acolhimento',
    variables: ['responsavel', 'paciente'],
    content: 'Olá, {responsavel}! Como podemos ajudar no atendimento de {paciente}?',
  },
  {
    id: 'reminder',
    name: 'Lembrete de sessão',
    variables: patientVars,
    content:
      'Olá, {responsavel}! A sessão de {paciente} está marcada para {data} às {hora}. Você confirma?',
  },
  {
    id: 'token',
    name: 'Pedido de token',
    variables: patientVars,
    content:
      'Olá, {responsavel}! Por favor, libere a autorização de {paciente} para a sessão de {data} às {hora}.',
  },
  {
    id: 'signature',
    name: 'Assinatura de guia',
    variables: [...patientVars, 'link'],
    content: 'Olá, {responsavel}! Confira e assine a guia do atendimento de {paciente}: {link}.',
  },
  {
    id: 'evolution',
    name: 'Pendência de evolução',
    variables: patientVars,
    content:
      'Olá, {responsavel}! Há uma pendência no registro da sessão de {paciente} em {data} às {hora}. Nossa equipe vai entrar em contato.',
  },
  {
    id: 'waitlist_offer',
    name: 'Oferta de vaga da lista de espera',
    variables: ['responsavel', 'paciente', 'detalhes'],
    content: 'Olá, {responsavel}! Há uma possibilidade de vaga para {paciente}. {detalhes}',
  },
  {
    id: 'payout_mirror',
    name: 'Espelho de repasse ao profissional',
    variables: ['profissional', 'sessoes', 'valor'],
    content:
      'Olá, {profissional}! Seu espelho de repasse está disponível: {sessoes} sessões, valor de {valor}. Confira na plataforma.',
  },
];
export const allowedVariables = [...new Set(systemTemplates.flatMap((t) => t.variables))];
// Junta os modelos salvos com os de sistema (os que faltarem voltam com o texto padrão) e informa as variáveis de cada um.
export function mergeTemplates(saved: any[] | undefined): (TemplateDef & { system: boolean })[] {
  const list = Array.isArray(saved) ? saved : [];
  const system = systemTemplates.map((t) => ({
    ...t,
    ...(list.find((s) => s.id === t.id) || {}),
    variables: t.variables,
    system: true,
  }));
  const custom = list
    .filter((s) => !systemTemplates.some((t) => t.id === s.id))
    .map((s) => ({ ...s, variables: allowedVariables, system: false }));
  return [...system, ...custom];
}
export function unknownVariables(content: string, variables: string[]) {
  return [
    ...new Set(
      [...content.matchAll(/\{([a-z_]+)\}/g)]
        .map((m) => m[1])
        .filter((v) => !variables.includes(v)),
    ),
  ];
}
// Texto final: modelo salvo da clínica (ou o padrão do sistema) com as variáveis preenchidas.
export function renderTemplate(
  settings: any,
  id: string,
  values: Record<string, string>,
  fallback?: string,
) {
  const t = mergeTemplates(settings?.templates).find((x) => x.id === id);
  const content = t?.content || fallback || '';
  return content.replace(/\{([a-z_]+)\}/g, (m: string, key: string) =>
    key in values ? values[key] : m,
  );
}
export async function settingsValue(
  c: { query: (sql: string, v: unknown[]) => Promise<{ rows: any[] }> },
  tenantId: string,
) {
  const {
    rows: [r],
  } = await c.query('SELECT value FROM clinic_settings WHERE tenant_id=$1', [tenantId]);
  return r?.value || {};
}
