'use client';
import { useState } from 'react';
import { Wallet, LockKeyhole, UserCheck, CheckCircle2 } from 'lucide-react';
import { z } from 'zod';
import { post } from '@/lib/client';
import { currency, type Entity } from '@/lib/types';
import { labels } from '@/lib/schemas';
import { payoutPeriod } from '@/lib/clinic-rules';
import { useClinicRules } from '@/hooks/use-clinic-rules';
import { useNotices } from '@/stores/workspace';
import { MetricCard } from '../molecules/metric-card';
import { DataTable } from '../molecules/data-table';
import { Dialog } from '../molecules/dialog';
import { Button } from '../atoms/button';
import { Badge } from '../atoms/badge';
import { SchemaForm } from './schema-form';
import { downloadCsv } from '@/lib/csv';
import { PayoutMirror } from './payout-mirror';
type ReviewAction = 'SEND' | 'CONFIRM' | 'CONTEST' | 'APPROVE';
export function PayoutBoard({
  rows,
  summary,
  unitId,
  role,
  period,
  onPeriod,
  onProfessional,
  onSaved,
}: {
  rows: Entity[];
  summary: Entity | null;
  unitId: string;
  role: string;
  period: { from: string; to: string };
  onPeriod: (p: { from: string; to: string }) => void;
  onProfessional: (p: Entity) => void;
  onSaved: () => Promise<void>;
}) {
  const rules = useClinicRules(unitId);
  const [review, setReview] = useState<{ row: Entity; action: ReviewAction } | null>(null),
    [busy, setBusy] = useState(''),
    [mirror, setMirror] = useState<Entity | null>(null),
    [draft, setDraft] = useState(period);
  const add = useNotices((s) => s.add),
    manage = ['ADMIN', 'MANAGEMENT', 'FINANCE'].includes(role),
    dates = period.from && period.to ? { period_from: period.from, period_to: period.to } : {};
  const status: Record<string, string> = {
    EMPTY: 'Sem sessões elegíveis',
    INTERNAL: 'Em conferência interna',
    SENT: 'Aguardando conferência do profissional',
    CONFIRMED: 'Conferido pelo profissional',
    CONTESTED: 'Contestado pelo profissional',
    APPROVED: 'Aprovado para pagamento',
  };
  const actionTitle: Record<ReviewAction, string> = {
    SEND: 'Preparar espelho para o profissional',
    CONFIRM: 'Registrar conferência do profissional',
    CONTEST: 'Registrar contestação do espelho',
    APPROVE: 'Aprovar espelho de repasse',
  };
  function actions(r: Entity) {
    if (r.review_status === 'SENT')
      return (
        <div className="actions wrap">
          <Button variant="secondary" onClick={() => setReview({ row: r, action: 'CONFIRM' })}>
            {manage ? 'Registrar conferência' : 'Confirmar meu espelho'}
          </Button>
          <Button variant="danger" onClick={() => setReview({ row: r, action: 'CONTEST' })}>
            Contestar espelho
          </Button>
        </div>
      );
    if (!manage)
      return (
        <Badge
          value={r.review_status === 'APPROVED' ? 'APPROVED' : 'PENDING'}
          label={status[r.review_status]}
        />
      );
    if (r.review_status === 'CONFIRMED')
      return (
        <Button
          variant="secondary"
          disabled={!r.metadata.pj_documents_confirmed}
          title={
            !r.metadata.pj_documents_confirmed
              ? 'Confira os documentos PJ no cadastro profissional.'
              : undefined
          }
          onClick={() => setReview({ row: r, action: 'APPROVE' })}
        >
          Aprovar espelho
        </Button>
      );
    if (r.review_status === 'APPROVED')
      return (
        <Button
          variant="secondary"
          disabled={busy === r.id}
          onClick={async () => {
            setBusy(r.id);
            try {
              await post('professionals/' + r.id + '/payout', { unit_id: unitId, ...dates });
              add('Conta a pagar gerada. Registre o pagamento no financeiro.');
              await onSaved();
            } catch (e) {
              add((e as Error).message, 'error');
            } finally {
              setBusy('');
            }
          }}
        >
          Gerar conta a pagar
        </Button>
      );
    return (
      <Button
        variant="secondary"
        disabled={r.review_status === 'EMPTY'}
        onClick={() => setReview({ row: r, action: 'SEND' })}
      >
        Preparar espelho
      </Button>
    );
  }
  return (
    <>
      <div className="toolbar payout-period">
        <div className="actions wrap">
          <label className="field">
            Período de repasse · início
            <input
              className="input"
              type="date"
              value={draft.from}
              onChange={(e) => setDraft({ ...draft, from: e.target.value })}
            />
          </label>
          <label className="field">
            Fim
            <input
              className="input"
              type="date"
              value={draft.to}
              onChange={(e) => setDraft({ ...draft, to: e.target.value })}
            />
          </label>
          <Button
            variant="secondary"
            disabled={!draft.from || !draft.to || draft.to < draft.from}
            onClick={() => onPeriod(draft)}
          >
            Aplicar período
          </Button>
          <Button
            variant="secondary"
            onClick={() => {
              const next = payoutPeriod(rules);
              setDraft(next);
              onPeriod(next);
            }}
          >
            Fechamento {rules.payout_closing_day + 1} → {rules.payout_closing_day}
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              setDraft({ from: '', to: '' });
              onPeriod({ from: '', to: '' });
            }}
          >
            Todos os pendentes
          </Button>
        </div>
        <small>
          {period.from && period.to
            ? 'Fechamento no período selecionado'
            : 'Sessões concluídas ainda não lançadas no financeiro'}
        </small>
      </div>
      {summary && (
        <div className="metrics payout-metrics">
          <MetricCard
            title="Total a repassar"
            value={currency(summary.total_amount)}
            detail={`${summary.eligible_sessions} sessões elegíveis ainda não lançadas`}
            icon={Wallet}
          />
          <MetricCard
            title="Retido por pendência"
            value={currency(summary.retained_amount)}
            detail={`${summary.retained_sessions} sessões aguardando regularização`}
            icon={LockKeyhole}
          />
          <MetricCard
            title="Conferidos pelo profissional"
            value={summary.confirmed}
            detail="Espelhos conferidos, prontos para aprovação"
            icon={UserCheck}
          />
          <MetricCard
            title="Aprovados"
            value={`${summary.approved} de ${summary.professionals}`}
            detail="Espelhos liberados para gerar conta a pagar"
            icon={CheckCircle2}
          />
        </div>
      )}
      <div className="actions payout-export">
        {manage && (
          <Button
            variant="secondary"
            disabled={!rows.some((r) => r.review_status === 'APPROVED')}
            onClick={() =>
              downloadCsv(
                'repasses-aprovados.csv',
                ['Profissional', 'Período inicial', 'Período final', 'Sessões', 'Valor aprovado'],
                rows
                  .filter((r) => r.review_status === 'APPROVED')
                  .map((r) => [r.name, period.from, period.to, r.sessions, r.amount]),
              )
            }
          >
            Baixar relação de pagamento ({rows.filter((r) => r.review_status === 'APPROVED').length}
            )
          </Button>
        )}
      </div>
      <div className="note">
        Somente atendimentos comprovados entram no espelho. Documentos PJ e conferência são
        obrigatórios para aprovar. O envio ao profissional e o pagamento são registrados
        manualmente.
      </div>
      <DataTable
        rows={rows}
        total={rows.length}
        page={1}
        columns={[
          {
            key: 'name',
            label: 'Profissional',
            render: (r) => (
              <>
                <button className="table-name" onClick={() => setMirror(r)}>
                  {r.name}
                </button>
                <small>{labels[r.specialty] || r.specialty}</small>
              </>
            ),
          },
          { key: 'sessions_60', label: 'Sessões 1 h' },
          { key: 'sessions_30', label: 'Sessões 30 min' },
          {
            key: 'retained_sessions',
            label: 'Retidas',
            render: (r) => (
              <Badge
                value={r.retained_sessions ? 'PENDING' : 'EMPTY'}
                label={String(r.retained_sessions)}
              />
            ),
          },
          { key: 'amount', label: 'Valor', render: (r) => <strong>{currency(r.amount)}</strong> },
          {
            key: 'documents',
            label: 'CNPJ',
            render: (r) => (
              <button className="badge-button" onClick={() => onProfessional(r)}>
                <Badge
                  value={r.metadata.pj_documents_confirmed ? 'APPROVED' : 'REJECTED'}
                  label={r.metadata.pj_documents_confirmed ? 'Conferido' : 'Pendente'}
                />
              </button>
            ),
          },
          {
            key: 'review_status',
            label: 'Espelho',
            render: (r) => (
              <Badge
                value={
                  r.review_status === 'CONTESTED'
                    ? 'REJECTED'
                    : r.review_status === 'SENT'
                      ? 'CONFIRMED'
                      : r.review_status
                }
                label={status[r.review_status]}
              />
            ),
          },
          { key: 'action', label: 'Conferência', render: actions },
        ]}
      />
      {review && (
        <Dialog title={actionTitle[review.action]} onClose={() => setReview(null)}>
          <p>
            <strong>{review.row.name}</strong> · {review.row.sessions} sessões ·{' '}
            {currency(review.row.amount)}
          </p>
          <p className="note">
            {review.action === 'SEND'
              ? 'O espelho ficará disponível para conferência na plataforma. Encaminhe a relação ao profissional manualmente quando necessário.'
              : review.action === 'CONFIRM'
                ? 'Registre a confirmação recebida do profissional somente após a conferência dos valores.'
                : review.action === 'CONTEST'
                  ? 'Descreva a divergência informada pelo profissional. A aprovação permanece bloqueada até nova conferência.'
                  : 'Confirme a aprovação das sessões e do valor conferido. O pagamento continua fora da plataforma.'}
          </p>
          <SchemaForm
            schema={z.object({ reason: z.string().trim().min(10).max(1000) })}
            fields={[
              {
                name: 'reason',
                label:
                  review.action === 'CONFIRM'
                    ? 'Referência da confirmação do profissional'
                    : review.action === 'CONTEST'
                      ? 'Motivo da contestação'
                      : 'Justificativa da operação',
                type: 'textarea',
              },
            ]}
            defaults={{ reason: '' }}
            label={
              {
                SEND: 'Disponibilizar para conferência',
                CONFIRM: 'Confirmar conferência',
                CONTEST: 'Registrar contestação',
                APPROVE: 'Aprovar espelho',
              }[review.action]
            }
            onSubmit={async (d) => {
              await post('professionals/' + review.row.id + '/payout-review', {
                ...d,
                action: review.action,
                snapshot: review.row.snapshot,
                ...dates,
              });
              setReview(null);
              add('Espelho atualizado.');
              await onSaved();
            }}
          />
        </Dialog>
      )}
      {mirror && (
        <PayoutMirror
          row={mirror}
          unitId={unitId}
          role={role}
          period={period}
          onClose={() => setMirror(null)}
          onSaved={onSaved}
        />
      )}
    </>
  );
}
