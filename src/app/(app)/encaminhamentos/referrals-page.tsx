'use client';
import { ReferralInbox } from '@/components/organisms/referral-inbox';
import { PageFrame } from '@/components/organisms/page-frame';
import { useWorkspaceContext } from '@/components/templates/workspace-context';

// Itens de encaminhamento por profissional e caixa da coordenação clínica.
export function ReferralsPage() {
  const { unitId, role } = useWorkspaceContext();
  return (
    <PageFrame section="encaminhamentos">
      <ReferralInbox unitId={unitId} role={role} />
    </PageFrame>
  );
}
