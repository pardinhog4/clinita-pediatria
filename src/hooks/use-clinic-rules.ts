'use client';
import { defaultRules, type ClinicRules } from '@/lib/clinic-rules';
import { useWorkspaceContext } from '@/components/templates/workspace-context';

/** Regras configuradas da unidade selecionada (horários, grade, durações, repasse). */
export function useClinicRules(unitId?: string): ClinicRules {
  const { meta, unitId: current } = useWorkspaceContext();
  const id = unitId || current;
  return meta?.units.find((u) => u.id === id)?.rules ?? defaultRules;
}
