import { localTime } from '@/lib/timezone';
import { renderTemplate } from './message-templates';
// Mensagem de contato sobre uma sessão (lembrete, token, assinatura, evolução) a partir do modelo da clínica.
export function contactTemplate(
  settings: any,
  id: string,
  patient: any,
  start: Date,
  /** Fuso da unidade da sessão. */
  tz: string,
  fallback: string,
  link = '',
) {
  return renderTemplate(
    settings,
    id,
    {
      responsavel: patient.guardian || '',
      paciente: patient.patient_name || patient.name || '',
      data: start.toLocaleDateString('pt-BR', { timeZone: tz }),
      hora: localTime(start, tz),
      link,
    },
    fallback,
  );
}
