'use client';
import { createContext, useContext } from 'react';
import type { Lookups, Meta } from '@/lib/types';

// Dados da sessão compartilhados por todas as páginas da área logada.
// Fornecido pelo AppShell (src/app/(app)/layout.tsx); as páginas leem com useWorkspaceContext().

export type WorkspaceContextValue = {
  meta: Meta;
  role: string;
  unitId: string;
  unitName: string;
  lookups: Lookups;
  lookupsReady: boolean;
  /** Aumenta a cada gravação; listas, contadores do menu e cadastros recarregam quando muda. */
  revision: number;
  notifyChange: () => void;
  /** Relê sessão, unidades e regras (após salvar horários e regras em Configurações). */
  refreshMeta: () => Promise<void>;
  signOut: () => Promise<void>;
};

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

export const WorkspaceProvider = WorkspaceContext.Provider;

export function useWorkspaceContext(): WorkspaceContextValue {
  const value = useContext(WorkspaceContext);
  if (!value) throw new Error('useWorkspaceContext precisa estar dentro do AppShell.');
  return value;
}
