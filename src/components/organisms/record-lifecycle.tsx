'use client';
import { useEffect, useState, type FormEvent } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import {
  History,
  Power,
  PowerOff,
  ArrowRightLeft,
  Trash2,
  ListOrdered,
  Plus,
  Pencil,
  Archive,
  ArchiveRestore,
} from 'lucide-react';
import { api, post, patch } from '@/lib/client';
import { currency, type Entity } from '@/lib/types';
import { labels, specialtyOptions } from '@/lib/schemas';
import { useNotices } from '@/stores/workspace';
import { Button } from '../atoms/button';
import { Badge } from '../atoms/badge';
import { Dialog } from '../molecules/dialog';
// Ações de ciclo de vida dos cadastros: desativar/reativar (alta do paciente), trocar de unidade, histórico de versões,
// remover documento e procedimentos/preços do convênio. As regras e permissões são conferidas no servidor.
type Resource = 'patients' | 'professionals' | 'insurers' | 'rooms' | 'inventory';
type Versioned = Resource | 'agents' | 'models' | 'ledger';
const managers = ['ADMIN', 'MANAGEMENT'],
  reception = [...managers, 'RECEPTION'];
const words: Record<
  Resource,
  { off: string; on: string; offDone: string; onDone: string; hint: string }
> = {
  patients: {
    off: 'Dar alta',
    on: 'Reativar paciente',
    offDone: 'Alta registrada.',
    onDone: 'Paciente reativado.',
    hint: 'Com a alta, o paciente não recebe novos agendamentos e sai da lista de espera. O prontuário continua disponível. Sessões futuras precisam ser canceladas antes.',
  },
  professionals: {
    off: 'Desativar',
    on: 'Reativar profissional',
    offDone: 'Profissional desativado.',
    onDone: 'Profissional reativado.',
    hint: 'O profissional deixa de aparecer para novos agendamentos. Encaminhamentos ainda não aceitos voltam para a coordenação clínica. Se houver sessões futuras, use "Desligar e transferir carteira".',
  },
  insurers: {
    off: 'Desativar convênio',
    on: 'Reativar convênio',
    offDone: 'Convênio desativado.',
    onDone: 'Convênio reativado.',
    hint: 'Pacientes atuais continuam com o convênio; ele só deixa de ser oferecido em cadastros novos e trocas.',
  },
  inventory: {
    off: 'Arquivar item',
    on: 'Reativar item',
    offDone: 'Item arquivado.',
    onDone: 'Item reativado.',
    hint: 'O item deixa de receber movimentações e sai da lista de reposição. O histórico de movimentos continua.',
  },
  rooms: {
    off: 'Desativar sala',
    on: 'Reativar sala',
    offDone: 'Sala desativada.',
    onDone: 'Sala reativada.',
    hint: 'A sala deixa de aparecer em cadastros de profissionais. Antes, mude os profissionais que usam a sala e resolva as sessões futuras.',
  },
};
const fieldNames: Record<string, string> = {
  name: 'Nome',
  guardian: 'Responsável',
  phone: 'Telefone',
  birth_date: 'Nascimento',
  insurer_id: 'Convênio',
  card_number: 'Carteirinha',
  unit_id: 'Unidade',
  active: 'Ativo',
  discharge_reason: 'Motivo da alta',
  room_id: 'Sala',
  specialty: 'Especialidade',
  contract: 'Vínculo',
  hourly_rate: 'Valor da hora',
  competencies: 'Competências',
  capacity: 'Capacidade',
  'metadata.specialties': 'Especialidades do pedido',
  'metadata.order_expires': 'Validade do pedido',
  'metadata.authorized_total': 'Sessões autorizadas',
  'metadata.notes': 'Observações',
  'metadata.min_age': 'Idade mínima',
  'metadata.max_age': 'Idade máxima',
  'metadata.work_days': 'Dias de atendimento',
  'rules.duration': 'Duração da sessão',
  'rules.session_value': 'Valor da sessão',
  'rules.token_required': 'Exige token',
  'rules.signature_required': 'Exige assinatura',
  'rules.documents': 'Documentos exigidos',
  'rules.notes': 'Observações do contrato',
};
const show = (v: unknown) =>
  v === null || v === undefined || v === ''
    ? '—'
    : typeof v === 'boolean'
      ? v
        ? 'Sim'
        : 'Não'
      : Array.isArray(v)
        ? v.map((x) => labels[String(x)] || String(x)).join(', ') || '—'
        : String(v);
export function RecordActions({
  resource,
  entity,
  role,
  units = [],
  onChanged,
}: {
  resource: Resource;
  entity: Entity;
  role: string;
  units?: { id: string; name: string }[];
  onChanged: () => void;
}) {
  const [dialog, setDialog] = useState<'active' | 'history' | 'transfer' | null>(null);
  const canToggle = (
      resource === 'patients'
        ? reception
        : resource === 'inventory'
          ? [...managers, 'FINANCE']
          : managers
    ).includes(role),
    active = entity.active !== false;
  return (
    <div className="record-actions">
      <Button variant="ghost" onClick={() => setDialog('history')}>
        <History size={15} />
        Histórico
      </Button>
      {resource === 'patients' && managers.includes(role) && active && units.length > 1 && (
        <Button variant="ghost" onClick={() => setDialog('transfer')}>
          <ArrowRightLeft size={15} />
          Trocar de unidade
        </Button>
      )}
      {canToggle && (
        <Button variant={active ? 'ghost' : 'secondary'} onClick={() => setDialog('active')}>
          {active ? <PowerOff size={15} /> : <Power size={15} />}
          {active ? words[resource].off : words[resource].on}
        </Button>
      )}
      {dialog === 'history' && (
        <HistoryDialog resource={resource} entity={entity} onClose={() => setDialog(null)} />
      )}
      {dialog === 'active' && (
        <ActiveDialog
          resource={resource}
          entity={entity}
          onClose={() => setDialog(null)}
          onDone={() => {
            setDialog(null);
            onChanged();
          }}
        />
      )}
      {dialog === 'transfer' && (
        <TransferDialog
          entity={entity}
          units={units}
          onClose={() => setDialog(null)}
          onDone={() => {
            setDialog(null);
            onChanged();
          }}
        />
      )}
    </div>
  );
}
function ActiveDialog({
  resource,
  entity,
  onClose,
  onDone,
}: {
  resource: Resource;
  entity: Entity;
  onClose: () => void;
  onDone: () => void;
}) {
  const add = useNotices((s) => s.add),
    off = entity.active !== false,
    w = words[resource];
  const [reason, setReason] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const r = await post<Entity>(`records/${resource}/${entity.id}/active`, {
        active: !off,
        ...(reason.trim() ? { reason } : {}),
        ...(entity.version ? { version: entity.version } : {}),
      });
      add(
        (off ? w.offDone : w.onDone) +
          (r.notice ? ' ' + r.notice[0].toUpperCase() + r.notice.slice(1) + '.' : ''),
      );
      onDone();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      title={(off ? w.off : w.on) + ' · ' + entity.name}
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <form className="form" onSubmit={submit}>
        <p className="muted">
          {off ? w.hint : 'O cadastro volta a ficar disponível para novos registros.'}
        </p>
        {off && (
          <label className="field">
            Motivo
            <textarea
              className="input"
              rows={2}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={1000}
              autoFocus
            />
          </label>
        )}
        {error && <p className="field-error">{error}</p>}
        <div className="form-footer">
          <Button type="button" variant="secondary" disabled={busy} onClick={onClose}>
            Cancelar
          </Button>
          <Button
            type="submit"
            variant={off ? 'danger' : 'primary'}
            disabled={busy || (off && reason.trim().length < 5)}
          >
            {busy ? 'Salvando…' : off ? w.off : w.on}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
function TransferDialog({
  entity,
  units,
  onClose,
  onDone,
}: {
  entity: Entity;
  units: { id: string; name: string }[];
  onClose: () => void;
  onDone: () => void;
}) {
  const add = useNotices((s) => s.add),
    [unit, setUnit] = useState(''),
    [reason, setReason] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await post(`records/patients/${entity.id}/transfer-unit`, {
        unit_id: unit,
        reason,
        version: entity.version,
      });
      add('Paciente transferido de unidade.');
      onDone();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      title={'Trocar de unidade · ' + entity.name}
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <form className="form" onSubmit={submit}>
        <p className="muted">
          Exige que o paciente não tenha sessões futuras nem pedidos abertos na lista de espera. Os
          profissionais fixos da unidade antiga são removidos do cadastro.
        </p>
        <label className="field">
          Nova unidade
          <select
            className="input"
            value={unit}
            onChange={(e) => setUnit(e.target.value)}
            autoFocus
          >
            <option value="">Selecione…</option>
            {units
              .filter((u) => u.id !== entity.unit_id)
              .map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
          </select>
        </label>
        <label className="field">
          Motivo
          <textarea
            className="input"
            rows={2}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={1000}
          />
        </label>
        {error && <p className="field-error">{error}</p>}
        <div className="form-footer">
          <Button type="button" variant="secondary" disabled={busy} onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" disabled={busy || !unit || reason.trim().length < 5}>
            {busy ? 'Transferindo…' : 'Transferir'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
function HistoryDialog({
  resource,
  entity,
  onClose,
  onRestore,
}: {
  resource: Versioned;
  entity: Entity;
  onClose: () => void;
  onRestore?: (version: number) => void;
}) {
  const [rows, setRows] = useState<Entity[] | null>(null),
    [error, setError] = useState('');
  useEffect(() => {
    api<{ data: Entity[] }>(`records/${resource}/${entity.id}/history`)
      .then((r) => setRows(r.data))
      .catch((e) => setError(e.message));
  }, [resource, entity.id]);
  return (
    <Dialog title={'Histórico · ' + entity.name} onClose={onClose} wide>
      {error && <p className="error-banner">{error}</p>}
      {!rows && !error && <p className="muted">Carregando…</p>}
      {rows && (
        <ol className="version-list">
          {rows.map((v) => (
            <li key={v.version}>
              <div className="actions between">
                <strong>Versão {v.version}</strong>
                <small className="muted">
                  {v.created_at
                    ? formatDistanceToNow(new Date(v.created_at), { addSuffix: true, locale: ptBR })
                    : 'Versão atual'}
                  {v.author ? ' · ' + v.author : ''}
                </small>
              </div>
              {v.reason && <p className="small">{v.reason}</p>}
              {onRestore && v.version !== entity.version && (
                <Button
                  variant="ghost"
                  className="version-restore"
                  onClick={() => onRestore(v.version)}
                >
                  Restaurar esta versão
                </Button>
              )}
              {v.changes.length > 0 && (
                <table className="version-changes">
                  <tbody>
                    {v.changes.map((c: Entity) => (
                      <tr key={c.field}>
                        <td>{fieldNames[c.field] || c.field}</td>
                        <td className="muted">{show(c.before)}</td>
                        <td>→ {show(c.after)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </li>
          ))}
        </ol>
      )}
    </Dialog>
  );
}
export function RemoveDocumentButton({ doc, onDone }: { doc: Entity; onDone: () => void }) {
  const add = useNotices((s) => s.add),
    [open, setOpen] = useState(false),
    [reason, setReason] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await post(`records/documents/${doc.id}/remove`, { reason });
      add('Documento removido. O registro fica na auditoria.');
      setOpen(false);
      onDone();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Button
        variant="ghost"
        aria-label={'Remover ' + doc.name}
        title="Remover documento"
        onClick={() => setOpen(true)}
      >
        <Trash2 size={15} />
      </Button>
      {open && (
        <Dialog
          title={'Remover documento · ' + doc.name}
          onClose={() => {
            if (!busy) setOpen(false);
          }}
        >
          <form className="form" onSubmit={submit}>
            <p className="muted">
              O arquivo deixa de aparecer e de poder ser baixado. Quem removeu, quando e o motivo
              ficam na auditoria. Comprovantes de pagamento não podem ser removidos.
            </p>
            <label className="field">
              Motivo
              <textarea
                className="input"
                rows={2}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                maxLength={500}
                autoFocus
              />
            </label>
            {error && <p className="field-error">{error}</p>}
            <div className="form-footer">
              <Button
                type="button"
                variant="secondary"
                disabled={busy}
                onClick={() => setOpen(false)}
              >
                Cancelar
              </Button>
              <Button type="submit" variant="danger" disabled={busy || reason.trim().length < 5}>
                {busy ? 'Removendo…' : 'Remover'}
              </Button>
            </div>
          </form>
        </Dialog>
      )}
    </>
  );
}
// Procedimentos e preços do convênio: substituem o valor único da sessão no faturamento quando cadastrados.
export function ProceduresButton({ insurer, canManage }: { insurer: Entity; canManage: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="ghost" onClick={() => setOpen(true)}>
        <ListOrdered size={15} />
        Procedimentos e preços
      </Button>
      {open && (
        <ProceduresDialog insurer={insurer} canManage={canManage} onClose={() => setOpen(false)} />
      )}
    </>
  );
}
const emptyProc = { code: '', description: '', specialty: '', duration: 60, price: 0 };
function ProceduresDialog({
  insurer,
  canManage,
  onClose,
}: {
  insurer: Entity;
  canManage: boolean;
  onClose: () => void;
}) {
  const add = useNotices((s) => s.add);
  const [rows, setRows] = useState<Entity[] | null>(null),
    [form, setForm] = useState<Record<string, any> | null>(null),
    [editing, setEditing] = useState<string | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const load = () =>
    api<{ data: Entity[] }>(`procedures/${insurer.id}`)
      .then((r) => setRows(r.data))
      .catch((e) => setError(e.message));
  useEffect(() => {
    void load();
  }, [insurer.id]); // eslint-disable-line react-hooks/exhaustive-deps
  async function save(e: FormEvent) {
    e.preventDefault();
    if (!form) return;
    setBusy(true);
    setError('');
    try {
      const body = {
        code: form.code,
        description: form.description,
        specialty: form.specialty || null,
        duration: Number(form.duration),
        price: Number(form.price),
      };
      if (editing) await patch(`procedures/${insurer.id}/${editing}`, body);
      else await post(`procedures/${insurer.id}`, body);
      add('Procedimento salvo.');
      setForm(null);
      setEditing(null);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function toggle(r: Entity) {
    setError('');
    try {
      await patch(`procedures/${insurer.id}/${r.id}`, { active: !r.active });
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <Dialog title={'Procedimentos e preços · ' + insurer.name} onClose={onClose} wide>
      <p className="muted small">
        O faturamento usa o preço do procedimento ativo da mesma especialidade e duração da sessão.
        Procedimento sem especialidade vale para todas. Sem procedimento cadastrado, vale o valor da
        sessão do convênio ({currency(insurer.rules?.session_value || 0)} por{' '}
        {insurer.rules?.duration || 60} min).
      </p>
      {error && <p className="field-error">{error}</p>}
      {!rows ? (
        <p className="muted">Carregando…</p>
      ) : (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Código TUSS</th>
                <th>Descrição</th>
                <th>Especialidade</th>
                <th>Duração</th>
                <th>Preço</th>
                <th>Situação</th>
                {canManage && <th aria-label="Ações" />}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className={r.active ? '' : 'registry-inactive'}>
                  <td>
                    <code>{r.code}</code>
                  </td>
                  <td>{r.description}</td>
                  <td>{r.specialty ? labels[r.specialty] || r.specialty : 'Todas'}</td>
                  <td>{r.duration} min</td>
                  <td>{currency(r.price)}</td>
                  <td>
                    {r.active ? (
                      <Badge value="COMPLETED" label="Ativo" />
                    ) : (
                      <Badge value="neutral" label="Desativado" />
                    )}
                  </td>
                  {canManage && (
                    <td>
                      <div className="actions registry-actions">
                        <Button
                          variant="ghost"
                          aria-label="Editar procedimento"
                          onClick={() => {
                            setEditing(r.id);
                            setForm({
                              code: r.code,
                              description: r.description,
                              specialty: r.specialty || '',
                              duration: r.duration,
                              price: r.price,
                            });
                          }}
                        >
                          <Pencil size={15} />
                        </Button>
                        <Button
                          variant="ghost"
                          aria-label={r.active ? 'Desativar procedimento' : 'Reativar procedimento'}
                          onClick={() => void toggle(r)}
                        >
                          {r.active ? <PowerOff size={15} /> : <Power size={15} />}
                        </Button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
          {!rows.length && <p className="empty small">Nenhum procedimento cadastrado.</p>}
        </div>
      )}
      {canManage && !form && (
        <Button
          variant="secondary"
          onClick={() => {
            setEditing(null);
            setForm({ ...emptyProc });
          }}
        >
          <Plus size={15} />
          Novo procedimento
        </Button>
      )}
      {form && (
        <form className="procedure-form" onSubmit={save}>
          <label className="field">
            Código TUSS
            <input
              className="input"
              value={form.code}
              onChange={(e) => setForm({ ...form, code: e.target.value })}
              placeholder="50000470"
              autoFocus
            />
          </label>
          <label className="field">
            Descrição
            <input
              className="input"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder="Sessão de fonoaudiologia"
            />
          </label>
          <label className="field">
            Especialidade
            <select
              className="input"
              value={form.specialty}
              onChange={(e) => setForm({ ...form, specialty: e.target.value })}
            >
              <option value="">Todas</option>
              {specialtyOptions().map(([c, n]) => (
                <option key={c} value={c}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            Duração (min)
            <input
              className="input"
              type="number"
              min={15}
              max={240}
              step={15}
              value={form.duration}
              onChange={(e) => setForm({ ...form, duration: e.target.value })}
            />
          </label>
          <label className="field">
            Preço (R$)
            <input
              className="input"
              type="number"
              min={0}
              step="0.01"
              value={form.price}
              onChange={(e) => setForm({ ...form, price: e.target.value })}
            />
          </label>
          <div className="form-footer">
            <Button
              type="button"
              variant="secondary"
              disabled={busy}
              onClick={() => {
                setForm(null);
                setEditing(null);
              }}
            >
              Cancelar
            </Button>
            <Button
              type="submit"
              disabled={busy || form.code.trim().length < 3 || form.description.trim().length < 3}
            >
              {busy ? 'Salvando…' : editing ? 'Salvar procedimento' : 'Adicionar'}
            </Button>
          </div>
        </form>
      )}
    </Dialog>
  );
}

// Histórico de qualquer registro versionado; em agentes e modelos permite restaurar uma versão anterior (vira versão nova).
export function HistoryButton({
  resource,
  entity,
  onRestored,
}: {
  resource: Versioned;
  entity: Entity;
  onRestored?: () => void;
}) {
  const add = useNotices((s) => s.add),
    [open, setOpen] = useState(false);
  const restore =
    onRestored && (resource === 'agents' || resource === 'models')
      ? async (version: number) => {
          try {
            await post('actions/restore-version', { resource, id: entity.id, version });
            add('Versão ' + version + ' restaurada como versão nova.');
            setOpen(false);
            onRestored();
          } catch (e) {
            add((e as Error).message);
          }
        }
      : undefined;
  return (
    <>
      <Button variant="ghost" onClick={() => setOpen(true)}>
        <History size={15} />
        {resource === 'agents' || resource === 'models' ? 'Versões' : 'Histórico'}
      </Button>
      {open && (
        <HistoryDialog
          resource={resource}
          entity={entity}
          onClose={() => setOpen(false)}
          onRestore={restore}
        />
      )}
    </>
  );
}
// Ação com motivo (cancelar, estornar, arquivar...): abre um diálogo e envia para /api/actions/<ação>.
export function ReasonButton({
  label,
  title,
  description,
  action,
  payload,
  done,
  variant = 'ghost',
  danger = true,
  icon,
  onDone,
  optionalReason = false,
}: {
  label: string;
  title: string;
  description: string;
  action: string;
  payload: Record<string, unknown>;
  done: string | ((r: any) => string);
  variant?: 'ghost' | 'secondary' | 'primary';
  danger?: boolean;
  icon?: React.ReactNode;
  onDone: () => void;
  optionalReason?: boolean;
}) {
  const add = useNotices((s) => s.add),
    [open, setOpen] = useState(false),
    [reason, setReason] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const r = await post('actions/' + action, {
        ...payload,
        ...(reason.trim() ? { reason } : {}),
      });
      add(typeof done === 'function' ? done(r) : done);
      setOpen(false);
      setReason('');
      onDone();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Button variant={variant} onClick={() => setOpen(true)}>
        {icon}
        {label}
      </Button>
      {open && (
        <Dialog
          title={title}
          onClose={() => {
            if (!busy) setOpen(false);
          }}
        >
          <form className="form" onSubmit={submit}>
            <p className="muted">{description}</p>
            <label className="field">
              {optionalReason ? 'Motivo (opcional)' : 'Motivo'}
              <textarea
                className="input"
                rows={2}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                maxLength={1000}
                autoFocus
              />
            </label>
            {error && <p className="field-error">{error}</p>}
            <div className="form-footer">
              <Button
                type="button"
                variant="secondary"
                disabled={busy}
                onClick={() => setOpen(false)}
              >
                Voltar
              </Button>
              <Button
                type="submit"
                variant={danger ? 'danger' : 'primary'}
                disabled={busy || (!optionalReason && reason.trim().length < 5)}
              >
                {busy ? 'Salvando…' : label}
              </Button>
            </div>
          </form>
        </Dialog>
      )}
    </>
  );
}
export function ArchiveButton({
  resource,
  entity,
  onDone,
}: {
  resource: 'agents' | 'models';
  entity: Entity;
  onDone: () => void;
}) {
  const archived = !!entity.archived_at,
    noun = resource === 'agents' ? 'agente' : 'modelo',
    Noun = noun[0].toUpperCase() + noun.slice(1);
  const description = archived
    ? resource === 'agents'
      ? 'O agente volta para a lista. Para usar no atendimento, habilite-o em Configurar agente.'
      : 'O modelo volta a aparecer para novas avaliações.'
    : resource === 'agents'
      ? 'O agente é pausado e sai da lista e da orquestração. O histórico de versões e das conversas continua.'
      : 'O modelo deixa de aparecer para novas avaliações. Avaliações já feitas continuam no prontuário.';
  return (
    <ReasonButton
      label={archived ? 'Restaurar' : 'Arquivar'}
      icon={archived ? <ArchiveRestore size={15} /> : <Archive size={15} />}
      title={(archived ? 'Restaurar ' : 'Arquivar ') + noun + ' · ' + entity.name}
      danger={!archived}
      optionalReason={archived}
      description={description}
      action="archive"
      payload={{ resource, id: entity.id, archived: !archived }}
      done={Noun + (archived ? ' restaurado.' : ' arquivado.')}
      onDone={onDone}
    />
  );
}
// Correção de lançamento em aberto (descrição, valor, vencimento, categoria, contraparte), com motivo e nova versão.
export function LedgerCorrection({ row, onDone }: { row: Entity; onDone: () => void }) {
  const add = useNotices((s) => s.add),
    [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const [form, setForm] = useState({
    description: row.description,
    amount: String(row.amount),
    due_date: String(row.due_date).slice(0, 10),
    category: row.category,
    counterparty: row.counterparty || '',
    reason: '',
  });
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await patch('ledger/' + row.id, {
        version: row.version,
        reason: form.reason,
        data: {
          unit_id: row.unit_id,
          kind: row.kind,
          description: form.description,
          amount: Number(form.amount),
          due_date: form.due_date,
          category: form.category,
          counterparty: form.counterparty,
          ...(row.counterparty_ref ? { counterparty_ref: row.counterparty_ref } : {}),
        },
      });
      add('Lançamento corrigido. A versão anterior fica no histórico.');
      setOpen(false);
      onDone();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Button variant="ghost" onClick={() => setOpen(true)}>
        <Pencil size={15} />
        Corrigir lançamento
      </Button>
      {open && (
        <Dialog
          title={'Corrigir · ' + row.description}
          onClose={() => {
            if (!busy) setOpen(false);
          }}
        >
          <form className="form" onSubmit={submit}>
            <div className="form-grid">
              <label className="field">
                Descrição
                <input
                  className="input"
                  value={form.description}
                  onChange={(e) => set('description', e.target.value)}
                />
              </label>
              <label className="field">
                Valor (R$)
                <input
                  className="input"
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={form.amount}
                  onChange={(e) => set('amount', e.target.value)}
                />
              </label>
              <label className="field">
                Vencimento
                <input
                  className="input"
                  type="date"
                  value={form.due_date}
                  onChange={(e) => set('due_date', e.target.value)}
                />
              </label>
              <label className="field">
                Categoria
                <input
                  className="input"
                  value={form.category}
                  onChange={(e) => set('category', e.target.value)}
                />
              </label>
            </div>
            <label className="field">
              Contraparte
              <input
                className="input"
                value={form.counterparty}
                onChange={(e) => set('counterparty', e.target.value)}
              />
            </label>
            <label className="field">
              Motivo da correção
              <textarea
                className="input"
                rows={2}
                value={form.reason}
                onChange={(e) => set('reason', e.target.value)}
                maxLength={3000}
              />
            </label>
            {error && <p className="field-error">{error}</p>}
            <div className="form-footer">
              <Button
                type="button"
                variant="secondary"
                disabled={busy}
                onClick={() => setOpen(false)}
              >
                Voltar
              </Button>
              <Button
                type="submit"
                disabled={busy || form.reason.trim().length < 10 || !(Number(form.amount) > 0)}
              >
                {busy ? 'Salvando…' : 'Salvar correção'}
              </Button>
            </div>
          </form>
        </Dialog>
      )}
    </>
  );
}
// Edição das preferências de um pedido aberto da lista de espera.
export function WaitlistEdit({ row, onDone }: { row: Entity; onDone: () => void }) {
  const add = useNotices((s) => s.add),
    [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const [form, setForm] = useState({
    specialty: row.specialty,
    preferred_days: (row.preferred_days || []) as number[],
    preferred_period: row.preferred_period || 'ANY',
    priority: row.priority || 'NORMAL',
    notes: row.notes || '',
  });
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await post('actions/waitlist-update', { id: row.id, ...form });
      add('Pedido da lista de espera atualizado.');
      setOpen(false);
      onDone();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Button variant="ghost" onClick={() => setOpen(true)}>
        <Pencil size={15} />
        Editar
      </Button>
      {open && (
        <Dialog
          title={'Lista de espera · ' + row.patient_name}
          onClose={() => {
            if (!busy) setOpen(false);
          }}
        >
          <form className="form" onSubmit={submit}>
            <div className="form-grid">
              <label className="field">
                Especialidade
                <select
                  className="input"
                  value={form.specialty}
                  onChange={(e) => setForm({ ...form, specialty: e.target.value })}
                >
                  {specialtyOptions().map(([c, n]) => (
                    <option key={c} value={c}>
                      {n}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                Período
                <select
                  className="input"
                  value={form.preferred_period}
                  onChange={(e) => setForm({ ...form, preferred_period: e.target.value })}
                >
                  <option value="ANY">Qualquer</option>
                  <option value="MORNING">Manhã</option>
                  <option value="AFTERNOON">Tarde</option>
                </select>
              </label>
              <label className="field">
                Prioridade
                <select
                  className="input"
                  value={form.priority}
                  onChange={(e) => setForm({ ...form, priority: e.target.value })}
                >
                  <option value="NORMAL">Normal</option>
                  <option value="HIGH">Alta</option>
                </select>
              </label>
            </div>
            <fieldset className="registry-specialties">
              <legend>Dias disponíveis</legend>
              {['Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'].map((d, i) => (
                <label key={d}>
                  <input
                    type="checkbox"
                    checked={form.preferred_days.includes(i + 1)}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        preferred_days: e.target.checked
                          ? [...form.preferred_days, i + 1].sort()
                          : form.preferred_days.filter((x) => x !== i + 1),
                      })
                    }
                  />
                  {d}
                </label>
              ))}
            </fieldset>
            <label className="field">
              Observações
              <textarea
                className="input"
                rows={2}
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                maxLength={1000}
              />
            </label>
            {error && <p className="field-error">{error}</p>}
            <div className="form-footer">
              <Button
                type="button"
                variant="secondary"
                disabled={busy}
                onClick={() => setOpen(false)}
              >
                Voltar
              </Button>
              <Button type="submit" disabled={busy}>
                {busy ? 'Salvando…' : 'Salvar'}
              </Button>
            </div>
          </form>
        </Dialog>
      )}
    </>
  );
}
