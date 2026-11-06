'use client';
import { viewTimezone } from '@/lib/view-timezone';
import { sharedSpecialty } from '@/lib/schemas';
import { useState, useEffect } from 'react';
import { api, post } from '@/lib/client';
import { currency, dateLabel, timeLabel, type Entity } from '@/lib/types';
import { useNotices } from '@/stores/workspace';
import { AppointmentOperations } from './appointment-operations';
import { requiredTokens } from '@/server/session-evidence';
import { Dialog } from '../molecules/dialog';
import { Button } from '../atoms/button';
import { Badge } from '../atoms/badge';
export function AppointmentDetail({
  row: initialRow,
  role = '',
  onClose,
  onSaved,
}: {
  row: Entity;
  role?: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [row, setRow] = useState(initialRow),
    [tokens, setTokens] = useState(''),
    [expires, setExpires] = useState(
      new Date(initialRow.starts_at).toLocaleDateString('sv-SE', { timeZone: viewTimezone() }),
    ),
    [assistants, setAssistants] = useState('');
  useEffect(() => {
    void api<Entity>('appointments/' + initialRow.id)
      .then((r) => setRow({ ...initialRow, ...r }))
      .catch(() => {});
  }, [initialRow.id]);
  const needed = requiredTokens(
      row.rules || {},
      (new Date(row.ends_at).getTime() - new Date(row.starts_at).getTime()) / 60000,
    ),
    reception = ['ADMIN', 'MANAGEMENT', 'RECEPTION'].includes(role),
    clinical = ['ADMIN', 'MANAGEMENT', 'CLINICIAN'].includes(role),
    auditor = ['ADMIN', 'MANAGEMENT', 'AUDIT'].includes(role);
  const [reason, setReason] = useState(''),
    [content, setContent] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const add = useNotices((s) => s.add);
  async function act(action: string) {
    setError('');
    setBusy(true);
    try {
      await post('appointments/' + row.id + '/events', {
        version: row.version,
        action,
        reason,
        content,
        assistant_names: assistants
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
        ...(action === 'authorize' && needed
          ? {
              tokens: tokens
                .split(/[\n,;]+/)
                .map((s) => s.trim())
                .filter(Boolean),
              authorization_expires: expires,
            }
          : {}),
      });
      add('Sessão atualizada.');
      onSaved();
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog title="Sessão e evidências" onClose={onClose} wide>
      <div className="record-header">
        <div className="avatar">{row.patient_name?.slice(0, 2)}</div>
        <div>
          <h2>{row.patient_name || 'Atendimento'}</h2>
          <p>
            {dateLabel(row.starts_at)} · {timeLabel(row.starts_at)} · {row.professional_name}
          </p>
        </div>
        <Badge value={row.status} />
      </div>
      <div className="evidence-grid">
        <div>
          <small>Comparecimento</small>
          <Badge
            value={row.arrived_at ? 'COMPLETED' : 'PENDING'}
            label={row.arrived_at ? 'Registrado' : 'Pendente'}
          />
        </div>
        <div>
          <small>Autorização</small>
          <Badge value={row.authorization_status} />
        </div>
        <div>
          <small>Evolução clínica</small>
          <Badge value={row.status === 'COMPLETED' ? 'COMPLETED' : 'PENDING'} />
        </div>
        <div>
          <small>Guia / assinatura</small>
          <Badge value={row.signature_evidence ? 'MANUAL' : 'PENDING'} />
        </div>
        <div>
          <small>Auditoria</small>
          <Badge value={row.audit_status} />
        </div>
      </div>
      {row.authorization_evidence && (
        <p className="note">Conferência manual: {row.authorization_evidence}</p>
      )}
      {row.signature_evidence && <p className="note">Guia: {row.signature_evidence}</p>}
      <div className="field">
        <label htmlFor="session-reason">Justificativa ou evidência</label>
        <textarea
          id="session-reason"
          className="input"
          rows={3}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Descreva a consulta manual ao portal, documento de assinatura ou motivo da alteração."
        />
      </div>
      {row.status === 'IN_PROGRESS' && clinical && (
        <div className="field">
          <label htmlFor="session-evolution">Atividade, apoio e resultado</label>
          <textarea
            id="session-evolution"
            className="input"
            rows={5}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="Registro clínico com pelo menos 40 caracteres."
          />
        </div>
      )}
      {needed > 0 && reception && row.authorization_status === 'PENDING' && (
        <div className="sub-card">
          <p>Esta sessão exige {needed} token(s) conferido(s) no portal.</p>
          <label className="field">
            Códigos dos tokens
            <textarea
              className="input"
              value={tokens}
              onChange={(e) => setTokens(e.target.value)}
              placeholder="Um token por linha"
            />
          </label>
          <label className="field">
            Validade da autorização
            <input
              className="input"
              type="date"
              value={expires}
              onChange={(e) => setExpires(e.target.value)}
            />
          </label>
        </div>
      )}
      {clinical && row.status === 'IN_PROGRESS' && sharedSpecialty(row.specialty) && (
        <label className="field">
          Assistentes terapêuticas presentes
          <input
            className="input"
            value={assistants}
            onChange={(e) => setAssistants(e.target.value)}
            placeholder="Nomes separados por vírgula"
          />
        </label>
      )}
      {row.financial_hold && (
        <p className="error-banner">Bloqueio financeiro: {row.contest_reason || row.reason}</p>
      )}
      {error && (
        <div className="error-banner" role="alert">
          {error}
        </div>
      )}
      <div className="actions wrap">
        {row.status === 'SCHEDULED' && reception && (
          <Button disabled={busy} onClick={() => act('arrive')}>
            Registrar chegada
          </Button>
        )}
        {row.authorization_status === 'PENDING' &&
          reception &&
          !['CANCELLED', 'ABSENT'].includes(row.status) && (
            <Button variant="secondary" disabled={busy} onClick={() => act('authorize')}>
              Conferir autorização manual
            </Button>
          )}
        {!row.signature_evidence && reception && !['CANCELLED', 'ABSENT'].includes(row.status) && (
          <Button variant="secondary" disabled={busy} onClick={() => act('sign')}>
            Registrar evidência da guia
          </Button>
        )}
        {row.status === 'ARRIVED' && clinical && (
          <Button disabled={busy} onClick={() => act('start')}>
            Iniciar sessão
          </Button>
        )}
        {row.status === 'IN_PROGRESS' && clinical && (
          <Button disabled={busy} onClick={() => act('complete')}>
            Salvar evolução e finalizar
          </Button>
        )}
        {row.status === 'COMPLETED' && auditor && row.audit_status !== 'APPROVED' && (
          <>
            <Button disabled={busy} onClick={() => act('approve')}>
              Aprovar auditoria
            </Button>
            <Button variant="secondary" disabled={busy} onClick={() => act('return')}>
              Devolver para revisão
            </Button>
          </>
        )}
        {['SCHEDULED', 'ARRIVED'].includes(row.status) && reception && (
          <>
            <Button variant="danger" disabled={busy} onClick={() => act('absent')}>
              Registrar falta
            </Button>
            <Button variant="ghost" disabled={busy} onClick={() => act('cancel')}>
              Cancelar sessão
            </Button>
          </>
        )}
      </div>
      <AppointmentOperations row={row} role={role} onSaved={onSaved} onClose={onClose} />
      <p className="muted small">
        Presença isolada não libera faturamento ou repasse. Token e guia são conferidos manualmente
        pela equipe.
      </p>
    </Dialog>
  );
}
