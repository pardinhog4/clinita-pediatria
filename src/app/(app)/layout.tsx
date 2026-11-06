import type { ReactNode } from 'react';
import { AppShell } from '@/components/templates/app-shell';

// Layout de todas as páginas da área logada: menu lateral, barra superior e sessão.
export default function AuthenticatedLayout({ children }: { children: ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
