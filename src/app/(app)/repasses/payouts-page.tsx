'use client';
import { useState } from 'react';
import { Download } from 'lucide-react';
import { downloadCsv } from '@/lib/csv';
import type { Entity } from '@/lib/types';
import { Button } from '@/components/atoms/button';
import { EditorHost, type EditorState } from '@/components/organisms/editor-host';
import { PageFrame } from '@/components/organisms/page-frame';
import { PayoutBoard } from '@/components/organisms/payout-board';
import { ProfessionalRecord } from '@/components/organisms/professional-record';
import { useWorkspaceContext } from '@/components/templates/workspace-context';
import { useApi } from '@/hooks/use-api';

// Repasses dos profissionais PJ por período: sessões elegíveis, espelho e registro de pagamento.
export function PayoutsPage() {
  const { unitId, role, notifyChange } = useWorkspaceContext();
  const [period, setPeriod] = useState({ from: '', to: '' });
  const [professional, setProfessional] = useState<Entity | null>(null);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const range = period.from && period.to ? `&from=${period.from}&to=${period.to}` : '';
  const payouts = useApi<{ data: Entity[]; summary: Entity }>('payouts?unit=' + unitId + range);
  const rows = payouts.data?.data ?? [];

  return (
    <PageFrame
      section="repasses"
      loading={payouts.loading}
      error={payouts.error}
      onRetry={payouts.reload}
      actions={
        <Button
          variant="secondary"
          onClick={() =>
            downloadCsv(
              'integrar-repasses.csv',
              ['Profissional', 'Sessões elegíveis', 'Valor'],
              rows.map((r) => [r.name, r.sessions, r.amount]),
            )
          }
        >
          <Download size={16} />
          Exportar página CSV
        </Button>
      }
    >
      <PayoutBoard
        rows={rows}
        summary={payouts.data?.summary ?? null}
        unitId={unitId}
        role={role}
        period={period}
        onPeriod={setPeriod}
        onProfessional={setProfessional}
        onSaved={async () => notifyChange()}
      />
      {professional && (
        <ProfessionalRecord
          professional={professional}
          unitId={unitId}
          role={role}
          onClose={() => setProfessional(null)}
          onEdit={(entity) => {
            setEditor({ resource: 'professionals', entity });
            setProfessional(null);
          }}
          onSaved={notifyChange}
        />
      )}
      <EditorHost editor={editor} onClose={() => setEditor(null)} />
    </PageFrame>
  );
}
