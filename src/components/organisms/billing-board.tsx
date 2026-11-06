'use client';
import { useEffect, useState } from 'react';
import { ReasonButton } from './record-lifecycle';
import { ShieldCheck, AlertCircle, UserX, Files, Download, Send, RefreshCw } from 'lucide-react';
import { z } from 'zod';
import { api, post } from '@/lib/client';
import { currency, dateLabel, timeLabel, type Entity } from '@/lib/types';
import { useNotices } from '@/stores/workspace';
import { MetricCard } from '../molecules/metric-card';
import { DataTable } from '../molecules/data-table';
import { Dialog } from '../molecules/dialog';
import { Button } from '../atoms/button';
import { Badge } from '../atoms/badge';
import { SchemaForm } from './schema-form';
import { downloadCsv } from '@/lib/csv';
export function BillingBoard({
  unitId,
  role,
  refreshKey,
  onOpen,
}: {
  unitId: string;
  role: string;
  refreshKey: number;
  onOpen: (a: Entity) => void;
}) {
  const [data, setData] = useState<any>(null),
    [tab, setTab] = useState('ready'),
    [insurer, setInsurer] = useState(''),
    [selected, setSelected] = useState<string[]>([]),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [confirm, setConfirm] = useState(false),
    [batch, setBatch] = useState<Entity | null>(null),
    [returnBatch, setReturnBatch] = useState<Entity | null>(null),
    [sendBatch, setSendBatch] = useState<Entity | null>(null),
    [returnValues, setReturnValues] = useState<
      Record<string, { paid_amount: string; reason: string }>
    >({}),
    [reference, setReference] = useState(''),
    [received, setReceived] = useState(new Date().toLocaleDateString('sv-SE')),
    [confirmed, setConfirmed] = useState(false);
  const add = useNotices((s) => s.add),
    canAudit = ['ADMIN', 'MANAGEMENT', 'AUDIT'].includes(role);
  async function load() {
    try {
      setData(await api('billing?unit=' + unitId));
      setError('');
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => {
    setSelected([]);
    void load();
  }, [unitId, refreshKey]);
  const allSessions = data
      ? [...data.ready, ...data.pending, ...data.returned, ...data.absent, ...data.in_batch]
      : [],
    insurers = Array.from(
      new Map<string, string>(
        allSessions.map((a: Entity) => [a.insurer_id, a.insurer_name]),
      ).entries(),
    ),
    filtered = (rows: Entity[]) => (insurer ? rows.filter((a) => a.insurer_id === insurer) : rows),
    rows = data && Array.isArray(data[tab]) ? filtered(data[tab]) : [],
    chosen = data?.ready.filter((a: Entity) => selected.includes(a.id)) || [];
  async function act(operation: string, values: Record<string, any>) {
    setBusy(true);
    try {
      const result = await post('operations', { operation, unit_id: unitId, ...values });
      setSelected([]);
      setConfirm(false);
      setSendBatch(null);
      setReturnBatch(null);
      await load();
      add(result.message || 'Faturamento atualizado.');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function startReturn(b: Entity) {
    setReturnBatch(b);
    setReference('');
    setConfirmed(false);
    setReturnValues(
      Object.fromEntries(
        data.items
          .filter((i: Entity) => i.batch_id === b.id && i.status === 'WAITING')
          .map((i: Entity) => [i.id, { paid_amount: String(i.amount), reason: '' }]),
      ),
    );
  }
  return (
    <>
      {error && (
        <div className="error-banner" role="alert">
          {error}
          <Button variant="ghost" onClick={() => setError('')}>
            Fechar
          </Button>
        </div>
      )}
      {!data ? (
        <p className="loading">Carregando faturamento TISS…</p>
      ) : (
        <>
          <div className="metrics operational-metrics">
            <MetricCard
              title="Prontos para o lote"
              value={filtered(data.ready).length}
              detail={currency(filtered(data.ready).reduce((s, a) => s + Number(a.amount), 0))}
              icon={ShieldCheck}
            />
            <MetricCard
              title="Com pendência"
              value={filtered(data.pending).length}
              detail={
                currency(filtered(data.pending).reduce((s, a) => s + Number(a.amount), 0)) +
                ' em risco de glosa'
              }
              icon={AlertCircle}
            />
            <MetricCard
              title="Faltas"
              value={filtered(data.absent).length}
              detail="Fora do faturamento"
              icon={UserX}
            />
            <MetricCard
              title="Já em lote"
              value={filtered(data.in_batch).length}
              detail={currency(filtered(data.in_batch).reduce((s, a) => s + Number(a.amount), 0))}
              icon={Files}
            />
          </div>
          <div className="toolbar">
            <label className="field">
              Operadora
              <select
                className="input"
                aria-label="Filtrar operadora TISS"
                value={insurer}
                onChange={(e) => {
                  setInsurer(e.target.value);
                  setSelected([]);
                }}
              >
                <option value="">Todas as operadoras</option>
                {insurers.map(([id, name]) => (
                  <option key={id} value={id}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
            <Button variant="secondary" onClick={() => void load()}>
              <RefreshCw size={15} />
              Atualizar
            </Button>
          </div>
          <div className="tabs" role="tablist" aria-label="Filas do faturamento">
            {[
              ['ready', 'Prontos'],
              ['pending', 'Com pendência'],
              ['returned', 'Devolvidos'],
              ['absent', 'Faltas'],
              ['in_batch', 'Em lote'],
              ['returns', 'Retorno das operadoras'],
            ].map(([key, label]) => (
              <button
                key={key}
                role="tab"
                aria-selected={tab === key}
                className={tab === key ? 'active' : ''}
                onClick={() => {
                  setTab(key);
                  setSelected([]);
                }}
              >
                {label}
                <span className="tab-count">
                  {key === 'returns'
                    ? data.batches.filter((b: Entity) => !insurer || b.insurer_id === insurer)
                        .length
                    : filtered(data[key]).length}
                </span>
              </button>
            ))}
          </div>
          {tab === 'returns' ? (
            <>
              <DataTable
                rows={data.batches.filter((b: Entity) => !insurer || b.insurer_id === insurer)}
                total={data.batches.length}
                page={1}
                columns={[
                  { key: 'number', label: 'Lote' },
                  { key: 'insurer_name', label: 'Operadora' },
                  {
                    key: 'sent_at',
                    label: 'Enviado',
                    render: (r) => (r.sent_at ? dateLabel(r.sent_at) : 'Envio não registrado'),
                  },
                  {
                    key: 'status',
                    label: 'Retorno',
                    render: (r) => (
                      <Badge
                        value={
                          r.status === 'RETURNED'
                            ? 'APPROVED'
                            : r.status === 'SENT'
                              ? 'PENDING'
                              : 'PREPARED'
                        }
                        label={
                          r.status === 'RETURNED'
                            ? 'Retorno registrado'
                            : r.status === 'SENT'
                              ? 'Aguardando retorno'
                              : 'Preparado'
                        }
                      />
                    ),
                  },
                  { key: 'items', label: 'Guias' },
                  { key: 'paid', label: 'Pagas' },
                  {
                    key: 'denied',
                    label: 'Glosadas',
                    render: (r) => (
                      <Badge value={r.denied ? 'REJECTED' : 'EMPTY'} label={String(r.denied)} />
                    ),
                  },
                  {
                    key: 'denied_amount',
                    label: 'Valor glosado',
                    render: (r) => currency(r.denied_amount),
                  },
                  {
                    key: 'action',
                    label: 'Conferência',
                    render: (r) => (
                      <Button
                        variant="secondary"
                        disabled={r.status !== 'SENT'}
                        onClick={() => startReturn(r)}
                      >
                        Registrar demonstrativo
                      </Button>
                    ),
                  },
                ]}
              />
              <div className="card">
                <h2>Glosas para analisar</h2>
                {data.items
                  .filter(
                    (i: Entity) =>
                      ['PARTIAL', 'DENIED'].includes(i.status) &&
                      (!insurer ||
                        data.batches.some(
                          (b: Entity) => b.id === i.batch_id && b.insurer_id === insurer,
                        )),
                  )
                  .map((i: Entity) => (
                    <div key={i.id} className="timeline-item actions between">
                      <div>
                        <strong>
                          {i.batch_number} · {i.snapshot.patient_name}
                        </strong>
                        <small>{i.denial_reason}</small>
                      </div>
                      <Badge
                        value="REJECTED"
                        label={currency(Number(i.amount) - Number(i.paid_amount))}
                      />
                    </div>
                  ))}
                {!data.items.some((i: Entity) => ['PARTIAL', 'DENIED'].includes(i.status)) && (
                  <p className="empty">Nenhuma glosa registrada.</p>
                )}
              </div>
            </>
          ) : (
            <>
              {tab === 'ready' && canAudit && (
                <div className="toolbar">
                  <span className="small muted">
                    {selected.length} selecionados ·{' '}
                    {currency(chosen.reduce((s: number, a: Entity) => s + Number(a.amount), 0))}
                  </span>
                  <div className="actions wrap">
                    <Button
                      variant="secondary"
                      onClick={() => setSelected(rows.map((a) => a.id))}
                      disabled={!rows.length}
                    >
                      Selecionar todos ({rows.length})
                    </Button>
                    <Button disabled={!selected.length || busy} onClick={() => setConfirm(true)}>
                      Preparar lote TISS
                    </Button>
                  </div>
                </div>
              )}
              {tab === 'pending' && canAudit && (
                <div className="toolbar">
                  <span className="small muted">
                    Cobrança de evoluções registrada na fila interna de solicitações.
                  </span>
                  <Button
                    variant="secondary"
                    disabled={
                      busy || !rows.some((a) => a.status === 'IN_PROGRESS' && !a.evolution_recorded)
                    }
                    onClick={() =>
                      void act('REQUEST', {
                        kind: 'EVOLUTION',
                        appointment_ids: rows
                          .filter((a) => a.status === 'IN_PROGRESS' && !a.evolution_recorded)
                          .map((a) => a.id),
                      })
                    }
                  >
                    <Send size={14} />
                    Avisar profissionais
                  </Button>
                </div>
              )}
              <DataTable
                rows={rows}
                total={rows.length}
                page={1}
                columns={[
                  ...(tab === 'ready' && canAudit
                    ? [
                        {
                          key: 'select',
                          label: 'Selecionar',
                          render: (r: Entity) => (
                            <input
                              type="checkbox"
                              aria-label={'Selecionar atendimento de ' + r.patient_name}
                              checked={selected.includes(r.id)}
                              onChange={(e) =>
                                setSelected(
                                  e.target.checked
                                    ? [...selected, r.id]
                                    : selected.filter((id) => id !== r.id),
                                )
                              }
                            />
                          ),
                        },
                      ]
                    : []),
                  {
                    key: 'starts_at',
                    label: 'Data',
                    render: (r) => (
                      <>
                        {dateLabel(r.starts_at)}
                        <small>
                          {timeLabel(r.starts_at)} · {r.duration} min
                        </small>
                      </>
                    ),
                  },
                  {
                    key: 'patient_name',
                    label: 'Paciente',
                    render: (r) => <strong>{r.patient_name}</strong>,
                  },
                  { key: 'professional_name', label: 'Profissional' },
                  { key: 'insurer_name', label: 'Operadora' },
                  {
                    key: 'evidence',
                    label: 'Provas',
                    render: (r) => (
                      <div className="evidence-dots">
                        <span title="Chegada" className={r.arrived_at ? 'ok' : 'pending'}>
                          C
                        </span>
                        <span
                          title="Autorização"
                          className={
                            r.authorization_type === 'TOKEN'
                              ? r.authorization_status === 'MANUAL'
                                ? 'ok'
                                : 'pending'
                              : r.authorization_type === 'GUIDE'
                                ? r.signature_evidence
                                  ? 'ok'
                                  : 'pending'
                                : 'ok'
                          }
                        >
                          A
                        </span>
                        <span title="Evolução" className={r.evolution_recorded ? 'ok' : 'pending'}>
                          E
                        </span>
                      </div>
                    ),
                  },
                  {
                    key: 'situation',
                    label: 'Situação',
                    render: (r) =>
                      r.batch_number ? (
                        <Badge value="APPROVED" label={r.batch_number} />
                      ) : r.financial_hold ? (
                        <Badge value="REJECTED" label="Contestação / bloqueio" />
                      ) : r.gaps.length ? (
                        <span className="payout-retained">{r.gaps.join(' · ')}</span>
                      ) : r.audit_status === 'APPROVED' ? (
                        <Badge value="APPROVED" label="Apto" />
                      ) : (
                        <Badge value="PENDING" label="Aguardar auditoria" />
                      ),
                  },
                  { key: 'amount', label: 'Valor', render: (r) => currency(r.amount) },
                  {
                    key: 'action',
                    label: 'Conferência',
                    render: (r) => (
                      <Button variant="secondary" onClick={() => onOpen(r)}>
                        Abrir sessão
                      </Button>
                    ),
                  },
                ]}
              />
            </>
          )}
          <div className="section-title actions between">
            <h2>Lotes TISS</h2>
            <small>Um lote por operadora · preparação e envio manual</small>
          </div>
          <DataTable
            rows={data.batches.filter((b: Entity) => !insurer || b.insurer_id === insurer)}
            total={data.batches.length}
            page={1}
            columns={[
              { key: 'number', label: 'Lote' },
              { key: 'insurer_name', label: 'Operadora' },
              { key: 'created_at', label: 'Preparado em', render: (r) => dateLabel(r.created_at) },
              { key: 'items', label: 'Guias' },
              { key: 'amount', label: 'Valor', render: (r) => currency(r.amount) },
              {
                key: 'status',
                label: 'Situação',
                render: (r) => (
                  <Badge
                    value={
                      r.status === 'RETURNED'
                        ? 'APPROVED'
                        : r.status === 'SENT'
                          ? 'CONFIRMED'
                          : 'PENDING'
                    }
                    label={
                      r.status === 'RETURNED'
                        ? 'Retorno registrado'
                        : r.status === 'SENT'
                          ? 'Envio manual registrado'
                          : 'Preparado para conferência'
                    }
                  />
                ),
              },
              {
                key: 'action',
                label: 'Ações',
                render: (r) => (
                  <div className="actions wrap">
                    <Button variant="secondary" onClick={() => setBatch(r)}>
                      Conferir lote
                    </Button>
                    {canAudit && r.status === 'PREPARED' && (
                      <Button variant="ghost" onClick={() => setSendBatch(r)}>
                        Registrar envio
                      </Button>
                    )}
                  </div>
                ),
              },
            ]}
          />
        </>
      )}
      {confirm && (
        <Dialog title="Preparar lotes por operadora" onClose={() => setConfirm(false)}>
          <p>
            Serão preparados {new Set(chosen.map((a: Entity) => a.insurer_id)).size} lote(s), com{' '}
            {chosen.length} sessões e{' '}
            {currency(chosen.reduce((s: number, a: Entity) => s + Number(a.amount), 0))}.
          </p>
          <p className="note">
            Os atendimentos ficam vinculados aos lotes para impedir duplicidade. Esta ação não envia
            arquivos à operadora.
          </p>
          <div className="actions">
            <Button variant="secondary" onClick={() => setConfirm(false)}>
              Cancelar
            </Button>
            <Button
              disabled={busy}
              onClick={() => void act('BATCH_CREATE', { appointment_ids: selected })}
            >
              Confirmar preparação
            </Button>
          </div>
        </Dialog>
      )}
      {batch && (
        <Dialog title={'Lote ' + batch.number} onClose={() => setBatch(null)} wide>
          <p>
            {batch.insurer_name} · {batch.items} guias · {currency(batch.amount)}
          </p>
          <p className="note">{data.xml.message}</p>
          <div className="actions wrap">
            <Button
              variant="secondary"
              onClick={() =>
                downloadCsv(
                  batch.number + '-conferencia.csv',
                  [
                    'Guia interna',
                    'Paciente',
                    'Carteirinha',
                    'Profissional',
                    'Início',
                    'Fim',
                    'Valor',
                  ],
                  data.items
                    .filter((i: Entity) => i.batch_id === batch.id)
                    .map((i: Entity) => [
                      i.id,
                      i.snapshot.patient_name,
                      i.snapshot.card_number,
                      i.snapshot.professional_name,
                      i.snapshot.starts_at,
                      i.snapshot.ends_at,
                      i.amount,
                    ]),
                )
              }
            >
              <Download size={15} />
              Baixar relação de conferência
            </Button>
            <Button variant="secondary" disabled title={data.xml.message}>
              XML TISS · parametrização pendente
            </Button>
          </div>
          {data.items
            .filter((i: Entity) => i.batch_id === batch.id)
            .map((i: Entity) => (
              <div className="timeline-item actions between" key={i.id}>
                <div>
                  <strong>{i.snapshot.patient_name}</strong>
                  <small>
                    {i.snapshot.professional_name} · {dateLabel(i.snapshot.starts_at)}
                  </small>
                </div>
                <div className="actions">
                  <strong>{currency(i.amount)}</strong>
                  {canAudit && batch.status === 'PREPARED' && (
                    <ReasonButton
                      label="Retirar"
                      title={'Retirar do lote · ' + i.snapshot.patient_name}
                      description="O atendimento sai do lote e volta para a lista de prontos para faturar. O valor do lote é recalculado."
                      action="batch-remove-item"
                      payload={{ batch_id: batch.id, appointment_id: i.appointment_id }}
                      done="Atendimento retirado do lote."
                      onDone={() => {
                        setBatch(null);
                        void load();
                      }}
                    />
                  )}
                </div>
              </div>
            ))}
          {canAudit && batch.status === 'PREPARED' && (
            <div className="record-admin">
              <ReasonButton
                label="Cancelar lote"
                title={'Cancelar lote ' + batch.number}
                description="O lote ainda não foi enviado. Ao cancelar, todos os atendimentos voltam para a lista de prontos para faturar e o lote fica registrado como cancelado."
                action="batch-cancel"
                payload={{ id: batch.id }}
                done="Lote cancelado. Os atendimentos voltaram para prontos para faturar."
                onDone={() => {
                  setBatch(null);
                  void load();
                }}
              />
            </div>
          )}
        </Dialog>
      )}
      {sendBatch && (
        <Dialog title={'Registrar envio de ' + sendBatch.number} onClose={() => setSendBatch(null)}>
          <p className="note">
            Use somente após enviar ou registrar as guias no portal da operadora por fora da
            plataforma.
          </p>
          <SchemaForm
            schema={z.object({ protocol: z.string().trim().min(3).max(200) })}
            fields={[{ name: 'protocol', label: 'Protocolo do envio no portal' }]}
            defaults={{ protocol: '' }}
            label="Confirmar envio manual"
            onSubmit={(d) => act('BATCH_SENT', { batch_id: sendBatch.id, ...d })}
          />
        </Dialog>
      )}
      {returnBatch && (
        <Dialog
          title={'Demonstrativo de ' + returnBatch.number}
          onClose={() => setReturnBatch(null)}
          wide
        >
          <p className="note">
            Conferência manual do demonstrativo recebido. O registro não realiza baixa financeira
            automática.
          </p>
          <div className="form-grid">
            <label className="field">
              Referência do demonstrativo
              <input
                className="input"
                value={reference}
                onChange={(e) => setReference(e.target.value)}
              />
            </label>
            <label className="field">
              Data do recebimento
              <input
                className="input"
                type="date"
                value={received}
                onChange={(e) => setReceived(e.target.value)}
              />
            </label>
          </div>
          <Button
            variant="secondary"
            onClick={() =>
              downloadCsv(
                'modelo-retorno-' + returnBatch.number + '.csv',
                ['item_id', 'paid_amount', 'reason'],
                data.items
                  .filter((i: Entity) => i.batch_id === returnBatch.id && i.status === 'WAITING')
                  .map((i: Entity) => [i.id, i.amount, '']),
              )
            }
          >
            Baixar modelo CSV
          </Button>
          <label className="field">
            Importar CSV de conferência
            <input
              className="input"
              type="file"
              accept=".csv,text/csv"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                if (f.size > 1000000) {
                  setError('CSV acima de 1 MB.');
                  return;
                }
                try {
                  const text = (await f.text()).replace(/^\uFEFF/, '');
                  const lines = text
                    .trim()
                    .split(/\r?\n/)
                    .map((l) =>
                      l.split(';').map((v) => v.replace(/^"|"$/g, '').replace(/""/g, '"')),
                    );
                  if (lines[0].join(';') !== 'item_id;paid_amount;reason')
                    throw Error('Use o modelo CSV fornecido.');
                  const next = { ...returnValues };
                  for (const cells of lines.slice(1)) {
                    if (!next[cells[0]]) throw Error('O CSV contém guia de outro lote.');
                    next[cells[0]] = {
                      paid_amount: cells[1].replace(',', '.'),
                      reason: cells.slice(2).join(';'),
                    };
                  }
                  setReturnValues(next);
                } catch (e) {
                  setError((e as Error).message);
                }
              }}
            />
          </label>
          {data.items
            .filter((i: Entity) => i.batch_id === returnBatch.id && i.status === 'WAITING')
            .map((i: Entity) => (
              <div className="return-item" key={i.id}>
                <div>
                  <strong>{i.snapshot.patient_name}</strong>
                  <small>Enviado: {currency(i.amount)}</small>
                </div>
                <label className="field">
                  Valor pago
                  <input
                    className="input"
                    type="number"
                    min="0"
                    step="0.01"
                    value={returnValues[i.id]?.paid_amount || ''}
                    onChange={(e) =>
                      setReturnValues((v) => ({
                        ...v,
                        [i.id]: { ...v[i.id], paid_amount: e.target.value },
                      }))
                    }
                  />
                </label>
                <label className="field">
                  Motivo de glosa / diferença
                  <input
                    className="input"
                    value={returnValues[i.id]?.reason || ''}
                    onChange={(e) =>
                      setReturnValues((v) => ({
                        ...v,
                        [i.id]: { ...v[i.id], reason: e.target.value },
                      }))
                    }
                  />
                </label>
              </div>
            ))}
          <label className="sandbox-consent">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
            />
            Conferi os valores com o demonstrativo da operadora.
          </label>
          <Button
            disabled={busy || !confirmed || reference.trim().length < 3}
            onClick={() =>
              void act('RETURN_IMPORT', {
                batch_id: returnBatch.id,
                reference,
                received_at: received,
                items: Object.entries(returnValues).map(([item_id, r]) => ({
                  item_id,
                  paid_amount: Number(r.paid_amount),
                  reason: r.reason,
                })),
              })
            }
          >
            Registrar retorno e glosas
          </Button>
        </Dialog>
      )}
    </>
  );
}
