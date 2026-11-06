import {
  Activity,
  Bot,
  CalendarDays,
  History,
  Home,
  Inbox,
  KeyRound,
  MessageCircle,
  Plug,
  Search,
  Settings,
  ShieldCheck,
  Stethoscope,
  UserCog,
  Users,
  Wallet,
  type LucideIcon,
} from 'lucide-react';

// Mapa de páginas da área logada: rota, título, descrição, ícone do menu e perfis com acesso.
// Cada rota tem sua própria pasta em src/app/(app)/<rota>/page.tsx.

export type Section =
  | 'inicio'
  | 'atendimento'
  | 'encaminhamentos'
  | 'agenda'
  | 'buscar-horarios'
  | 'pacientes'
  | 'profissionais'
  | 'guias'
  | 'auditoria'
  | 'repasses'
  | 'financeiro'
  | 'agentes'
  | 'integracoes'
  | 'usuarios'
  | 'configuracoes'
  | 'auditoria-log'
  | 'perfil';

export const sectionInfo: Record<Section, { title: string; description: string }> = {
  inicio: {
    title: 'Visão da clínica',
    description: 'Acompanhe os atendimentos e as prioridades da sua unidade.',
  },
  atendimento: {
    title: 'Central de atendimento',
    description: 'Conversas, responsáveis e encaminhamento da equipe.',
  },
  encaminhamentos: {
    title: 'Encaminhamentos',
    description:
      'Serviços pedidos nos laudos, com o profissional sugerido pela IA e o que precisa da coordenação clínica.',
  },
  agenda: {
    title: 'Agenda multiprofissional',
    description: 'Uma visão compartilhada do cuidado, com disponibilidade real.',
  },
  'buscar-horarios': {
    title: 'Buscar horários',
    description: 'Encontre profissionais e horários para a necessidade do paciente.',
  },
  pacientes: { title: 'Pacientes', description: 'Cadastros, prontuários e histórico de cuidado.' },
  profissionais: {
    title: 'Profissionais',
    description: 'Equipe, competências e vínculos por unidade.',
  },
  guias: {
    title: 'Guias e tokens',
    description: 'Autorizações, assinaturas, créditos e contestação de atendimentos.',
  },
  auditoria: {
    title: 'Faturamento TISS',
    description: 'Auditoria, lotes por operadora, retorno e glosas.',
  },
  repasses: {
    title: 'Repasses PJ',
    description: 'Conferência de sessões aprovadas e registro manual de pagamento.',
  },
  financeiro: {
    title: 'Financeiro',
    description: 'Contas a pagar e receber, registros manuais e materiais.',
  },
  agentes: {
    title: 'Agentes e IA',
    description: 'Instruções, conhecimento e versões por clínica.',
  },
  integracoes: {
    title: 'Integrações',
    description: 'Conectores previstos e dependências para os próximos passos.',
  },
  usuarios: {
    title: 'Usuários e acessos',
    description: 'Quem entra na plataforma, com qual perfil e em quais unidades.',
  },
  configuracoes: {
    title: 'Configurações',
    description:
      'Unidades, especialidades, competências, filas, convênios, salas e instrumentos da clínica.',
  },
  'auditoria-log': {
    title: 'Log de auditoria',
    description: 'Quem fez, quando e o registro afetado.',
  },
  perfil: {
    title: 'Meu perfil',
    description: 'Seus dados, sua senha e os dispositivos conectados à sua conta.',
  },
};

export const navigation: {
  label: string;
  items: { section: Section; label: string; icon: LucideIcon }[];
}[] = [
  {
    label: 'ATENDIMENTO E AGENDA',
    items: [
      { section: 'inicio', label: 'Início', icon: Home },
      { section: 'atendimento', label: 'WhatsApp', icon: MessageCircle },
      { section: 'encaminhamentos', label: 'Encaminhamentos', icon: Inbox },
      { section: 'agenda', label: 'Agenda', icon: CalendarDays },
      { section: 'buscar-horarios', label: 'Buscar horários', icon: Search },
    ],
  },
  {
    label: 'GESTÃO CLÍNICA',
    items: [
      { section: 'pacientes', label: 'Pacientes', icon: Users },
      { section: 'profissionais', label: 'Profissionais', icon: Stethoscope },
    ],
  },
  {
    label: 'GUIAS, AUDITORIA E REPASSES',
    items: [
      { section: 'guias', label: 'Guias e tokens', icon: KeyRound },
      { section: 'auditoria', label: 'Faturamento TISS', icon: ShieldCheck },
      { section: 'repasses', label: 'Repasses PJ', icon: Wallet },
    ],
  },
  {
    label: 'GESTÃO',
    items: [
      { section: 'financeiro', label: 'Financeiro', icon: Activity },
      { section: 'agentes', label: 'Agentes e IA', icon: Bot },
      { section: 'integracoes', label: 'Integrações', icon: Plug },
      { section: 'usuarios', label: 'Usuários e acessos', icon: UserCog },
      { section: 'configuracoes', label: 'Configurações', icon: Settings },
      { section: 'auditoria-log', label: 'Log de auditoria', icon: History },
    ],
  },
];

const roleSections: Record<string, Section[] | '*'> = {
  ADMIN: '*',
  MANAGEMENT: '*',
  RECEPTION: [
    'inicio',
    'atendimento',
    'encaminhamentos',
    'agenda',
    'buscar-horarios',
    'pacientes',
    'profissionais',
    'guias',
  ],
  CLINICIAN: ['inicio', 'encaminhamentos', 'agenda', 'pacientes', 'profissionais', 'repasses'],
  AUDIT: ['inicio', 'pacientes', 'profissionais', 'guias', 'auditoria'],
  FINANCE: ['inicio', 'auditoria', 'repasses', 'financeiro'],
};

export const roleLabels: Record<string, string> = {
  ADMIN: 'Direção clínica',
  MANAGEMENT: 'Gestão da clínica',
  RECEPTION: 'Recepção',
  CLINICIAN: 'Profissional de saúde',
  AUDIT: 'Auditoria',
  FINANCE: 'Financeiro',
};

export function isSection(value: string): value is Section {
  return value in sectionInfo;
}

/** O perfil é sempre acessível; as demais páginas dependem do papel do usuário. */
export function sectionAllowed(section: string, role: string): boolean {
  if (section === 'perfil') return true;
  const allowed = roleSections[role];
  if (!allowed) return false;
  return allowed === '*' || allowed.includes(section as Section);
}

/** Perfis que cadastram pacientes e agendamentos. */
export const canOperateFrontDesk = (role: string) =>
  ['ADMIN', 'MANAGEMENT', 'RECEPTION'].includes(role);

/** Perfis que administram cadastros da clínica (profissionais, agentes, convênios, salas). */
export const canManageClinic = (role: string) => ['ADMIN', 'MANAGEMENT'].includes(role);

/** Título da aba do navegador para cada página. */
export function pageTitle(section: Section): string {
  return sectionInfo[section].title + ' · Integrar';
}
