'use client';
import { RoleDashboard } from '@/components/organisms/role-dashboard';
import { PageFrame } from '@/components/organisms/page-frame';
import { useWorkspaceContext } from '@/components/templates/workspace-context';
import { useApi } from '@/hooks/use-api';

// Painel inicial com os indicadores do perfil logado.
export function HomePage() {
  const { unitId, role } = useWorkspaceContext();
  const stats = useApi<any>('dashboard?unit=' + unitId);
  return (
    <PageFrame section="inicio" loading={stats.loading} error={stats.error} onRetry={stats.reload}>
      {stats.data && <RoleDashboard stats={stats.data} role={role} />}
    </PageFrame>
  );
}
