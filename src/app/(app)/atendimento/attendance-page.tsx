'use client';
import { useState } from 'react';
import { AttendanceWorkspace } from '@/components/organisms/attendance-workspace';
import { EditorHost, type EditorState } from '@/components/organisms/editor-host';
import { PageFrame } from '@/components/organisms/page-frame';
import { useWorkspaceContext } from '@/components/templates/workspace-context';
import { useRecords } from '@/hooks/use-records';

// Central de conversas do WhatsApp com a equipe e a triagem da IA.
export function AttendancePage() {
  const { unitId, meta, lookupsReady, notifyChange } = useWorkspaceContext();
  const conversations = useRecords('conversations');
  const [editor, setEditor] = useState<EditorState | null>(null);
  return (
    <PageFrame
      section="atendimento"
      loading={conversations.loading}
      error={conversations.error}
      onRetry={conversations.reload}
    >
      <AttendanceWorkspace
        rows={conversations.collection.data}
        unitId={unitId}
        clinical={!!meta.clinical}
        onSaved={notifyChange}
        onCreate={() => setEditor({ resource: 'conversations' })}
        createDisabled={!lookupsReady}
      />
      <EditorHost editor={editor} onClose={() => setEditor(null)} />
    </PageFrame>
  );
}
