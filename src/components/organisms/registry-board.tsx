'use client';
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Plus, Search, RefreshCw, Power, PowerOff, Pencil } from 'lucide-react';
import { api, post, patch } from '@/lib/client';
import type { Entity, Meta } from '@/lib/types';
import { labels, specialtyOptions, setSpecialties } from '@/lib/schemas';
import { useNotices } from '@/stores/workspace';
import { Button } from '../atoms/button';
import { Badge } from '../atoms/badge';
import { Input } from '../atoms/input';
import { Dialog } from '../molecules/dialog';
// Cadastros base em Configurações: unidades, filas, especialidades e competências. Desativar em vez de apagar.
type Kind = 'units' | 'queues' | 'specialties' | 'competencies';
type Field = {
  name: string;
  label: string;
  type?: 'text' | 'number' | 'checkbox' | 'textarea' | 'list' | 'specialties';
  hint?: string;
  createOnly?: boolean;
};
const config: Record<
  Kind,
  {
    title: string;
    intro: string;
    noun: string;
    fields: Field[];
    columns: [string, (r: Entity) => React.ReactNode][];
  }
> = {
  units: {
    title: 'Unidades',
    noun: 'unidade',
    intro:
      'Cada unidade tem a própria agenda, salas, profissionais e filas. Uma unidade nova já nasce com as 6 filas de atendimento. Para desativar, transfira antes os profissionais e as sessões futuras.',
    fields: [
      { name: 'name', label: 'Nome' },
      {
        name: 'sort_order',
        label: 'Ordem no seletor',
        type: 'number',
        hint: 'Menor aparece primeiro.',
      },
    ],
    columns: [
      ['Unidade', (r) => <strong>{r.name}</strong>],
      ['Ordem', (r) => r.sort_order],
      ['Profissionais ativos', (r) => r.professionals],
      ['Pacientes', (r) => r.patients],
    ],
  },
  queues: {
    title: 'Filas de atendimento',
    noun: 'fila',
    intro:
      'Filas para onde a IA e a equipe encaminham os atendimentos desta unidade. As 6 filas de sistema são usadas pela IA: podem ser renomeadas, mas não desativadas.',
    fields: [
      { name: 'name', label: 'Nome' },
      { name: 'sort_order', label: 'Ordem', type: 'number' },
    ],
    columns: [
      ['Fila', (r) => <strong>{r.name}</strong>],
      ['Código', (r) => <code>{r.code}</code>],
      [
        'Tipo',
        (r) =>
          r.system ? (
            <Badge value="CONFIRMED" label="Sistema" />
          ) : (
            <Badge value="neutral" label="Personalizada" />
          ),
      ],
      ['Atendimentos abertos', (r) => r.open_conversations],
    ],
  },
  specialties: {
    title: 'Especialidades',
    noun: 'especialidade',
    intro:
      'Áreas de atendimento da clínica, usadas em profissionais, pacientes, agenda, busca de horários e pela IA. "Atendimento em grupo" permite várias sessões na mesma sala ao mesmo tempo (como na terapia ABA).',
    fields: [
      { name: 'name', label: 'Nome' },
      {
        name: 'code',
        label: 'Código',
        createOnly: true,
        hint: 'Opcional. Gerado a partir do nome; não muda depois.',
      },
      { name: 'shared_room', label: 'Atendimento em grupo (sala coletiva)', type: 'checkbox' },
      { name: 'sort_order', label: 'Ordem', type: 'number' },
    ],
    columns: [
      ['Especialidade', (r) => <strong>{r.name}</strong>],
      ['Código', (r) => <code>{r.code}</code>],
      ['Em grupo', (r) => (r.shared_room ? 'Sim' : 'Não')],
      ['Profissionais ativos', (r) => r.professionals],
    ],
  },
  competencies: {
    title: 'Competências',
    noun: 'competência',
    intro:
      'Métodos, abordagens e perfis atendidos. A IA usa os sinônimos para reconhecer o que o laudo pede e escolher o profissional. "Não oferecido" marca serviços que a clínica não faz, como equoterapia.',
    fields: [
      { name: 'name', label: 'Nome' },
      {
        name: 'code',
        label: 'Código',
        createOnly: true,
        hint: 'Opcional. Gerado a partir do nome; não muda depois.',
      },
      { name: 'description', label: 'Descrição', type: 'textarea' },
      {
        name: 'synonyms',
        label: 'Sinônimos (separados por vírgula)',
        type: 'list',
        hint: 'Como a família ou o laudo escrevem: "integração sensorial, Ayres".',
      },
      { name: 'specialties', label: 'Especialidades que aplicam', type: 'specialties' },
      { name: 'offered', label: 'A clínica oferece este serviço', type: 'checkbox' },
    ],
    columns: [
      [
        'Competência',
        (r) => (
          <>
            <strong>{r.name}</strong>
            {r.description && <small className="muted registry-desc">{r.description}</small>}
          </>
        ),
      ],
      ['Código', (r) => <code>{r.code}</code>],
      [
        'Especialidades',
        (r) => (r.specialties || []).map((s: string) => labels[s] || s).join(', ') || '—',
      ],
      ['Sinônimos', (r) => (r.synonyms || []).length],
      ['Oferecido', (r) => (r.offered ? 'Sim' : <Badge value="PENDING" label="Não oferecido" />)],
      ['Profissionais', (r) => r.professionals],
    ],
  },
};
const keyOf = (k: Kind, r: Entity) => (k === 'specialties' || k === 'competencies' ? r.code : r.id);
export function RegistryBoard({ kind, unitId }: { kind: Kind; unitId: string }) {
  const c = config[kind],
    add = useNotices((s) => s.add);
  const [data, setData] = useState<{ data: Entity[]; canCreate: boolean } | null>(null),
    [error, setError] = useState(''),
    [q, setQ] = useState(''),
    [show, setShow] = useState('active'),
    [editing, setEditing] = useState<Entity | 'new' | null>(null),
    [toggling, setToggling] = useState<Entity | null>(null);
  const load = useCallback(async () => {
    try {
      setData(await api(`registry/${kind}` + (kind === 'queues' ? '?unit=' + unitId : '')));
      setError('');
    } catch (e) {
      setError((e as Error).message);
    }
  }, [kind, unitId]);
  useEffect(() => {
    setData(null);
    void load();
  }, [load]);
  // Especialidades alimentam listas do sistema inteiro: recarrega a lista da sessão depois de mudar.
  const refreshMeta = async () => {
    if (kind !== 'specialties') return;
    try {
      const m = await api<Meta>('meta');
      setSpecialties(m.specialties || []);
    } catch {}
  };
  const rows = useMemo(
    () =>
      (data?.data || []).filter(
        (r) =>
          (show === 'all' || (show === 'active') === r.active) &&
          (!q ||
            JSON.stringify([r.name, r.code, r.synonyms]).toLowerCase().includes(q.toLowerCase())),
      ),
    [data, show, q],
  );
  if (!data)
    return error ? (
      <div className="error-banner" role="alert">
        {error}
      </div>
    ) : (
      <div className="loading">
        <RefreshCw className="spin" size={18} />
        Carregando…
      </div>
    );
  const canToggle = (r: Entity) =>
    !(kind === 'queues' && r.system) && (kind !== 'units' || data.canCreate);
  return (
    <section className="registry">
      <p className="note">{c.intro}</p>
      <div className="toolbar">
        <div className="search-field">
          <Search size={17} />
          <Input
            aria-label={'Buscar ' + c.title.toLowerCase()}
            placeholder="Buscar…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <div className="segmented" role="group" aria-label="Situação">
          {[
            ['active', 'Ativos'],
            ['inactive', 'Desativados'],
            ['all', 'Todos'],
          ].map(([k, l]) => (
            <Button
              key={k}
              variant={show === k ? 'primary' : 'ghost'}
              aria-pressed={show === k}
              onClick={() => setShow(k)}
            >
              {l}
            </Button>
          ))}
        </div>
        {data.canCreate && (
          <Button className="toolbar-end" onClick={() => setEditing('new')}>
            <Plus size={16} />
            Nova {c.noun}
          </Button>
        )}
      </div>
      {error && (
        <div className="error-banner" role="alert">
          {error}
        </div>
      )}
      <div className="card table-card">
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                {c.columns.map(([h]) => (
                  <th key={h}>{h}</th>
                ))}
                <th>Situação</th>
                <th aria-label="Ações" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={keyOf(kind, r)} className={r.active ? '' : 'registry-inactive'}>
                  {c.columns.map(([h, render]) => (
                    <td key={h}>{render(r)}</td>
                  ))}
                  <td>
                    {r.active ? (
                      <Badge value="COMPLETED" label="Ativo" />
                    ) : (
                      <Badge value="neutral" label="Desativado" />
                    )}
                  </td>
                  <td>
                    <div className="actions registry-actions">
                      <Button
                        variant="ghost"
                        aria-label={'Editar ' + r.name}
                        onClick={() => setEditing(r)}
                      >
                        <Pencil size={15} />
                      </Button>
                      {canToggle(r) && (
                        <Button
                          variant="ghost"
                          aria-label={(r.active ? 'Desativar ' : 'Reativar ') + r.name}
                          title={r.active ? 'Desativar' : 'Reativar'}
                          onClick={() => setToggling(r)}
                        >
                          {r.active ? <PowerOff size={15} /> : <Power size={15} />}
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!rows.length && (
            <div className="empty">
              <strong>Nada por aqui</strong>
              <p>Revise a busca ou o filtro.</p>
            </div>
          )}
        </div>
      </div>
      {editing && (
        <RegistryEditor
          kind={kind}
          unitId={unitId}
          entity={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={async (msg) => {
            setEditing(null);
            add(msg);
            await load();
            await refreshMeta();
          }}
        />
      )}
      {toggling && (
        <ToggleDialog
          kind={kind}
          entity={toggling}
          noun={c.noun}
          onClose={() => setToggling(null)}
          onDone={async (msg) => {
            setToggling(null);
            add(msg);
            await load();
            await refreshMeta();
          }}
        />
      )}
    </section>
  );
}
function RegistryEditor({
  kind,
  unitId,
  entity,
  onClose,
  onSaved,
}: {
  kind: Kind;
  unitId: string;
  entity: Entity | null;
  onClose: () => void;
  onSaved: (msg: string) => Promise<void>;
}) {
  const c = config[kind];
  const fields = c.fields.filter((f) => !(entity && f.createOnly));
  const [form, setForm] = useState<Record<string, any>>(() =>
    Object.fromEntries(
      c.fields.map((f) => [
        f.name,
        entity
          ? f.type === 'list'
            ? (entity[f.name] || []).join(', ')
            : (entity[f.name] ?? '')
          : f.type === 'checkbox'
            ? f.name === 'offered'
            : f.type === 'specialties'
              ? []
              : f.name === 'sort_order'
                ? 100
                : '',
      ]),
    ),
  );
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const set = (k: string, v: unknown) => setForm((f) => ({ ...f, [k]: v }));
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const body: Record<string, unknown> = {};
      for (const f of fields) {
        const v = form[f.name];
        if (f.createOnly && !v) continue;
        body[f.name] =
          f.type === 'list'
            ? String(v)
                .split(',')
                .map((x) => x.trim())
                .filter(Boolean)
            : f.type === 'number'
              ? Number(v)
              : v;
      }
      if (kind === 'queues' && !entity) body.unit_id = unitId;
      if (entity) await patch(`registry/${kind}/${encodeURIComponent(keyOf(kind, entity))}`, body);
      else await post(`registry/${kind}`, body);
      await onSaved(
        entity ? 'Alterações salvas.' : `${c.noun[0].toUpperCase() + c.noun.slice(1)} criada.`,
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      title={(entity ? 'Editar ' : 'Nova ') + c.noun}
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <form className="form registry-form" onSubmit={submit}>
        {fields.map((f) =>
          f.type === 'checkbox' ? (
            <label key={f.name} className="sandbox-consent">
              <input
                type="checkbox"
                checked={!!form[f.name]}
                onChange={(e) => set(f.name, e.target.checked)}
              />
              {f.label}
            </label>
          ) : f.type === 'specialties' ? (
            <fieldset key={f.name} className="registry-specialties">
              <legend>{f.label}</legend>
              {specialtyOptions().map(([code, name]) => (
                <label key={code}>
                  <input
                    type="checkbox"
                    checked={form[f.name].includes(code)}
                    onChange={(e) =>
                      set(
                        f.name,
                        e.target.checked
                          ? [...form[f.name], code]
                          : form[f.name].filter((x: string) => x !== code),
                      )
                    }
                  />
                  {name}
                </label>
              ))}
            </fieldset>
          ) : (
            <label key={f.name} className="field">
              {f.label}
              {f.type === 'textarea' ? (
                <textarea
                  className="input"
                  rows={3}
                  value={form[f.name]}
                  onChange={(e) => set(f.name, e.target.value)}
                  maxLength={600}
                />
              ) : (
                <input
                  className="input"
                  type={f.type === 'number' ? 'number' : 'text'}
                  value={form[f.name]}
                  onChange={(e) => set(f.name, e.target.value)}
                  autoFocus={f.name === 'name'}
                />
              )}
              {f.hint && <small>{f.hint}</small>}
            </label>
          ),
        )}
        {entity && (kind === 'specialties' || kind === 'competencies') && (
          <p className="muted small">
            Código: <code>{entity.code}</code> (não muda, porque profissionais e pacientes guardam
            este código).
          </p>
        )}
        {error && <p className="field-error">{error}</p>}
        <div className="form-footer">
          <Button type="button" variant="secondary" disabled={busy} onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" disabled={busy || String(form.name || '').trim().length < 2}>
            {busy ? 'Salvando…' : entity ? 'Salvar' : 'Criar'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
function ToggleDialog({
  kind,
  entity,
  noun,
  onClose,
  onDone,
}: {
  kind: Kind;
  entity: Entity;
  noun: string;
  onClose: () => void;
  onDone: (msg: string) => Promise<void>;
}) {
  const off = entity.active,
    [reason, setReason] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await post(`registry/${kind}/${encodeURIComponent(keyOf(kind, entity))}/active`, {
        active: !off,
        ...(reason.trim() ? { reason } : {}),
      });
      await onDone(
        off
          ? `${noun[0].toUpperCase() + noun.slice(1)} desativada.`
          : `${noun[0].toUpperCase() + noun.slice(1)} reativada.`,
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      title={(off ? 'Desativar ' : 'Reativar ') + entity.name}
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <form className="form" onSubmit={submit}>
        <p className="muted">
          {off
            ? `Desativar não apaga: o histórico continua e a ${noun} deixa de aparecer para novos registros. Dá para reativar depois.`
            : `A ${noun} volta a aparecer para novos registros.`}
        </p>
        {off && (
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
            {busy ? 'Salvando…' : off ? 'Desativar' : 'Reativar'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
