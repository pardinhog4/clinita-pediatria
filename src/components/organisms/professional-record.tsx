'use client';
import { useEffect, useState } from 'react';
import { RecordActions, RemoveDocumentButton } from './record-lifecycle';
import { z } from 'zod';
import { api, post, fetchAll } from '@/lib/client';
import { labels } from '@/lib/schemas';
import { currency, type Entity } from '@/lib/types';
import { useNotices } from '@/stores/workspace';
import { Dialog } from '../molecules/dialog';
import { Button } from '../atoms/button';
import { Badge } from '../atoms/badge';
import { SchemaForm } from './schema-form';
import { ProfessionalProfile } from './professional-profile';
export function ProfessionalRecord({
  professional,
  unitId,
  role,
  onClose,
  onEdit,
  onSaved,
}: {
  professional: Entity;
  unitId: string;
  role: string;
  onClose: () => void;
  onEdit: (entity: Entity) => void;
  onSaved: () => void;
}) {
  const [record, setRecord] = useState<Entity | null>(null),
    [tab, setTab] = useState('summary'),
    [action, setAction] = useState(''),
    [error, setError] = useState(''),
    [destinations, setDestinations] = useState<Entity[]>([]),
    [kind, setKind] = useState('CERTIFICATE'),
    [uploading, setUploading] = useState(false);
  const add = useNotices((s) => s.add),
    manager = ['ADMIN', 'MANAGEMENT'].includes(role);
  async function load() {
    try {
      setRecord(await api('professionals/' + professional.id));
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => {
    void load();
  }, [professional.id]);
  async function op(operation: string, data: Record<string, any>) {
    await post('operations', {
      operation,
      unit_id: unitId,
      professional_id: professional.id,
      ...data,
    });
    add('Profissional atualizado.');
    setAction('');
    await load();
    onSaved();
  }
  return (
    <Dialog title="Ficha do profissional" onClose={onClose} wide>
      {error && <p className="error-banner">{error}</p>}
      {!record ? (
        <p className="loading">Carregando profissional…</p>
      ) : (
        <>
          <div className="record-header">
            <span className="avatar large">{record.name.slice(0, 2)}</span>
            <div>
              <h2>{record.name}</h2>
              <p>
                {labels[record.specialty]} · {record.contract}
              </p>
              <Badge
                value={record.active ? 'APPROVED' : 'REJECTED'}
                label={record.active ? 'Ativo' : 'Desligado'}
              />
            </div>
            <div className="record-header-actions">
              {manager && (
                <Button variant="secondary" onClick={() => onEdit(record)}>
                  Editar cadastro
                </Button>
              )}
              <RecordActions
                resource="professionals"
                entity={record}
                role={role}
                onChanged={() => {
                  void load();
                  onSaved();
                }}
              />
            </div>
          </div>
          <div className="tabs">
            {[
              ['summary', 'Resumo'],
              ['profile', 'Perfil de atendimento'],
              ['documents', 'Competências e documentos'],
              ['portfolio', 'Carteira'],
            ].map(([id, label]) => (
              <button
                key={id}
                className={tab === id ? 'active' : ''}
                onClick={() => {
                  setTab(id);
                  setAction('');
                }}
              >
                {label}
              </button>
            ))}
          </div>
          {tab === 'summary' && (
            <>
              <div className="mini-metrics">
                <div>
                  <strong>
                    {record.metadata?.min_age ?? 0} a {record.metadata?.max_age ?? '—'} anos
                  </strong>
                  <small>Faixa atendida</small>
                </div>
                <div>
                  <strong>{record.caseload_count ?? 0}</strong>
                  <small>Pacientes no histórico</small>
                </div>
                {record.hourly_rate !== undefined && (
                  <div>
                    <strong>{currency(record.hourly_rate)}</strong>
                    <small>Repasse por hora</small>
                  </div>
                )}
              </div>
              <h3>Dias de atendimento</h3>
              <div className="tags">
                {(record.metadata?.work_days || [1, 2, 3, 4, 5, 6]).map((d: number) => (
                  <span className="tag" key={d}>
                    {['', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'][d]}
                  </span>
                ))}
              </div>
              {record.metadata?.assistant_names?.length > 0 && (
                <p>Assistentes: {record.metadata.assistant_names.join(', ')}</p>
              )}
              <h3 className="section-title">Competências registradas</h3>
              <Button
                variant="ghost"
                onClick={() =>
                  navigator.clipboard
                    .writeText(
                      [
                        record.name,
                        labels[record.specialty],
                        'Faixa: ' +
                          record.metadata.min_age +
                          ' a ' +
                          record.metadata.max_age +
                          ' anos',
                        'Competências: ' + record.competencies.join(', '),
                      ].join('\n'),
                    )
                    .then(() => add('Resumo profissional copiado para conferência da operadora.'))
                    .catch(() => setError('Não foi possível copiar o resumo.'))
                }
              >
                Copiar resumo para a operadora
              </Button>
              <div className="tags">
                {record.competencies.map((c: string) => (
                  <span className="tag" key={c}>
                    {c}
                  </span>
                ))}
              </div>
            </>
          )}
          {tab === 'profile' && <ProfessionalProfile professionalId={record.id} />}
          {tab === 'documents' && (
            <>
              <h3>Competências e comprovação</h3>
              {record.competencies.map((code: string) => {
                const cert = record.metadata?.certifications?.find((c: any) => c.code === code);
                return (
                  <div className="timeline-item actions between" key={code}>
                    <div>
                      <strong>{code}</strong>
                      <small>{cert?.level || 'Nível a conferir'}</small>
                    </div>
                    <Badge
                      value={cert?.verified ? 'APPROVED' : 'PENDING'}
                      label={cert?.verified ? 'Certificação conferida' : 'Sem conferência'}
                    />
                  </div>
                );
              })}
              {record.contract === 'PJ' && (
                <div className="sub-card">
                  <h3>Documentos PJ</h3>
                  <Badge
                    value={record.metadata?.pj_documents_confirmed ? 'APPROVED' : 'REJECTED'}
                    label={
                      record.metadata?.pj_documents_confirmed
                        ? 'CNPJ e conta PJ conferidos'
                        : 'Documentação PJ pendente'
                    }
                  />
                  <p className="small muted">
                    Conferência manual do cartão CNPJ e da conta PJ. Não representa consulta
                    automática à Receita ou ao banco.
                  </p>
                  {manager && (
                    <Button variant="secondary" onClick={() => setAction('pj')}>
                      {record.metadata?.pj_documents_confirmed
                        ? 'Revisar documentação PJ'
                        : 'Registrar documentos PJ recebidos'}
                    </Button>
                  )}
                </div>
              )}
              {manager && (
                <div className="sub-card">
                  <h3>Anexar PDF de comprovação</h3>
                  <label className="field">
                    Tipo de documento
                    <select
                      className="input"
                      value={kind}
                      onChange={(e) => setKind(e.target.value)}
                    >
                      <option value="CERTIFICATE">Certificado de competência</option>
                      <option value="CNPJ">Cartão CNPJ</option>
                      <option value="BANK">Comprovante de conta PJ</option>
                    </select>
                  </label>
                  <label className="field">
                    Documento profissional PDF
                    <input
                      className="input"
                      type="file"
                      accept="application/pdf"
                      disabled={uploading}
                      onChange={async (e) => {
                        const f = e.target.files?.[0];
                        if (!f) return;
                        setUploading(true);
                        try {
                          const form = new FormData();
                          form.set('file', f);
                          form.set('unit_id', unitId);
                          form.set('professional_id', professional.id);
                          form.set('document_kind', kind);
                          await api('documents', { method: 'POST', body: form });
                          add('Documento profissional salvo.');
                          await load();
                        } catch (e) {
                          setError((e as Error).message);
                        } finally {
                          setUploading(false);
                        }
                      }}
                    />
                  </label>
                  <Button variant="secondary" onClick={() => setAction('cert')}>
                    Registrar conferência de competência
                  </Button>
                </div>
              )}
              {record.documents?.map((d: Entity) => (
                <div className="timeline-item actions between" key={d.id}>
                  <div>
                    <strong>{d.name}</strong>
                    <small>
                      {{ CERTIFICATE: 'Certificado', CNPJ: 'CNPJ', BANK: 'Conta PJ' }[
                        d.document_kind as string
                      ] || d.document_kind}
                    </small>
                  </div>
                  <a className="button secondary" href={'/api/documents/' + d.id}>
                    Baixar PDF
                  </a>
                  {['ADMIN', 'MANAGEMENT'].includes(role) && (
                    <RemoveDocumentButton doc={d} onDone={() => void load()} />
                  )}
                </div>
              ))}
            </>
          )}
          {tab === 'portfolio' && (
            <>
              <h3>Carteira e transferência</h3>
              <p>
                {record.future_sessions ?? 0} sessões futuras. O histórico clínico permanece
                preservado e somente leitura.
              </p>
              {record.transfers?.map((t: Entity) => (
                <div className="timeline-item" key={t.id}>
                  <strong>{t.patient_name}</strong>
                  <p>
                    {t.from_name} → {t.to_name}
                  </p>
                  <small>{t.reason}</small>
                </div>
              ))}
              {manager && record.active && (
                <Button
                  variant="danger"
                  onClick={async () => {
                    try {
                      const list = await fetchAll<Entity>('professionals?unit=' + unitId);
                      setDestinations(
                        list.data.filter(
                          (p) =>
                            p.active &&
                            p.id !== professional.id &&
                            p.specialty === record.specialty,
                        ),
                      );
                      setAction('transfer');
                    } catch (e) {
                      setError((e as Error).message);
                    }
                  }}
                >
                  Desligar e transferir carteira
                </Button>
              )}
            </>
          )}
          {action === 'pj' && (
            <SchemaForm
              schema={z.object({ confirmed: z.boolean(), reason: z.string().min(10) })}
              fields={[
                {
                  name: 'confirmed',
                  label: 'Conferi o cartão CNPJ e a conta bancária PJ',
                  type: 'checkbox',
                },
                { name: 'reason', label: 'Referência da conferência documental', type: 'textarea' },
              ]}
              defaults={{ confirmed: !!record.metadata?.pj_documents_confirmed, reason: '' }}
              label="Salvar conferência PJ"
              onSubmit={(d) => op('PJ_DOCUMENTS', d)}
            />
          )}
          {action === 'cert' && (
            <SchemaForm
              schema={z.object({
                code: z.string().min(1),
                level: z.enum(['PRACTICE', 'TRAINED', 'CERTIFIED']),
                document_id: z.string().default(''),
                reason: z.string().min(10),
              })}
              fields={[
                {
                  name: 'code',
                  label: 'Competência do cadastro',
                  type: 'select',
                  options: record.competencies.map((c: string) => ({ value: c, label: c })),
                },
                {
                  name: 'level',
                  label: 'Nível conferido',
                  type: 'select',
                  options: [
                    { value: 'PRACTICE', label: 'Prática clínica' },
                    { value: 'TRAINED', label: 'Capacitação' },
                    { value: 'CERTIFIED', label: 'Certificação' },
                  ],
                },
                {
                  name: 'document_id',
                  label: 'Certificado anexado (opcional)',
                  type: 'select',
                  options: (record.documents || [])
                    .filter((d: Entity) => d.document_kind === 'CERTIFICATE')
                    .map((d: Entity) => ({ value: d.id, label: d.name })),
                },
                {
                  name: 'reason',
                  label: 'Referência da conferência do certificado',
                  type: 'textarea',
                },
              ]}
              defaults={{
                code: record.competencies[0] || '',
                level: 'TRAINED',
                document_id: '',
                reason: '',
              }}
              label="Salvar conferência da competência"
              onSubmit={(d) => op('PROF_CERTIFY', d)}
            />
          )}
          {action === 'transfer' && (
            <>
              {!destinations.length ? (
                <p className="note">
                  Cadastre outro profissional ativo da mesma área e unidade antes de transferir.
                </p>
              ) : (
                <SchemaForm
                  schema={z.object({ destination_id: z.uuid(), reason: z.string().min(10) })}
                  fields={[
                    {
                      name: 'destination_id',
                      label: 'Transferir carteira para',
                      type: 'select',
                      options: destinations.map((p) => ({ value: p.id, label: p.name })),
                    },
                    {
                      name: 'reason',
                      label: 'Motivo do desligamento e da transferência',
                      type: 'textarea',
                    },
                  ]}
                  defaults={{ destination_id: '', reason: '' }}
                  label="Confirmar desligamento e transferência"
                  onSubmit={(d) => op('PROF_TRANSFER', d)}
                />
              )}
              <p className="note">
                Se houver conflito na agenda do destino, a transferência será bloqueada para
                remarcação prévia.
              </p>
            </>
          )}
        </>
      )}
    </Dialog>
  );
}
