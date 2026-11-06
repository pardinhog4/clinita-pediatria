'use client';
import { DEFAULT_TIMEZONE } from './timezone';

// Fuso usado pelas telas: o da unidade selecionada no topo. O AppShell atualiza ao trocar de unidade
// (ou quando as regras mudam). Datas exibidas e horários digitados nos formulários usam este fuso,
// para que a recepção de Manaus veja e marque "09:00" no horário de Manaus.

let current = DEFAULT_TIMEZONE;

export function viewTimezone() {
  return current;
}
export function setViewTimezone(tz: string) {
  current = tz || DEFAULT_TIMEZONE;
}
