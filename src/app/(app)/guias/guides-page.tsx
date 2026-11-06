'use client';
import { useState } from 'react';
import type { Entity } from '@/lib/types';
import { AppointmentDetail } from '@/components/organisms/appointment-detail';
import { EditorHost, type EditorState } from '@/components/organisms/editor-host';
import { GuidesBoard } from '@/components/organisms/guides-board';
import { PageFrame } from '@/components/organisms/page-frame';
import { useWorkspaceContext } from '@/components/templates/workspace-context';

// Autorizações, tokens, assinaturas de guia e créditos de reposição.
export function GuidesPage() {
  const { unitId, role, revision, notifyChange } = useWorkspaceContext();
  const [appointment, setAppointment] = useState<Entity | null>(null);
  const [editor, setEditor] = useState<EditorState | null>(null);
  return (
    <PageFrame section="guias">
      <GuidesBoard
        unitId={unitId}
        role={role}
        refreshKey={revision}
        onOpen={setAppointment}
        onBook={(preset) => setEditor({ resource: 'appointments', preset })}
      />
      {appointment && (
        <AppointmentDetail
          row={appointment}
          role={role}
          onClose={() => setAppointment(null)}
          onSaved={notifyChange}
        />
      )}
      <EditorHost editor={editor} onClose={() => setEditor(null)} />
    </PageFrame>
  );
}
