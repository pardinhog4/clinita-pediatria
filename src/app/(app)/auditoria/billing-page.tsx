'use client';
import { useState } from 'react';
import type { Entity } from '@/lib/types';
import { AppointmentDetail } from '@/components/organisms/appointment-detail';
import { BillingBoard } from '@/components/organisms/billing-board';
import { PageFrame } from '@/components/organisms/page-frame';
import { useWorkspaceContext } from '@/components/templates/workspace-context';

// Auditoria dos atendimentos, lotes TISS por operadora, retorno e glosas.
export function BillingPage() {
  const { unitId, role, revision, notifyChange } = useWorkspaceContext();
  const [appointment, setAppointment] = useState<Entity | null>(null);
  return (
    <PageFrame section="auditoria">
      <BillingBoard unitId={unitId} role={role} refreshKey={revision} onOpen={setAppointment} />
      {appointment && (
        <AppointmentDetail
          row={appointment}
          role={role}
          onClose={() => setAppointment(null)}
          onSaved={notifyChange}
        />
      )}
    </PageFrame>
  );
}
