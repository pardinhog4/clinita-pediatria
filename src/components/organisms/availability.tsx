'use client';
import { useEffect, useState } from 'react';
import { api, fetchAll } from '@/lib/client';
import { labels, specialtyOptions, specialtyCode } from '@/lib/schemas';
import { type Entity } from '@/lib/types';
import { Button } from '../atoms/button';
import { Badge } from '../atoms/badge';
import { DirectorySelect } from '../molecules/directory-select';
import { SequenceSearch } from './sequence-search';
export function Availability({
  unitId,
  onBook,
}: {
  unitId: string;
  onBook: (preset?: Record<string, any>) => void;
}) {
  const [specialty, setSpecialty] = useState('fono'),
    [date, setDate] = useState(new Date(Date.now() + 86400000).toLocaleDateString('sv-SE')),
    [duration, setDuration] = useState('60'),
    [rows, setRows] = useState<Entity[]>([]),
    [catalog, setCatalog] = useState<Entity[]>([]),
    [error, setError] = useState(''),
    [loading, setLoading] = useState(false),
    [patientId, setPatientId] = useState(''),
    [patient, setPatient] = useState<Entity | null>(null),
    [age, setAge] = useState(''),
    [competency, setCompetency] = useState(''),
    [mode, setMode] = useState('single');
  useEffect(() => {
    setPatientId('');
    setPatient(null);
    fetchAll<Entity>('professionals?unit=' + unitId)
      .then((r) => setCatalog(r.data))
      .catch((e) => setError(e.message));
  }, [unitId]);
  useEffect(() => {
    let active = true;
    setLoading(true);
    const params = new URLSearchParams({
      unit: unitId,
      date,
      specialty,
      duration,
      ...(patientId ? { patient: patientId } : age ? { age } : {}),
      ...(competency ? { competency } : {}),
    });
    api<{ data: Entity[] }>('availability?' + params)
      .then((r) => {
        if (active) {
          setRows(r.data);
          setError('');
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [unitId, date, specialty, duration, patientId, age, competency]);
  async function choosePatient(id: string) {
    setPatientId(id);
    setPatient(null);
    if (!id) return;
    try {
      const p = await api<Entity>('patients/' + id);
      setPatient(p);
      if (!p.metadata.specialties?.includes(specialty))
        setSpecialty(p.metadata.specialties?.[0] || 'fono');
      const plan = p.insurer_id ? await api<Entity>('insurers/' + p.insurer_id) : null;
      if (plan) setDuration(String(plan.rules.duration));
      setCompetency('');
    } catch (e) {
      setError((e as Error).message);
    }
  }
  const proposalConversation =
    typeof window !== 'undefined'
      ? new URLSearchParams(window.location.search).get('conversation')
      : null;
  const book = (preset: Record<string, any>) =>
    onBook({
      ...preset,
      ...(proposalConversation ? { proposal_conversation: proposalConversation } : {}),
    });
  const competencies = [
    ...new Set<string>(
      catalog.filter((p) => p.specialty === specialty).flatMap((p) => p.competencies),
    ),
  ].sort();
  return (
    <>
      <div className="note">
        Busca por dados do pedido, idade e competências registradas. A reserva valida novamente
        paciente, contrato, quantitativo, sala e conflitos antes de gravar.
      </div>
      <div className="card form">
        <label className="field" htmlFor="availability-patient">
          Paciente / pedido médico (opcional na busca individual)
        </label>
        <DirectorySelect
          id="availability-patient"
          kind="patients"
          unitId={unitId}
          value={patientId}
          onChange={(id) => void choosePatient(id)}
        />
        {patient && (
          <p>
            {patient.name} · responsável: {patient.guardian} · pedido até{' '}
            {patient.metadata.order_expires || 'validade não informada'}
          </p>
        )}
        <div className="tabs">
          <button className={mode === 'single' ? 'active' : ''} onClick={() => setMode('single')}>
            Horários individuais
          </button>
          <button
            className={mode === 'sequence' ? 'active' : ''}
            onClick={() => setMode('sequence')}
          >
            Semana sequenciada
          </button>
        </div>
      </div>
      {mode === 'sequence' ? (
        <SequenceSearch unitId={unitId} patient={patient} duration={Number(duration)} />
      ) : (
        <>
          <div className="operational-filters">
            <label className="field" htmlFor="availability-specialty">
              Especialidade
              <select
                id="availability-specialty"
                className="input"
                value={specialty}
                onChange={(e) => {
                  setSpecialty(e.target.value);
                  setCompetency('');
                }}
              >
                {specialtyOptions().map(([v, l]) => (
                  <option value={v} key={v}>
                    {l}
                  </option>
                ))}
              </select>
            </label>
            <label className="field" htmlFor="availability-date">
              Data
              <input
                id="availability-date"
                className="input"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </label>
            <label className="field" htmlFor="availability-duration">
              Duração
              <select
                className="input"
                id="availability-duration"
                value={duration}
                onChange={(e) => setDuration(e.target.value)}
              >
                <option value="30">30 minutos</option>
                <option value="60">60 minutos</option>
              </select>
            </label>
            <label className="field">
              Idade informada (anos)
              <input
                className="input"
                type="number"
                min="0"
                max="120"
                value={age}
                disabled={!!patientId}
                placeholder={patientId ? 'Usando nascimento do cadastro' : 'Informe a idade'}
                onChange={(e) => setAge(e.target.value)}
              />
            </label>
            <label className="field">
              Competência solicitada
              <select
                className="input"
                value={competency}
                onChange={(e) => setCompetency(e.target.value)}
              >
                <option value="">Sem filtro de competência</option>
                {competencies.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {error && <div className="error-banner">{error}</div>}
          {loading && <p className="muted">Consultando disponibilidade…</p>}
          <div className="agent-grid">
            {rows.map((p) => (
              <div className="card agent-card" key={p.id}>
                <div className="actions between">
                  <h3>{p.name}</h3>
                  <Badge
                    value={p.compatibility === 'HIGH' ? 'APPROVED' : 'PENDING'}
                    label={
                      p.compatibility === 'HIGH' ? 'Alta compatibilidade' : 'Verificar manualmente'
                    }
                  />
                </div>
                <p>
                  {labels[p.specialty]} · {p.room_name}
                </p>
                <small>
                  {p.min_age} a {p.max_age} anos ·{' '}
                  {p.competencies.join(' · ') || 'Competências a conferir'}
                </small>
                {competency && !p.certificate_verified && (
                  <Badge value="PENDING" label="Certificado da competência a conferir" />
                )}
                <div className="slots">
                  {p.slots.map((s: { time: string; available: boolean }) => (
                    <button
                      key={s.time}
                      disabled={!s.available}
                      className={'slot ' + (s.available ? 'free' : 'occupied')}
                      onClick={() =>
                        book({
                          professional_id: p.id,
                          ...(patientId ? { patient_id: patientId } : {}),
                          local_start: date + 'T' + s.time,
                          duration: Number(duration),
                        })
                      }
                    >
                      {s.time} · {s.available ? 'Disponível' : 'Indisponível'}
                    </button>
                  ))}
                </div>
                <Button
                  variant="secondary"
                  disabled={!p.slots.some((s: any) => s.available)}
                  onClick={() => {
                    const slot = p.slots.find((s: any) => s.available);
                    book({
                      professional_id: p.id,
                      ...(patientId ? { patient_id: patientId } : {}),
                      local_start: date + 'T' + slot.time,
                      duration: Number(duration),
                    });
                  }}
                >
                  Preparar agendamento
                </Button>
              </div>
            ))}
          </div>
          {!loading && !rows.length && (
            <div className="empty">Nenhum profissional corresponde aos critérios na unidade.</div>
          )}
        </>
      )}
    </>
  );
}
