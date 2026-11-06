'use client';
import { useEffect, useState } from 'react';
import { ReasonButton } from './record-lifecycle';
import { z } from 'zod';
import { api, post } from '@/lib/client';
import { currency, dateLabel, type Entity } from '@/lib/types';
import { useNotices } from '@/stores/workspace';
import { Dialog } from '../molecules/dialog';
import { DataTable } from '../molecules/data-table';
import { Badge } from '../atoms/badge';
import { Button } from '../atoms/button';
import { SchemaForm } from './schema-form';
import { downloadCsv } from '@/lib/csv';
export function PayoutMirror({
  row,
  unitId,
  period,
  role,
  onClose,
  onSaved,
}: {
  row: Entity;
  unitId: string;
  period: { from: string; to: string };
  role: string;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [data, setData] = useState<any>(null),
    [error, setError] = useState(''),
    [tab, setTab] = useState('composition'),
    [adjust, setAdjust] = useState(false),
    [sending, setSending] = useState(false);
  const add = useNotices((s) => s.add),
    manage = ['ADMIN', 'MANAGEMENT', 'FINANCE'].includes(role);
  async function load() {
    try {
      setData(
        await api(
          'professionals/' +
            row.id +
            '/payout-details' +
            (period.from && period.to ? '?from=' + period.from + '&to=' + period.to : ''),
        ),
      );
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => {
    void load();
  }, [row.id]);
  return (
    <Dialog title={'Espelho de ' + row.name} onClose={onClose} wide>
      {error && <p className="error-banner">{error}</p>}
      {data ? (
        <>
          <p>
            {period.from && period.to
              ? dateLabel(period.from) + ' a ' + dateLabel(period.to)
              : 'Sessões concluídas ainda não vinculadas a uma conta a pagar'}
          </p>
          <div className="tabs">
            <button
              className={tab === 'composition' ? 'active' : ''}
              onClick={() => setTab('composition')}
            >
              Composição
            </button>
            <button className={tab === 'history' ? 'active' : ''} onClick={() => setTab('history')}>
              Histórico de pagamentos
            </button>
          </div>
          {tab === 'history' ? (
            <DataTable
              rows={data.history}
              total={data.history.length}
              page={1}
              columns={[
                { key: 'description', label: 'Repasse' },
                { key: 'due_date', label: 'Vencimento', render: (r) => dateLabel(r.due_date) },
                { key: 'amount', label: 'Valor', render: (r) => currency(r.amount) },
                {
                  key: 'status',
                  label: 'Pagamento',
                  render: (r) => (
                    <Badge
                      value={r.status}
                      label={
                        r.status === 'SETTLED' ? 'Pagamento registrado' : 'Conta a pagar em aberto'
                      }
                    />
                  ),
                },
                {
                  key: 'paid_date',
                  label: 'Data registrada',
                  render: (r) =>
                    r.status === 'SETTLED' && r.paid_date ? dateLabel(r.paid_date) : '—',
                },
              ]}
            />
          ) : (
            <>
              <div className="mini-metrics">
                <div>
                  <strong>{currency(data.current.base_amount)}</strong>
                  <small>Sessões elegíveis</small>
                </div>
                <div>
                  <strong>{currency(data.current.adjustment_amount)}</strong>
                  <small>Ajustes justificados</small>
                </div>
                <div>
                  <strong>{currency(data.current.amount)}</strong>
                  <small>Total do espelho</small>
                </div>
              </div>
              {!data.current.metadata.pj_documents_confirmed && (
                <p className="error-banner">
                  Documentos PJ pendentes. A aprovação está bloqueada até a conferência do CNPJ e da
                  conta PJ.
                </p>
              )}
              {data.review?.contest_reason && (
                <p className="error-banner">
                  Contestação do profissional: {data.review.contest_reason}
                </p>
              )}
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Composição</th>
                      <th>Quantidade</th>
                      <th>Valor unitário</th>
                      <th>Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td>Sessões de 1 hora</td>
                      <td>{data.current.sessions_60}</td>
                      <td>{currency(data.current.hourly_rate)}</td>
                      <td>{currency(data.current.sessions_60 * data.current.hourly_rate)}</td>
                    </tr>
                    <tr>
                      <td>Sessões de 30 min</td>
                      <td>{data.current.sessions_30}</td>
                      <td>
                        {currency(
                          Number(data.current.metadata.session_rate_30) ||
                            data.current.hourly_rate / 2,
                        )}
                      </td>
                      <td>
                        {currency(
                          data.current.sessions_30 *
                            (Number(data.current.metadata.session_rate_30) ||
                              data.current.hourly_rate / 2),
                        )}
                      </td>
                    </tr>
                    {data.current.adjustments.map((a: Entity) => (
                      <tr key={a.id}>
                        <td>
                          Ajuste: {a.reason}
                          {['ADMIN', 'MANAGEMENT', 'FINANCE'].includes(role) &&
                            !a.reverses_id &&
                            !a.reversed && (
                              <ReasonButton
                                label="Estornar"
                                title="Estornar ajuste"
                                description="Cria um ajuste com o valor oposto, ligado a este. Só é possível enquanto o espelho não foi aprovado e o ajuste não entrou em conta a pagar."
                                action="adjustment-reverse"
                                payload={{ id: a.id }}
                                done="Ajuste estornado."
                                onDone={() => void load()}
                              />
                            )}
                        </td>
                        <td>1</td>
                        <td>{currency(a.amount)}</td>
                        <td className={Number(a.amount) < 0 ? 'payout-retained' : ''}>
                          {currency(a.amount)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <h3 className="section-title">Sessões e retenções do período</h3>
              <DataTable
                rows={data.sessions}
                total={data.sessions.length}
                page={1}
                columns={[
                  { key: 'starts_at', label: 'Data', render: (r) => dateLabel(r.starts_at) },
                  { key: 'patient_name', label: 'Paciente' },
                  {
                    key: 'status',
                    label: 'Elegibilidade',
                    render: (r) => (
                      <Badge
                        value={
                          r.audit_status === 'APPROVED' && !r.financial_hold
                            ? 'APPROVED'
                            : 'PENDING'
                        }
                        label={
                          r.financial_hold
                            ? 'Contestada'
                            : r.audit_status === 'APPROVED'
                              ? 'Elegível'
                              : 'Retida pela auditoria'
                        }
                      />
                    ),
                  },
                  { key: 'amount', label: 'Valor da sessão', render: (r) => currency(r.amount) },
                ]}
              />
              <div className="actions wrap">
                <Button
                  variant="secondary"
                  onClick={() =>
                    downloadCsv(
                      'espelho-' + row.name + '.csv',
                      ['Paciente', 'Data', 'Auditoria', 'Bloqueio', 'Valor'],
                      data.sessions.map((a: Entity) => [
                        a.patient_name,
                        a.starts_at,
                        a.audit_status,
                        a.financial_hold ? 'Sim' : 'Não',
                        a.amount,
                      ]),
                    )
                  }
                >
                  Baixar espelho de conferência
                </Button>
                {manage && (
                  <Button
                    variant="secondary"
                    disabled={sending}
                    onClick={async () => {
                      setSending(true);
                      setError('');
                      try {
                        const r = await post<{ to: string; mode: string }>(
                          'professionals/' + row.id + '/payout-mirror-email',
                          { from: period.from || null, to: period.to || null },
                        );
                        add(
                          r.mode === 'SMTP'
                            ? 'Espelho enviado para ' + r.to + '.'
                            : 'Espelho gerado em simulação: veja em Integrações → E-mail.',
                        );
                      } catch (e) {
                        setError((e as Error).message);
                      } finally {
                        setSending(false);
                      }
                    }}
                  >
                    Enviar por e-mail
                  </Button>
                )}
                {manage &&
                  data.current.review_status !== 'APPROVED' &&
                  data.current.sessions > 0 && (
                    <Button variant="secondary" onClick={() => setAdjust(!adjust)}>
                      Aplicar ajuste justificado
                    </Button>
                  )}
              </div>
              {adjust && (
                <SchemaForm
                  schema={z.object({
                    amount: z.coerce
                      .number()
                      .min(-1000000)
                      .max(1000000)
                      .refine((v) => v !== 0, 'Informe valor não nulo.'),
                    reason: z.string().min(10),
                  })}
                  fields={[
                    {
                      name: 'amount',
                      label: 'Valor do ajuste (negativo para desconto)',
                      type: 'number',
                      step: '0.01',
                    },
                    { name: 'reason', label: 'Justificativa do ajuste', type: 'textarea' },
                  ]}
                  defaults={{ amount: '', reason: '' }}
                  label="Registrar ajuste no espelho"
                  onSubmit={async (d) => {
                    await post('professionals/' + row.id + '/payout-review', {
                      action: 'ADJUST',
                      snapshot: data.current.snapshot,
                      ...(period.from && period.to
                        ? { period_from: period.from, period_to: period.to }
                        : {}),
                      ...d,
                    });
                    setAdjust(false);
                    await load();
                    await onSaved();
                    add('Ajuste registrado. O espelho precisa de nova conferência.');
                  }}
                />
              )}
            </>
          )}
        </>
      ) : (
        <p className="loading">Carregando espelho…</p>
      )}
    </Dialog>
  );
}
