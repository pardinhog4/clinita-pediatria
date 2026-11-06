'use client';
import { viewTimezone } from '@/lib/view-timezone';
import { useEffect, useState } from 'react';
import { z } from 'zod';
import {
  AlertCircle,
  Send,
  Repeat2,
  ShieldAlert,
  Tablet,
  KeyRound,
  RefreshCw,
  Copy,
  ExternalLink,
} from 'lucide-react';
import { api, post } from '@/lib/client';
import { currency, dateLabel, timeLabel, type Entity } from '@/lib/types';
import { useNotices } from '@/stores/workspace';
import { MetricCard } from '../molecules/metric-card';
import { DataTable } from '../molecules/data-table';
import { Dialog } from '../molecules/dialog';
import { Badge } from '../atoms/badge';
import { Button } from '../atoms/button';
import { SchemaForm } from './schema-form';
export function GuidesBoard({
  unitId,
  role,
  refreshKey,
  onOpen,
  onBook,
}: {
  unitId: string;
  role: string;
  refreshKey: number;
  onOpen: (row: Entity) => void;
  onBook: (preset: Record<string, any>) => void;
}) {
  const [data, setData] = useState<any>(null),
    [tab, setTab] = useState('pending'),
    [error, setError] = useState(''),
    [selected, setSelected] = useState<string[]>([]),
    [form, setForm] = useState<{ kind: string; row: Entity } | null>(null),
    [link, setLink] = useState(''),
    [tablet, setTablet] = useState(false),
    [busy, setBusy] = useState(false);
  const add = useNotices((s) => s.add),
    canWrite = ['ADMIN', 'MANAGEMENT', 'RECEPTION'].includes(role);
  async function load() {
    try {
      setData(await api('guides?unit=' + unitId));
      setError('');
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => {
    setSelected([]);
    void load();
  }, [unitId, refreshKey]);
  async function act(operation: string, values: Record<string, any>) {
    setBusy(true);
    try {
      const result = await post('operations', { operation, unit_id: unitId, ...values });
      setSelected([]);
      setForm(null);
      await load();
      add(result.message || 'Registro salvo.');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function signature(row: Entity) {
    setBusy(true);
    try {
      const result = await post('signature-links', { unit_id: unitId, appointment_id: row.id });
      setLink(result.url);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const rows = data?.[tab] || [],
    today = new Date().toLocaleDateString('sv-SE', { timeZone: viewTimezone() }),
    tabletRows =
      data?.pending.filter(
        (a: Entity) => a.authorization_type === 'GUIDE' && a.session_date === today && a.arrived_at,
      ) || [];
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
        <p className="loading">Carregando guias e tokens…</p>
      ) : (
        <>
          <div className="metrics operational-metrics">
            <MetricCard
              title="Pendentes"
              value={data.summary.pending}
              detail={currency(data.summary.risk) + ' a faturar em risco'}
              icon={AlertCircle}
            />
            <MetricCard
              title="Solicitações de token"
              value={data.summary.requested_today}
              detail="Preparadas hoje para contato com o responsável"
              icon={Send}
            />
            <MetricCard
              title="Créditos de sessão"
              value={data.summary.credits}
              detail="Reposições em aberto ou reservadas"
              icon={Repeat2}
            />
            <MetricCard
              title="Contestadas"
              value={data.summary.contested}
              detail="Bloqueadas para novo faturamento e repasse"
              icon={ShieldAlert}
            />
          </div>
          <div className="card operation-monitor">
            <KeyRound size={22} />
            <div>
              <h3>Monitor de tokens</h3>
              <p>{data.monitor.message}</p>
              <Badge value="PENDING" label="Integração não conectada" />
            </div>
            <Button variant="secondary" disabled={busy} onClick={() => void load()}>
              <RefreshCw size={15} />
              Atualizar registros
            </Button>
            {canWrite && (
              <Button variant="secondary" onClick={() => setTablet(true)}>
                <Tablet size={15} />
                Modo tablet da recepção
              </Button>
            )}
          </div>
          <div className="tabs" role="tablist" aria-label="Guias e tokens">
            {[
              ['pending', 'Pendentes', data.pending.length],
              ['validated', 'Validadas', data.validated.length],
              ['credits', 'Créditos', data.credits.length],
              ['contested', 'Contestadas', data.contested.length],
              ['requests', 'Solicitações', data.requests.length],
            ].map(([id, label, count]) => (
              <button
                role="tab"
                aria-selected={tab === id}
                className={tab === id ? 'active' : ''}
                key={String(id)}
                onClick={() => {
                  setTab(String(id));
                  setSelected([]);
                }}
              >
                {label} <span className="tab-count">{count}</span>
              </button>
            ))}
          </div>
          {tab === 'pending' && canWrite && (
            <div className="toolbar">
              <label className="sandbox-consent">
                <input
                  type="checkbox"
                  aria-label="Selecionar todas as pendências"
                  checked={rows.length > 0 && selected.length === rows.length}
                  onChange={(e) =>
                    setSelected(e.target.checked ? rows.map((a: Entity) => a.id) : [])
                  }
                />
                {selected.length} selecionadas
              </label>
              <div className="actions wrap">
                <Button
                  variant="secondary"
                  disabled={!selected.length || busy}
                  onClick={() => void act('REQUEST', { appointment_ids: selected, kind: 'TOKEN' })}
                >
                  Preparar pedidos de token
                </Button>
                <Button
                  variant="secondary"
                  disabled={!selected.length || busy}
                  onClick={() =>
                    void act('REQUEST', { appointment_ids: selected, kind: 'SIGNATURE' })
                  }
                >
                  Preparar solicitações de assinatura
                </Button>
              </div>
            </div>
          )}
          {tab === 'credits' ? (
            <DataTable
              rows={rows}
              total={rows.length}
              page={1}
              columns={[
                {
                  key: 'patient_name',
                  label: 'Paciente',
                  render: (r) => (
                    <>
                      <strong>{r.patient_name}</strong>
                      <small>{r.guardian}</small>
                    </>
                  ),
                },
                { key: 'insurer_name', label: 'Plano' },
                {
                  key: 'status',
                  label: 'Situação',
                  render: (r) => (
                    <Badge
                      value={r.status === 'OPEN' ? 'PENDING' : 'CONFIRMED'}
                      label={r.status === 'OPEN' ? 'Crédito disponível' : 'Reposição agendada'}
                    />
                  ),
                },
                {
                  key: 'contract_end',
                  label: 'Validade do plano',
                  render: (r) =>
                    r.contract_end ? (
                      <Badge
                        value="PENDING"
                        label={'Plano termina em ' + dateLabel(r.contract_end)}
                      />
                    ) : (
                      <span>Conferir antes de repor</span>
                    ),
                },
                {
                  key: 'action',
                  label: 'Reposição',
                  render: (r) => (
                    <Button
                      variant="secondary"
                      disabled={!canWrite || r.status !== 'OPEN'}
                      onClick={() =>
                        onBook({
                          patient_id: r.patient_id,
                          replacement_credit_id: r.id,
                          appointment_kind: 'REPLACEMENT',
                          occurrences: 1,
                        })
                      }
                    >
                      Agendar reposição
                    </Button>
                  ),
                },
              ]}
            />
          ) : tab === 'requests' ? (
            <DataTable
              rows={rows}
              total={rows.length}
              page={1}
              columns={[
                {
                  key: 'created_at',
                  label: 'Preparada em',
                  render: (r) => new Date(r.created_at).toLocaleString('pt-BR'),
                },
                { key: 'patient_name', label: 'Paciente' },
                {
                  key: 'kind',
                  label: 'Tipo',
                  render: (r) =>
                    ({
                      TOKEN: 'Token',
                      SIGNATURE: 'Assinatura',
                      REMINDER: 'Lembrete',
                      EVOLUTION: 'Evolução',
                      WAITLIST: 'Lista de espera',
                    })[r.kind as string] || r.kind,
                },
                {
                  key: 'status',
                  label: 'Situação',
                  render: (r) => (
                    <Badge
                      value={
                        r.status === 'DONE'
                          ? 'APPROVED'
                          : r.status === 'SENT_MANUALLY'
                            ? 'CONFIRMED'
                            : 'PENDING'
                      }
                      label={
                        r.status === 'DONE'
                          ? 'Concluída'
                          : r.status === 'SENT_MANUALLY'
                            ? 'Envio manual registrado'
                            : 'Rascunho · não enviado'
                      }
                    />
                  ),
                },
                {
                  key: 'action',
                  label: 'Contato',
                  render: (r) => (
                    <div className="actions wrap">
                      <Button variant="ghost" onClick={() => setForm({ kind: 'MESSAGE', row: r })}>
                        Ver mensagem
                      </Button>
                      {canWrite && r.kind === 'REMINDER' && r.status !== 'DONE' && (
                        <Button
                          variant="secondary"
                          onClick={() => setForm({ kind: 'CONTACT', row: r })}
                        >
                          Registrar resposta da família
                        </Button>
                      )}
                      {canWrite && r.status === 'DRAFT' && (
                        <Button
                          variant="secondary"
                          onClick={() => setForm({ kind: 'SENT', row: r })}
                        >
                          Registrar envio manual
                        </Button>
                      )}
                    </div>
                  ),
                },
              ]}
            />
          ) : (
            <DataTable
              rows={rows}
              total={rows.length}
              page={1}
              columns={[
                ...(tab === 'pending' && canWrite
                  ? [
                      {
                        key: 'select',
                        label: 'Selecionar',
                        render: (r: Entity) => (
                          <input
                            type="checkbox"
                            aria-label={'Selecionar guia de ' + r.patient_name}
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
                  label: 'Data / hora',
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
                  render: (r) => (
                    <>
                      <strong>{r.patient_name}</strong>
                      <small>{r.guardian}</small>
                    </>
                  ),
                },
                {
                  key: 'insurer_name',
                  label: 'Plano',
                  render: (r) => (
                    <>
                      {r.insurer_name}
                      <small>
                        {r.authorization_type === 'TOKEN'
                          ? `${r.required_tokens} token(s) exigido(s)`
                          : r.authorization_type === 'GUIDE'
                            ? 'Guia assinada'
                            : 'Autorização'}
                      </small>
                    </>
                  ),
                },
                {
                  key: 'status',
                  label: 'Situação',
                  render: (r) => (
                    <Badge
                      value={
                        tab === 'contested'
                          ? 'REJECTED'
                          : tab === 'validated'
                            ? 'APPROVED'
                            : 'PENDING'
                      }
                      label={
                        tab === 'contested'
                          ? 'Contestada'
                          : tab === 'validated'
                            ? 'Conferida'
                            : r.authorization_type === 'TOKEN'
                              ? 'Token pendente'
                              : 'Assinatura pendente'
                      }
                    />
                  ),
                },
                { key: 'amount', label: 'Valor', render: (r) => currency(r.amount) },
                {
                  key: 'action',
                  label: 'Ações',
                  render: (r) => (
                    <div className="actions wrap">
                      <Button variant="ghost" onClick={() => onOpen(r)}>
                        Abrir sessão
                      </Button>
                      {canWrite &&
                        tab === 'pending' &&
                        (r.authorization_type === 'TOKEN' ? (
                          <Button
                            variant="secondary"
                            onClick={() => setForm({ kind: 'TOKEN', row: r })}
                          >
                            Conferir tokens
                          </Button>
                        ) : (
                          <Button
                            variant="secondary"
                            disabled={busy}
                            onClick={() => void signature(r)}
                          >
                            Gerar link de assinatura
                          </Button>
                        ))}
                      {tab === 'contested' && ['ADMIN', 'MANAGEMENT', 'AUDIT'].includes(role) && (
                        <Button
                          variant="secondary"
                          onClick={() => setForm({ kind: 'RESOLVE', row: r })}
                        >
                          Analisar contestação
                        </Button>
                      )}
                    </div>
                  ),
                },
              ]}
            />
          )}
        </>
      )}
      {form && (
        <Dialog
          title={
            form.kind === 'TOKEN'
              ? 'Conferência manual de tokens'
              : form.kind === 'RESOLVE'
                ? 'Analisar contestação'
                : form.kind === 'SENT'
                  ? 'Registrar envio manual'
                  : 'Mensagem para contato manual'
          }
          onClose={() => setForm(null)}
          wide
        >
          {form.kind === 'MESSAGE' ? (
            <>
              <p className="note">
                Esta mensagem foi preparada localmente. O envio externo não é automático.
              </p>
              <p className="message inbound preserve-text">{form.row.message}</p>
              <Button
                variant="secondary"
                onClick={() =>
                  navigator.clipboard
                    .writeText(form.row.message)
                    .then(() => add('Mensagem copiada.'))
                    .catch(() => setError('Não foi possível copiar.'))
                }
              >
                <Copy size={15} />
                Copiar mensagem
              </Button>
            </>
          ) : form.kind === 'TOKEN' ? (
            <>
              <p>
                {form.row.patient_name} · {form.row.required_tokens} token(s) para{' '}
                {form.row.duration} minutos
              </p>
              <SchemaForm
                schema={z
                  .object({
                    tokens: z.string().min(3),
                    expires_at: z.iso.date(),
                    evidence: z.string().min(10),
                  })
                  .transform((d) => ({
                    ...d,
                    tokens: d.tokens
                      .split(/[\n,;]+/)
                      .map((t) => t.trim())
                      .filter(Boolean),
                  }))}
                fields={[
                  {
                    name: 'tokens',
                    label: 'Tokens conferidos no portal',
                    type: 'textarea',
                    hint: 'Um token por linha. Não use a chave da IA ou senha da operadora.',
                  },
                  { name: 'expires_at', label: 'Validade da autorização', type: 'date' },
                  { name: 'evidence', label: 'Evidência da conferência manual', type: 'textarea' },
                ]}
                defaults={{ tokens: '', expires_at: form.row.session_date, evidence: '' }}
                label="Validar conferência"
                onSubmit={async (d) => {
                  await post('operations', {
                    operation: 'TOKEN_VALIDATE',
                    unit_id: unitId,
                    appointment_id: form.row.id,
                    version: form.row.version,
                    ...d,
                  });
                  setForm(null);
                  await load();
                  add('Tokens conferidos e agenda atualizada.');
                }}
              />
            </>
          ) : (
            <SchemaForm
              schema={z.object({
                reason: z.string().min(10),
                decision: z.enum(['CONFIRM', 'RETURN']).default('CONFIRM'),
              })}
              fields={[
                ...(form.kind === 'CONTACT'
                  ? [
                      {
                        name: 'decision',
                        label: 'Resposta informada pela família',
                        type: 'select' as const,
                        options: [
                          { value: 'CONFIRM', label: 'Confirmou presença' },
                          { value: 'RETURN', label: 'Recusou / precisa remarcar' },
                        ],
                      },
                    ]
                  : []),
                ...(form.kind === 'RESOLVE'
                  ? [
                      {
                        name: 'decision',
                        label: 'Decisão',
                        type: 'select' as const,
                        options: [
                          { value: 'CONFIRM', label: 'Confirmar realização após análise' },
                          { value: 'RETURN', label: 'Manter bloqueada e devolver para correção' },
                        ],
                      },
                    ]
                  : []),
                {
                  name: 'reason',
                  label:
                    form.kind === 'SENT'
                      ? 'Referência de envio / protocolo'
                      : 'Justificativa da decisão',
                  type: 'textarea',
                },
              ]}
              defaults={{ reason: '', decision: 'CONFIRM' }}
              label={form.kind === 'SENT' ? 'Confirmar envio manual' : 'Salvar decisão'}
              onSubmit={async (d) => {
                if (form.kind === 'CONTACT')
                  await act('CONTACT_RESPONSE', {
                    request_id: form.row.id,
                    response: d.decision === 'CONFIRM' ? 'CONFIRMED' : 'DECLINED',
                    reason: d.reason,
                  });
                else if (form.kind === 'SENT')
                  await act('REQUEST_SENT', { request_id: form.row.id, reference: d.reason });
                else
                  await act('RESOLVE_CONTEST', {
                    appointment_id: form.row.id,
                    version: form.row.version,
                    reason: d.reason,
                    decision: d.decision,
                  });
              }}
            />
          )}
        </Dialog>
      )}
      {link && (
        <Dialog title="Link de assinatura preparado" onClose={() => setLink('')} wide>
          <p className="note">
            Link de uso único, válido por 24 horas. Copie e encaminhe manualmente ao responsável.
          </p>
          <input className="input" aria-label="Link de assinatura" readOnly value={link} />
          <div className="actions wrap">
            <Button
              variant="secondary"
              onClick={() =>
                navigator.clipboard
                  .writeText(link)
                  .then(() => add('Link copiado.'))
                  .catch(() => setError('Não foi possível copiar.'))
              }
            >
              <Copy size={15} />
              Copiar link
            </Button>
            <a className="button secondary" href={link} target="_blank" rel="noreferrer">
              <ExternalLink size={15} />
              Abrir para assinar
            </a>
          </div>
          <iframe
            title="Guia para assinatura no tablet"
            src={link}
            className="signature-frame"
            onLoad={() => void load()}
          />
        </Dialog>
      )}
      {tablet && (
        <Dialog
          title="Modo tablet da recepção"
          onClose={() => {
            setTablet(false);
            void load();
          }}
          wide
        >
          <p className="note">
            Somente guias de hoje com chegada registrada. A assinatura é um registro eletrônico
            local para conferência.
          </p>
          {tabletRows.length ? (
            tabletRows.map((r: Entity) => (
              <div className="timeline-item actions between" key={r.id}>
                <div>
                  <strong>{r.patient_name}</strong>
                  <small>
                    {r.guardian} · {timeLabel(r.starts_at)}
                  </small>
                </div>
                <Button
                  disabled={busy}
                  onClick={() => {
                    setTablet(false);
                    void signature(r);
                  }}
                >
                  Conferir e assinar
                </Button>
              </div>
            ))
          ) : (
            <div className="empty">Nenhuma guia de hoje aguardando assinatura após a chegada.</div>
          )}
        </Dialog>
      )}
    </>
  );
}
