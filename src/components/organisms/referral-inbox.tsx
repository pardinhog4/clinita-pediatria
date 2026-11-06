'use client';
import { viewTimezone } from '@/lib/view-timezone';
import { localWeekday } from '@/lib/timezone';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import {
  Inbox,
  Users,
  CheckCircle2,
  RefreshCw,
  CalendarDays,
  CalendarClock,
  CalendarCheck2,
  Home,
  Stethoscope,
  Check,
  X,
  ArrowRightLeft,
  FileCheck2,
} from 'lucide-react';
import { api, post } from '@/lib/client';
import type { Entity } from '@/lib/types';
import { useNotices } from '@/stores/workspace';
import { Button } from '../atoms/button';
import { Badge } from '../atoms/badge';
import { Dialog } from '../molecules/dialog';
import { MetricCard } from '../molecules/metric-card';
import { referralStatus, specialtyText } from '../molecules/referral-plan';
import { ReferralSchedule } from './referral-schedule';
import { ManualReferralButton, ReferralItemEdit } from './referral-manual';
import { DirectorySelect } from '../molecules/directory-select';
import { weekdayNames } from '@/lib/clinic-rules';
import Link from 'next/link';
type Option = { id: string; name: string; specialty: string };
type Data = {
  data: Entity[];
  summary: { pending: number; coordination: number; accepted: number; scheduling?: number };
  own: { id: string; name: string } | null;
  canManage: boolean;
  canResolve?: boolean;
  professionals?: Option[];
};
type Acting = { item: Entity; kind: 'decline' | 'assign' | 'resolve' };
type Deciding = {
  proposal: { id: string; patient_id: string | null };
  action: 'ACCEPT' | 'APPROVE' | 'REJECT';
  head: Entity;
};
const ago = (v: string) => formatDistanceToNow(new Date(v), { addSuffix: true, locale: ptBR });
const age = (v: string | null) =>
  v === null
    ? null
    : Number(v) < 1
      ? 'menos de 1 ano'
      : Math.floor(Number(v)) + (Math.floor(Number(v)) === 1 ? ' ano' : ' anos');
const actionLabels: Record<string, string> = {
  EDITED: 'Editado',
  PROPOSED: 'Horários propostos',
  FAMILY_ACCEPTED: 'Família aceitou os horários',
  PROPOSAL_REJECTED: 'Proposta recusada',
  SCHEDULED: 'Agendado',
  CREATED: 'Plano criado pela IA',
  ACCEPT: 'Aceito',
  DECLINE: 'Recusado',
  ASSIGN: 'Atribuído',
  RESOLVE: 'Concluído pela coordenação',
  SUPERSEDED: 'Substituído por novo plano',
};

export function ReferralInbox({ unitId, role }: { unitId: string; role: string }) {
  const clinician = role === 'CLINICIAN';
  const [data, setData] = useState<Data | null>(null),
    [view, setView] = useState('professional'),
    [professional, setProfessional] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(''),
    [acting, setActing] = useState<Acting | null>(null),
    [scheduling, setScheduling] = useState<Entity | null>(null),
    [deciding, setDeciding] = useState<Deciding | null>(null);
  const add = useNotices((s) => s.add);
  const load = useCallback(async () => {
    try {
      setData(
        await api<Data>(
          'referrals?' +
            new URLSearchParams({ unit: unitId, view, ...(professional ? { professional } : {}) }),
        ),
      );
      setError('');
    } catch (e) {
      setError((e as Error).message);
    }
  }, [unitId, view, professional]);
  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 15000);
    return () => clearInterval(t);
  }, [load]);
  async function act(item: Entity, body: Record<string, unknown>, done: string) {
    setBusy(item.id);
    try {
      await post('referrals/' + item.id, { version: item.version, ...body });
      add(done);
      setActing(null);
      await load();
    } catch (e) {
      setError((e as Error).message);
      throw e;
    } finally {
      setBusy('');
    }
  }
  if (error && !data)
    return (
      <div className="error-banner" role="alert">
        {error}
        <Button variant="ghost" onClick={() => void load()}>
          Tentar novamente
        </Button>
      </div>
    );
  if (!data)
    return (
      <div className="loading">
        <RefreshCw className="spin" size={18} />
        Carregando encaminhamentos…
      </div>
    );
  if (clinician && !data.own)
    return (
      <div className="empty">
        <h2>Seu acesso ainda não está ligado a um profissional</h2>
        <p>
          Peça à gestão para vincular seu usuário ao seu cadastro de profissional em Usuários e
          acessos.
        </p>
      </div>
    );
  const views = clinician
    ? [
        ['professional', 'Para aceitar'],
        ['accepted', 'Aceitos'],
        ['all', 'Todos'],
      ]
    : [
        ['professional', 'Aguardando profissional'],
        ['scheduling', 'Aguardando horário'],
        ['coordination', 'Coordenação clínica'],
        ['accepted', 'Concluídos'],
        ['all', 'Todos'],
      ];
  const groups = [
    ...data.data
      .reduce(
        (m, i) => m.set(i.plan_id, [...(m.get(i.plan_id) || []), i]),
        new Map<string, Entity[]>(),
      )
      .values(),
  ];
  return (
    <>
      <div className="metrics">
        {clinician ? (
          <>
            <MetricCard
              title="Aguardando seu aceite"
              value={data.summary.pending}
              detail="Casos sugeridos pela IA para você"
              icon={Inbox}
            />
            <MetricCard
              title="Aceitos"
              value={data.summary.accepted}
              detail="A recepção agenda a partir do aceite"
              icon={CheckCircle2}
            />
          </>
        ) : (
          <>
            <MetricCard
              title="Aguardando profissional"
              value={data.summary.pending}
              detail="Sugestões que precisam de aceite"
              icon={Inbox}
            />
            <MetricCard
              title="Aguardando horário"
              value={data.summary.scheduling || 0}
              detail="Aceitos, ainda sem sessões reservadas"
              icon={CalendarClock}
            />
            <MetricCard
              title="Coordenação clínica"
              value={data.summary.coordination}
              detail="Sem profissional, recusados ou não oferecidos"
              icon={Users}
            />
            <MetricCard
              title="Concluídos em 30 dias"
              value={data.summary.accepted}
              detail="Agendados ou resolvidos pela coordenação"
              icon={CheckCircle2}
            />
          </>
        )}
      </div>
      <div className="toolbar">
        <div className="segmented" role="group" aria-label="Situação">
          {views.map(([k, l]) => (
            <Button
              key={k}
              variant={view === k ? 'primary' : 'ghost'}
              aria-pressed={view === k}
              onClick={() => setView(k)}
            >
              {l}
            </Button>
          ))}
        </div>
        {!clinician && (
          <select
            className="input"
            aria-label="Filtrar profissional"
            value={professional}
            onChange={(e) => setProfessional(e.target.value)}
          >
            <option value="">Todos os profissionais</option>
            {data.professionals?.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        )}
        {data.canManage && (
          <span className="toolbar-end">
            <ManualReferralButton unitId={unitId} onDone={() => void load()} />
          </span>
        )}
        <Button
          variant="ghost"
          className={data.canManage ? '' : 'toolbar-end'}
          onClick={() => void load()}
        >
          <RefreshCw size={15} />
          Atualizar
        </Button>
      </div>
      {error && (
        <div className="error-banner" role="alert">
          {error}
          <Button variant="ghost" aria-label="Fechar aviso" onClick={() => setError('')}>
            <X size={14} />
          </Button>
        </div>
      )}
      {!groups.length && (
        <div className="card empty">
          <Inbox size={30} />
          <h2>
            {view === 'coordination' ? 'Nada com a coordenação' : 'Nenhum encaminhamento aqui'}
          </h2>
          <p>
            {clinician
              ? 'Quando a IA sugerir você para um serviço de um laudo, o caso aparece aqui para aceite.'
              : 'Os planos montados pela IA a partir de laudos aparecem aqui, item por item.'}
          </p>
        </div>
      )}
      <div className="referral-groups">
        {groups.map((items) => {
          const head = items[0];
          return (
            <section className="card referral-group" key={head.plan_id}>
              <header>
                <div>
                  <h3>{head.patient_label || head.guardian}</h3>
                  <small>
                    {[age(head.age_years), head.notes, ago(head.created_at)]
                      .filter(Boolean)
                      .join(' · ')}
                  </small>
                </div>
                <div className="actions">
                  {head.sandbox && <span className="tag">Sandbox</span>}
                  {data.canManage &&
                    items.some((i) => i.state === 'ACCEPTED' && !i.proposal_id) && (
                      <Button variant="secondary" onClick={() => setScheduling(head)}>
                        <CalendarDays size={15} />
                        Montar horários
                      </Button>
                    )}
                </div>
              </header>
              {data.canManage && (
                <ProposalBar
                  items={items}
                  onDecide={(proposal, action) => setDeciding({ proposal, action, head })}
                />
              )}
              <ul>
                {items.map((i) => {
                  const [tone, label] = referralStatus(i),
                    pending = i.state === 'PENDING',
                    own = clinician || (!!data.own && data.own.id === i.professional_id);
                  return (
                    <li key={i.id} className="referral-item">
                      <div className="referral-item-main">
                        <div className="referral-item-title">
                          <strong>{i.service_text}</strong>
                          <Badge value={tone} label={label} />
                        </div>
                        <div className="tags">
                          {i.specialties.length > 0 && (
                            <span className="tag">{specialtyText(i.specialties)}</span>
                          )}
                          {i.load_text && <span className="tag">{i.load_text}</span>}
                          {i.modality === 'HOME' && (
                            <span className="tag">
                              <Home size={11} />
                              &nbsp;Domicílio
                            </span>
                          )}
                        </div>
                        <p className="referral-who">
                          {i.professional_name ? (
                            <>
                              <Stethoscope size={14} />
                              {i.professional_name}
                            </>
                          ) : (
                            <>
                              <Users size={14} />
                              Coordenação clínica
                            </>
                          )}
                        </p>
                        <p className="muted small">{i.reason}</p>
                        {data.canManage &&
                          (i.state === 'PENDING' || (i.state === 'ACCEPTED' && !i.proposal_id)) && (
                            <div>
                              <ReferralItemEdit item={i} onDone={() => void load()} />
                            </div>
                          )}
                        {i.warnings.length > 0 && (
                          <ul className="referral-warnings">
                            {i.warnings.map((w: string) => (
                              <li key={w}>{w}</li>
                            ))}
                          </ul>
                        )}
                        {i.proposed_slots?.length > 0 && (
                          <SlotSummary item={i} clinician={clinician} />
                        )}
                        {i.route === 'COORDINATION' && i.alternatives.length > 0 && (
                          <p className="muted small">
                            Alternativas:{' '}
                            {i.alternatives
                              .map((a: Entity) => a.name + ' (' + a.fit_score + ')')
                              .join(', ')}
                          </p>
                        )}
                        <details className="referral-history">
                          <summary>Histórico</summary>
                          <ol>
                            {i.history.map((h: Entity, k: number) => (
                              <li key={k}>
                                <b>{actionLabels[h.action] || h.action}</b>
                                {h.by && <> por {h.by}</>} · {ago(h.at)}
                                {h.note && <p>{h.note}</p>}
                              </li>
                            ))}
                          </ol>
                        </details>
                      </div>
                      {pending && (
                        <div className="referral-actions">
                          {i.route === 'PROFESSIONAL' && (own || data.canManage) && (
                            <Button
                              disabled={!!busy}
                              onClick={() =>
                                void act(
                                  i,
                                  { action: 'accept' },
                                  clinician
                                    ? 'Caso aceito. A recepção vai agendar.'
                                    : 'Aceite registrado.',
                                ).catch(() => {})
                              }
                            >
                              <Check size={15} />
                              {clinician ? 'Aceitar caso' : 'Registrar aceite'}
                            </Button>
                          )}
                          {i.route === 'PROFESSIONAL' && (
                            <Button
                              variant="ghost"
                              disabled={!!busy}
                              onClick={() => setActing({ item: i, kind: 'decline' })}
                            >
                              <X size={15} />
                              Recusar
                            </Button>
                          )}
                          {data.canManage && (
                            <Button
                              variant={i.route === 'COORDINATION' ? 'primary' : 'ghost'}
                              disabled={!!busy}
                              onClick={() => setActing({ item: i, kind: 'assign' })}
                            >
                              <ArrowRightLeft size={15} />
                              {i.route === 'COORDINATION'
                                ? 'Atribuir profissional'
                                : 'Redistribuir'}
                            </Button>
                          )}
                          {i.route === 'COORDINATION' && data.canResolve && (
                            <Button
                              variant="ghost"
                              disabled={!!busy}
                              onClick={() => setActing({ item: i, kind: 'resolve' })}
                            >
                              <FileCheck2 size={15} />
                              Concluir
                            </Button>
                          )}
                        </div>
                      )}
                      {!pending && i.decided_by_name && (
                        <small className="muted referral-decided">
                          {i.state === 'RESOLVED'
                            ? 'Concluído'
                            : i.state === 'SCHEDULED'
                              ? 'Reservado'
                              : 'Aceito'}{' '}
                          por {i.decided_by_name}
                        </small>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
      </div>
      {scheduling && (
        <ReferralSchedule
          planId={scheduling.plan_id}
          label={scheduling.patient_label || scheduling.guardian}
          notes={scheduling.notes}
          onClose={() => setScheduling(null)}
          onDone={() => void load()}
        />
      )}
      {deciding && (
        <ProposalDecision
          unitId={unitId}
          deciding={deciding}
          onClose={() => setDeciding(null)}
          onDone={async (msg) => {
            setDeciding(null);
            add(msg);
            await load();
          }}
        />
      )}
      {acting && (
        <ActionDialog
          acting={acting}
          professionals={data.professionals || []}
          busy={!!busy}
          onClose={() => setActing(null)}
          onSubmit={(body, done) => act(acting.item, body, done)}
        />
      )}
    </>
  );
}

function ActionDialog({
  acting,
  professionals,
  busy,
  onClose,
  onSubmit,
}: {
  acting: Acting;
  professionals: Option[];
  busy: boolean;
  onClose: () => void;
  onSubmit: (body: Record<string, unknown>, done: string) => Promise<void>;
}) {
  const { item, kind } = acting;
  const [note, setNote] = useState(''),
    [target, setTarget] = useState(''),
    [error, setError] = useState('');
  const suggested = item.alternatives.map((a: Entity) => a.id) as string[];
  const options = [...professionals]
    .filter((p) => p.id !== item.professional_id)
    .sort(
      (a, b) =>
        Number(suggested.includes(b.id)) - Number(suggested.includes(a.id)) ||
        Number(item.specialties.includes(b.specialty)) -
          Number(item.specialties.includes(a.specialty)),
    );
  const title =
    kind === 'decline'
      ? 'Recusar encaminhamento'
      : kind === 'assign'
        ? 'Atribuir profissional'
        : 'Concluir na coordenação';
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setError('');
    onSubmit(
      kind === 'assign'
        ? { action: 'assign', professional_id: target, note }
        : { action: kind, note },
      kind === 'decline'
        ? 'Item devolvido à coordenação clínica.'
        : kind === 'assign'
          ? 'Encaminhamento enviado ao profissional.'
          : 'Item concluído.',
    ).catch((e) => setError((e as Error).message));
  };
  return (
    <Dialog
      title={title}
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <form className="form" onSubmit={submit}>
        <p className="muted">{item.service_text}</p>
        {kind === 'assign' && (
          <label className="field">
            Profissional
            <select
              className="input"
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              autoFocus
            >
              <option value="">Selecione…</option>
              {options.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} · {specialtyText([p.specialty])}
                  {suggested.includes(p.id) ? ' · alternativa da IA' : ''}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="field">
          {kind === 'decline'
            ? 'Motivo da recusa'
            : kind === 'resolve'
              ? 'O que foi combinado'
              : 'Observação (opcional)'}
          <textarea
            className="input"
            rows={3}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={500}
            placeholder={
              kind === 'decline'
                ? 'Ex.: agenda cheia nas manhãs, sem experiência com o perfil…'
                : kind === 'resolve'
                  ? 'Ex.: família orientada a procurar equoterapia fora da clínica.'
                  : ''
            }
            autoFocus={kind !== 'assign'}
          />
        </label>
        {kind === 'decline' && (
          <small className="muted">
            O item volta para a coordenação clínica, com as alternativas sugeridas pela IA.
          </small>
        )}
        {error && <p className="field-error">{error}</p>}
        <div className="form-footer">
          <Button type="button" variant="secondary" disabled={busy} onClick={onClose}>
            Cancelar
          </Button>
          <Button
            type="submit"
            variant={kind === 'decline' ? 'danger' : 'primary'}
            disabled={busy || (kind === 'assign' ? !target : note.trim().length < 5)}
          >
            {busy
              ? 'Salvando…'
              : kind === 'decline'
                ? 'Recusar e devolver'
                : kind === 'assign'
                  ? 'Enviar ao profissional'
                  : 'Concluir item'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

const time = (v: string) =>
  new Date(v).toLocaleTimeString('pt-BR', {
    timeZone: viewTimezone(),
    hour: '2-digit',
    minute: '2-digit',
  });
const weekday = (v: string) => weekdayNames[localWeekday(v, viewTimezone())];
// Horários da proposta deste item: o profissional acompanha o que foi oferecido e o que já está na agenda.
function SlotSummary({ item, clinician }: { item: Entity; clinician: boolean }) {
  const slots: Entity[] = item.proposed_slots,
    weeks = slots[0].occurrences || 1,
    first = slots.map((s) => s.starts_at).sort()[0];
  return (
    <div className="referral-slots">
      <CalendarCheck2 size={14} />
      <div>
        <strong>
          {slots
            .map(
              (s) =>
                weekday(s.starts_at) +
                ' ' +
                time(s.starts_at) +
                (s.location === 'HOME'
                  ? '–' +
                    time(
                      new Date(new Date(s.starts_at).getTime() + s.duration * 60000).toISOString(),
                    )
                  : ''),
            )
            .join(' · ')}
        </strong>
        <small>
          {weeks} {weeks === 1 ? 'semana' : 'semanas'} a partir de{' '}
          {new Date(first).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}
          {slots[0].location === 'HOME' ? ' · em domicílio' : ''} ·{' '}
          {item.state === 'SCHEDULED'
            ? 'reservado na agenda'
            : item.proposal_status === 'ACCEPTED'
              ? 'família aceitou, falta aprovação'
              : 'aguardando aceite da família'}
        </small>
        {clinician && item.state === 'SCHEDULED' && (
          <Link
            href={
              '/agenda?view=day&date=' +
              new Date(first).toLocaleDateString('sv-SE', { timeZone: viewTimezone() })
            }
          >
            Ver na minha agenda
          </Link>
        )}
      </div>
    </div>
  );
}
// Propostas abertas do plano: a recepção registra o aceite da família e aprova a reserva sem sair da caixa.
function ProposalBar({
  items,
  onDecide,
}: {
  items: Entity[];
  onDecide: (
    p: { id: string; patient_id: string | null },
    a: 'ACCEPT' | 'APPROVE' | 'REJECT',
  ) => void;
}) {
  const open = [
    ...new Map(
      items
        .filter(
          (i) =>
            i.state === 'ACCEPTED' &&
            i.proposal_id &&
            ['DRAFT', 'ACCEPTED'].includes(i.proposal_status),
        )
        .map((i) => [i.proposal_id, i]),
    ).values(),
  ];
  return (
    <>
      {open.map((i) => {
        const p = { id: i.proposal_id, patient_id: i.proposal_patient_id },
          count = items.filter((x) => x.proposal_id === i.proposal_id).length,
          draft = i.proposal_status === 'DRAFT';
        return (
          <div key={i.proposal_id} className="proposal-bar">
            <CalendarClock size={16} />
            <div>
              <strong>
                {draft
                  ? 'Horários enviados · aguardando a família'
                  : 'Família aceitou · falta aprovar a reserva'}
              </strong>
              <small>
                {count} {count === 1 ? 'serviço' : 'serviços'} nesta proposta. Nada é reservado
                antes da aprovação.
              </small>
            </div>
            <div className="actions">
              {draft ? (
                <Button onClick={() => onDecide(p, 'ACCEPT')}>
                  <Check size={15} />
                  Registrar aceite da família
                </Button>
              ) : (
                <Button onClick={() => onDecide(p, 'APPROVE')}>
                  <CalendarCheck2 size={15} />
                  Aprovar e reservar
                </Button>
              )}
              <Button variant="ghost" onClick={() => onDecide(p, 'REJECT')}>
                Recusar proposta
              </Button>
            </div>
          </div>
        );
      })}
    </>
  );
}
function ProposalDecision({
  unitId,
  deciding,
  onClose,
  onDone,
}: {
  unitId: string;
  deciding: Deciding;
  onClose: () => void;
  onDone: (msg: string) => Promise<void>;
}) {
  const { proposal, action, head } = deciding;
  const [reason, setReason] = useState(
      action === 'ACCEPT'
        ? 'Família confirmou os horários pelo WhatsApp.'
        : action === 'APPROVE'
          ? 'Identidade e vínculo conferidos com o responsável.'
          : '',
    ),
    [patient, setPatient] = useState(proposal.patient_id || ''),
    [confirmed, setConfirmed] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const title =
    action === 'ACCEPT'
      ? 'Registrar aceite da família'
      : action === 'APPROVE'
        ? 'Aprovar e reservar'
        : 'Recusar proposta';
  const valid = reason.trim().length >= 10 && (action !== 'APPROVE' || (!!patient && confirmed));
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const r = await post<{ count: number }>('operations', {
        operation: 'PROPOSAL_DECIDE',
        unit_id: unitId,
        proposal_id: proposal.id,
        action,
        reason,
        identity_confirmed: confirmed,
        ...(patient ? { patient_id: patient } : {}),
      });
      await onDone(
        action === 'APPROVE'
          ? r.count + ' sessões reservadas na agenda.'
          : action === 'ACCEPT'
            ? 'Aceite da família registrado.'
            : 'Proposta recusada. Os itens voltam a aguardar horário.',
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      title={title}
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <form className="form" onSubmit={submit}>
        <p className="muted">
          {head.patient_label || head.guardian}
          {action === 'APPROVE'
            ? ' · as sessões entram na agenda como série semanal e as especialidades do laudo entram no pedido do paciente.'
            : ''}
        </p>
        {action === 'APPROVE' && (
          <>
            <div className="field">
              <label htmlFor="proposal-patient">Paciente cadastrado</label>
              <DirectorySelect
                id="proposal-patient"
                kind="patients"
                unitId={unitId}
                value={patient}
                onChange={setPatient}
              />
              <small>Se ainda não existe, cadastre em Pacientes e volte aqui.</small>
            </div>
            <label className="sandbox-consent">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
              />
              Conferi a identidade e o vínculo com o responsável
            </label>
          </>
        )}
        <label className="field">
          {action === 'ACCEPT'
            ? 'Como a família confirmou'
            : action === 'APPROVE'
              ? 'Observação da aprovação'
              : 'Motivo da recusa'}
          <textarea
            className="input"
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={3000}
            placeholder={
              action === 'REJECT' ? 'Ex.: família prefere tardes; montar nova proposta.' : ''
            }
          />
        </label>
        {error && <p className="field-error">{error}</p>}
        <div className="form-footer">
          <Button type="button" variant="secondary" disabled={busy} onClick={onClose}>
            Cancelar
          </Button>
          <Button
            type="submit"
            variant={action === 'REJECT' ? 'danger' : 'primary'}
            disabled={busy || !valid}
          >
            {busy ? 'Salvando…' : title}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
