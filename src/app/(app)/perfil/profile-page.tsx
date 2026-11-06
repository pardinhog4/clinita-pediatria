'use client';
import { ProfilePanel } from '@/components/organisms/profile-panel';
import { PageFrame } from '@/components/organisms/page-frame';
import { useWorkspaceContext } from '@/components/templates/workspace-context';

// Dados pessoais, troca de senha e dispositivos conectados.
export function ProfilePage() {
  const { signOut } = useWorkspaceContext();
  return (
    <PageFrame section="perfil">
      <ProfilePanel onSignOut={signOut} />
    </PageFrame>
  );
}
