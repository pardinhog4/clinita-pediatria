'use client';
import { useClinicRules } from '@/hooks/use-clinic-rules';
import { useEffect, useState } from 'react';
import { RecordActions, RemoveDocumentButton } from './record-lifecycle';
import { z } from 'zod';
import { api, post } from '@/lib/client';
import { clinicalSchema, labels } from '@/lib/schemas';
import { dateLabel, timeLabel, type Entity } from '@/lib/types';
import { useNotices } from '@/stores/workspace';
import { PatientOperations } from './patient-operations';
import { AssessmentForm } from './assessment-form';
import { Dialog } from '../molecules/dialog';
import { Button } from '../atoms/button';
import { Badge } from '../atoms/badge';
import { SchemaForm, type Field } from './schema-form';
export function PatientRecord({
  patient,
  role,
  units,
  onClose,
  onEdit,
  onChanged,
}: {
  patient: Entity;
  role: string;
  units: { id: string; name: string }[];
  onClose: () => void;
  onEdit: () => void;
  onChanged: () => void;
}) {
  const { upload_max_mb } = useClinicRules();
  const [record, setRecord] = useState<Entity | null>(null),
    [tab, setTab] = useState('history'),
    [error, setError] = useState(''),
    [adding, setAdding] = useState(false),
    [models, setModels] = useState<Entity[]>([]),
    [model, setModel] = useState<Entity | null>(null),
    [uploading, setUploading] = useState(false);
  const add = useNotices((s) => s.add);
  async function load() {
    try {
      setRecord(await api<Entity>('patients/' + patient.id));
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => {
    void load();
  }, [patient.id]);
  async function upload(file: File) {
    setUploading(true);
    setError('');
    try {
      const form = new FormData();
      form.set('file', file);
      form.set('patient_id', patient.id);
      form.set('unit_id', patient.unit_id);
      await api('documents', { method: 'POST', body: form });
      add('Documento salvo no prontuário.');
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setUploading(false);
    }
  }
  return (
    <Dialog title="Cadastro e prontuário" onClose={onClose} wide>
      <div className="record-header">
        <span className="avatar large">{patient.name.slice(0, 2)}</span>
        <div>
          <h2>{patient.name}</h2>
          <p>
            {patient.guardian} · {patient.phone}
          </p>
          <small>Nascimento: {dateLabel(patient.birth_date)}</small>
        </div>
        <div className="record-header-actions">
          {record && record.active === false && <Badge value="neutral" label="Com alta" />}
          <Button variant="secondary" onClick={onEdit}>
            Editar cadastro
          </Button>
          {record && (
            <RecordActions
              resource="patients"
              entity={record}
              role={role}
              units={units}
              onChanged={() => {
                void load();
                onChanged();
              }}
            />
          )}
        </div>
      </div>
      <div className="tabs">
        <button className={tab === 'history' ? 'active' : ''} onClick={() => setTab('history')}>
          Atendimentos
        </button>
        <button className={tab === 'clinical' ? 'active' : ''} onClick={() => setTab('clinical')}>
          Prontuário
        </button>
        <button className={tab === 'documents' ? 'active' : ''} onClick={() => setTab('documents')}>
          Documentos
        </button>
        {[
          ['care', 'Equipe e pedido'],
          ['evaluations', 'Avaliações'],
          ['credits', 'Créditos'],
          ['copayment', 'Coparticipação'],
        ].map(([id, label]) => (
          <button key={id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </div>
      {error && <div className="error-banner">{error}</div>}
      {!record && <p className="loading">Carregando prontuário…</p>}
      {record && tab === 'history' && (
        <>
          <div className="mini-metrics">
            <div>
              <strong>{record.statistics?.total ?? record.appointments.length}</strong>
              <small>Sessões no histórico</small>
            </div>
            <div>
              <strong>
                {record.statistics?.completed ??
                  record.appointments.filter((a: Entity) => a.status === 'COMPLETED').length}
              </strong>
              <small>Realizadas</small>
            </div>
            <div>
              <strong>
                {record.statistics?.absent ??
                  record.appointments.filter((a: Entity) => a.status === 'ABSENT').length}
              </strong>
              <small>Faltas</small>
            </div>
          </div>
          {record.statistics && (
            <div className="presence-chart" role="img" aria-label="Resumo de presença do paciente">
              {[
                ['Realizadas', record.statistics.completed, 'completed'],
                ['Faltas', record.statistics.absent, 'absent'],
                ['Canceladas', record.statistics.cancelled, 'cancelled'],
                ['Ausência profissional', record.statistics.professional_absences, 'pending'],
              ].map(([label, value, kind]) => (
                <div className="presence-bar" key={String(label)}>
                  <span>{label}</span>
                  <div>
                    <i
                      className={String(kind)}
                      style={{
                        width:
                          Math.max(
                            Number(value) ? 2 : 0,
                            (Number(value) / Math.max(1, record.statistics.total)) * 100,
                          ) + '%',
                      }}
                    />
                  </div>
                  <strong>{value}</strong>
                </div>
              ))}
            </div>
          )}
          {record.appointments.map((a: Entity) => (
            <div className="timeline-item" key={a.id}>
              <div className="actions between">
                <strong>
                  {dateLabel(a.starts_at)} · {timeLabel(a.starts_at)}
                </strong>
                <Badge value={a.status} />
              </div>
              <p>
                {a.professional_name} · {labels[a.specialty]}
              </p>
              <small>
                Autorização:{' '}
                {a.authorization_status === 'MANUAL' ? 'conferência manual' : 'pendente'} ·
                auditoria: {a.audit_status === 'APPROVED' ? 'aprovada' : 'pendente'}
              </small>
            </div>
          ))}
        </>
      )}
      {record &&
        tab === 'clinical' &&
        (record.clinical_access ? (
          <>
            <div className="actions">
              <Button
                onClick={() => {
                  setAdding(!adding);
                  setModel(null);
                }}
              >
                Novo registro clínico
              </Button>
              <Button
                variant="secondary"
                onClick={async () => {
                  try {
                    const r = await api<{ data: Entity[] }>('models');
                    setModels(r.data);
                    setAdding(false);
                    setModel(r.data[0] || null);
                    if (!r.data.length) add('Cadastre um modelo em Configurações.', 'error');
                  } catch (e) {
                    setError((e as Error).message);
                  }
                }}
              >
                Aplicar avaliação
              </Button>
            </div>
            {adding && (
              <SchemaForm
                schema={clinicalSchema}
                fields={[
                  {
                    name: 'kind',
                    label: 'Tipo do registro',
                    type: 'select',
                    options: [
                      { value: 'ANAMNESIS', label: 'Anamnese' },
                      { value: 'PLAN', label: 'Plano terapêutico' },
                      { value: 'REPORT', label: 'Relatório' },
                    ],
                  },
                  {
                    name: 'content',
                    label: 'Registro clínico',
                    type: 'textarea',
                    hint: 'Os registros são preservados; correções devem ser feitas em um novo registro.',
                  },
                  { name: 'recipient', label: 'Destinatário do relatório (quando aplicável)' },
                ]}
                defaults={{ patient_id: patient.id, kind: 'ANAMNESIS', content: '', recipient: '' }}
                label="Salvar no prontuário"
                onSubmit={async (data) => {
                  await post('clinical', data);
                  setAdding(false);
                  add('Registro clínico salvo.');
                  await load();
                }}
              />
            )}
            {model && (
              <div className="sub-card">
                <div className="field">
                  <label htmlFor="clinical-model">Modelo da especialidade</label>
                  <select
                    id="clinical-model"
                    className="input"
                    value={model.id}
                    onChange={(e) => setModel(models.find((m) => m.id === e.target.value) || null)}
                  >
                    {models.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name} · v{m.version}
                      </option>
                    ))}
                  </select>
                </div>
                <AssessmentForm
                  questions={model.questions}
                  onSubmit={async (answers) => {
                    await post('clinical', {
                      patient_id: patient.id,
                      kind: 'ASSESSMENT',
                      model_id: model.id,
                      answers,
                      content:
                        'Avaliação clínica registrada: ' +
                        model.name +
                        '. ' +
                        Object.values(answers).join('; '),
                    });
                    setModel(null);
                    add('Avaliação salva com respostas e versão.');
                    await load();
                  }}
                />
              </div>
            )}
            {record.clinical.map((e: Entity) => (
              <div className="timeline-item" key={e.id}>
                <strong>
                  {{
                    EVOLUTION: 'Evolução',
                    ANAMNESIS: 'Anamnese',
                    ASSESSMENT: 'Avaliação',
                    PLAN: 'Plano terapêutico',
                    REPORT: 'Relatório',
                  }[e.kind as string] || e.kind}
                </strong>
                <small>
                  {e.author} · {new Date(e.created_at).toLocaleString('pt-BR')}
                  {e.model_snapshot?.model ? ' · modelo v' + e.model_snapshot.model.version : ''}
                </small>
                {e.model_snapshot?.report?.recipient && (
                  <small>Destinatário: {e.model_snapshot.report.recipient}</small>
                )}
                <p className="preserve-text">{e.content}</p>
              </div>
            ))}
            {!record.clinical.length && (
              <p className="empty">Nenhum registro clínico nesta ficha.</p>
            )}
          </>
        ) : (
          <div className="note">
            O conteúdo clínico é restrito à gestão e à equipe de cuidado autorizada.
          </div>
        ))}
      {record &&
        tab === 'documents' &&
        (record.clinical_access ? (
          <>
            <div className="field">
              <label htmlFor="patient-document">Adicionar PDF de até {upload_max_mb} MB</label>
              <input
                id="patient-document"
                type="file"
                className="input"
                accept="application/pdf"
                disabled={uploading}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void upload(f);
                }}
              />
            </div>
            {uploading && <p>Enviando documento…</p>}
            {record.documents.map((d: Entity) => (
              <div className="timeline-item actions between" key={d.id}>
                <div>
                  <strong>{d.name}</strong>
                  <small>{dateLabel(d.created_at)}</small>
                </div>
                <a className="button secondary" href={'/api/documents/' + d.id}>
                  Baixar PDF
                </a>
                {['ADMIN', 'MANAGEMENT'].includes(role) && (
                  <RemoveDocumentButton doc={d} onDone={() => void load()} />
                )}
              </div>
            ))}
            {!record.documents.length && <p className="empty">Nenhum documento anexado.</p>}
          </>
        ) : (
          <div className="note">Documentos clínicos restritos à equipe autorizada.</div>
        ))}
      {record && ['care', 'evaluations', 'credits', 'copayment'].includes(tab) && (
        <PatientOperations record={record} tab={tab} onSaved={load} />
      )}
    </Dialog>
  );
}
