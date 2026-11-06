'use client';
import { useEffect, useState } from 'react';
import { Plus } from 'lucide-react';
import { labels } from '@/lib/schemas';
import { dateLabel, timeLabel, type Entity } from '@/lib/types';
import { canOperateFrontDesk } from '@/lib/navigation';
import { Badge } from '@/components/atoms/badge';
import { Button } from '@/components/atoms/button';
import type { Column } from '@/components/molecules/data-table';
import { AbsencesBoard } from '@/components/organisms/absences-board';
import { AgendaBoard } from '@/components/organisms/agenda-board';
import { AppointmentDetail } from '@/components/organisms/appointment-detail';
import { EditorHost, type EditorState } from '@/components/organisms/editor-host';
import { PageFrame } from '@/components/organisms/page-frame';
import { RecordsTable } from '@/components/organisms/records-table';
import { useWorkspaceContext } from '@/components/templates/workspace-context';
import { useRecords } from '@/hooks/use-records';

// Agenda da unidade em lista, dia, semana ou mês, além de faltas, reposições e lista de espera.
// A visão escolhida fica na URL (?view=) para links diretos a partir do painel inicial.

type View = 'list' | 'day' | 'week' | 'month' | 'absences';
const views: [View, string][] = [
  ['list', 'Lista'],
  ['day', 'Dia'],
  ['week', 'Semana panorâmica'],
  ['month', 'Mês'],
  ['absences', 'Faltas e reposições'],
];
const statusOptions: [string, string][] = [
  ['SCHEDULED', 'Agendados'],
  ['ARRIVED', 'Na recepção'],
  ['IN_PROGRESS', 'Em atendimento'],
  ['COMPLETED', 'Realizados'],
  ['ABSENT', 'Faltas'],
  ['CANCELLED', 'Cancelados'],
];

const columns: Column[] = [
  {
    key: 'starts_at',
    label: 'Data / hora',
    render: (r) => (
      <>
        <strong>{dateLabel(r.starts_at)}</strong>
        <small>
          {timeLabel(r.starts_at)} ·{' '}
          {Math.round((new Date(r.ends_at).getTime() - new Date(r.starts_at).getTime()) / 60000)}{' '}
          min
        </small>
      </>
    ),
  },
  { key: 'patient_name', label: 'Paciente', render: (r) => <strong>{r.patient_name}</strong> },
  {
    key: 'professional_name',
    label: 'Profissional',
    render: (r) => (
      <>
        {r.professional_name}
        <small>
          {labels[r.specialty]} · {r.location === 'HOME' ? 'Domicílio' : r.room_name}
        </small>
      </>
    ),
  },
  { key: 'status', label: 'Etapa', render: (r) => <Badge value={r.status} /> },
  {
    key: 'authorization_status',
    label: 'Autorização',
    render: (r) => <Badge value={r.authorization_status} />,
  },
  { key: 'audit_status', label: 'Auditoria', render: (r) => <Badge value={r.audit_status} /> },
];

export function AgendaPage() {
  const { unitId, role, lookups, lookupsReady, revision, notifyChange } = useWorkspaceContext();
  const [view, setView] = useState<View>('list');
  const [status, setStatus] = useState('ALL');
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [appointment, setAppointment] = useState<Entity | null>(null);
  const appointments = useRecords(view === 'list' ? 'appointments' : null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const requested = params.get('view') as View | null;
    if (requested && views.some(([key]) => key === requested)) setView(requested);
    if (params.get('status')) setStatus(params.get('status')!);
  }, []);

  function changeView(next: View) {
    setView(next);
    window.history.replaceState(null, '', next === 'list' ? '/agenda' : '/agenda?view=' + next);
  }

  const book = (preset?: Record<string, any>) => setEditor({ resource: 'appointments', preset });
  const rows =
    status === 'ALL'
      ? appointments.collection.data
      : appointments.collection.data.filter((r) =>
          status === 'PENDING' ? r.audit_status !== 'APPROVED' : r.status === status,
        );

  return (
    <PageFrame
      section="agenda"
      loading={appointments.loading}
      error={appointments.error}
      onRetry={appointments.reload}
      actions={
        canOperateFrontDesk(role) && (
          <Button disabled={!lookupsReady || appointments.loading} onClick={() => book()}>
            <Plus size={17} />
            Novo agendamento
          </Button>
        )
      }
    >
      <div className="toolbar wrap">
        <div className="segmented">
          {views.map(([key, label]) => (
            <Button
              key={key}
              variant={view === key ? 'primary' : 'ghost'}
              onClick={() => changeView(key)}
            >
              {label}
            </Button>
          ))}
        </div>
        {view === 'list' && (
          <select
            className="input"
            aria-label="Filtrar situação"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            <option value="ALL">Todas as situações</option>
            {statusOptions.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        )}
      </div>

      {view === 'list' && (
        <RecordsTable
          records={appointments}
          columns={columns}
          rows={rows}
          onRow={setAppointment}
          searchPlaceholder="Filtre pela situação acima"
          searchDisabled
        />
      )}
      {(view === 'day' || view === 'week' || view === 'month') && (
        <AgendaBoard
          unitId={unitId}
          mode={view}
          refreshKey={revision}
          onOpen={setAppointment}
          onBook={book}
        />
      )}
      {view === 'absences' && (
        <AbsencesBoard unitId={unitId} professionals={lookups.professionals} onBook={book} />
      )}

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
