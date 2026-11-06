'use client';
import { UsersBoard } from '@/components/organisms/users-board';
import { PageFrame } from '@/components/organisms/page-frame';

// Contas de acesso, perfis e unidades de cada pessoa da equipe.
export function UsersPage() {
  return (
    <PageFrame section="usuarios">
      <UsersBoard />
    </PageFrame>
  );
}
