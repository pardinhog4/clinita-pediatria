import { viewTimezone } from './view-timezone';
import type { ClinicRules } from './clinic-rules';
export type Entity = { id: string; version: number; [key: string]: any };
export type Collection = { data: Entity[]; total: number; page: number; limit: number };
export type Meta = {
  user: {
    name: string;
    role: string;
    tenantId: string;
    userId: string;
    mustChangePassword?: boolean;
  };
  /** rules já combina clínica + unidade; own_hours indica horário próprio da unidade. */
  units: {
    id: string;
    name: string;
    rules: ClinicRules;
    own_hours: boolean;
    own_timezone: boolean;
  }[];
  clinical: boolean;
  financial: boolean;
  sessionMethod?: string;
  specialties: { code: string; name: string; shared_room: boolean; active: boolean }[];
};
export const statusLabels: Record<string, string> = {
  SCHEDULED: 'Agendado',
  ARRIVED: 'Na recepção',
  IN_PROGRESS: 'Em atendimento',
  COMPLETED: 'Realizado',
  ABSENT: 'Falta',
  CANCELLED: 'Cancelado',
  PENDING: 'Pendente',
  APPROVED: 'Aprovado',
  RETURNED: 'Devolvido',
  OPEN: 'Em aberto',
  SETTLED: 'Baixado',
  WAITING: 'Aguardando',
  HUMAN: 'Com a equipe',
  REVIEW: 'Em revisão',
  DONE: 'Concluído',
  MANUAL: 'Conferido manualmente',
  HIGH: 'Alta',
  NORMAL: 'Normal',
};
export const currency = (v: unknown) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(v) || 0);
export const dateLabel = (v: string) =>
  v.length === 10
    ? new Date(v + 'T12:00:00').toLocaleDateString('pt-BR')
    : new Date(v).toLocaleDateString('pt-BR', { timeZone: viewTimezone() });
export const timeLabel = (v: string) =>
  new Date(v).toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: viewTimezone(),
  });

/** Cadastros da unidade usados nos formulários (selects de paciente, profissional, convênio e sala). */
export type Lookups = {
  patients: Entity[];
  professionals: Entity[];
  insurers: Entity[];
  rooms: Entity[];
};
