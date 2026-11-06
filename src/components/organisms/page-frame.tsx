'use client';
import type { ReactNode } from 'react';
import { RefreshCw } from 'lucide-react';
import { sectionInfo, type Section } from '@/lib/navigation';
import { Button } from '../atoms/button';
import { PageHeader } from '../molecules/page-header';
import { useWorkspaceContext } from '../templates/workspace-context';

// Cabeçalho padrão de toda página: trilha, título, descrição, ações, erro e carregamento.
export function PageFrame({
  section,
  actions,
  error,
  loading,
  onRetry,
  children,
}: {
  section: Section;
  actions?: ReactNode;
  error?: string;
  loading?: boolean;
  onRetry?: () => void;
  children?: ReactNode;
}) {
  const { unitName } = useWorkspaceContext();
  const { title, description } = sectionInfo[section];
  return (
    <>
      <div className="breadcrumb">
        Integrar <span>/</span> {unitName} <span>/</span> {title}
      </div>
      <PageHeader title={title} description={description} actions={actions} />
      {error && (
        <div className="error-banner" role="alert">
          {error}
          {onRetry && (
            <Button variant="ghost" onClick={onRetry}>
              Tentar novamente
            </Button>
          )}
        </div>
      )}
      {loading && (
        <div className="loading">
          <RefreshCw className="spin" size={18} />
          Carregando dados da unidade…
        </div>
      )}
      {children}
    </>
  );
}
