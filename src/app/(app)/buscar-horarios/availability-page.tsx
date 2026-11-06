'use client';
import { useState } from 'react';
import { Plus } from 'lucide-react';
import { Button } from '@/components/atoms/button';
import { Availability } from '@/components/organisms/availability';
import { EditorHost, type EditorState } from '@/components/organisms/editor-host';
import { PageFrame } from '@/components/organisms/page-frame';
import { useWorkspaceContext } from '@/components/templates/workspace-context';
import { canOperateFrontDesk } from '@/lib/navigation';

// Busca de horários livres por especialidade, duração e data.
export function AvailabilityPage() {
  const { unitId, role, lookupsReady } = useWorkspaceContext();
  const [editor, setEditor] = useState<EditorState | null>(null);
  const book = (preset?: Record<string, any>) => setEditor({ resource: 'appointments', preset });
  return (
    <PageFrame
      section="buscar-horarios"
      actions={
        canOperateFrontDesk(role) && (
          <Button disabled={!lookupsReady} onClick={() => book()}>
            <Plus size={17} />
            Novo agendamento
          </Button>
        )
      }
    >
      <Availability unitId={unitId} onBook={book} />
      <EditorHost editor={editor} onClose={() => setEditor(null)} />
    </PageFrame>
  );
}
