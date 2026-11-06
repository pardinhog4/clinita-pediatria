'use client';
import type { Entity } from '@/lib/types';
import { EntityEditor } from './entity-editor';
import { useWorkspaceContext } from '../templates/workspace-context';

export type EditorState = { resource: string; entity?: Entity; preset?: Record<string, any> };

// Abre o formulário de cadastro/edição com os cadastros da unidade e avisa as telas ao salvar.
export function EditorHost({
  editor,
  onClose,
}: {
  editor: EditorState | null;
  onClose: () => void;
}) {
  const { unitId, lookups, notifyChange } = useWorkspaceContext();
  if (!editor) return null;
  return (
    <EntityEditor
      key={editor.resource + editor.entity?.id}
      {...editor}
      unitId={unitId}
      lookups={lookups}
      onClose={onClose}
      onSaved={notifyChange}
    />
  );
}
