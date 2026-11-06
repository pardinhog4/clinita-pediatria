'use client';
import { useCallback, useEffect, useState, type KeyboardEvent } from 'react';
import {
  Building2,
  Home,
  Video,
  Pencil,
  RefreshCw,
  X,
  Sparkles,
  UserRoundX,
  Clock,
} from 'lucide-react';
import { api } from '@/lib/client';
import { labels, specialtyOptions, specialtyCode } from '@/lib/schemas';
import { useNotices } from '@/stores/workspace';
import { Button } from '../atoms/button';
import { Badge } from '../atoms/badge';
type Profile = {
  bio: string;
  approach: string;
  target_conditions: string[];
  excluded_profiles: string;
  modalities: string[];
  secondary_specialties: string[];
  weekly_hours_available: number | null;
  accepts_new_patients: boolean;
  accepted_insurer_ids: string[];
  ai_notes: string;
  version: number;
};
type Data = {
  professional: {
    id: string;
    name: string;
    specialty: string;
    competencies: { code: string; name: string }[];
  };
  profile: Profile;
  insurers: { id: string; name: string }[];
  canEdit: boolean;
};
const modalities: [string, string, typeof Home][] = [
  ['CLINIC', 'Na clínica', Building2],
  ['HOME', 'Em domicílio', Home],
  ['ONLINE', 'Online', Video],
];

export function ProfessionalProfile({ professionalId }: { professionalId: string }) {
  const [data, setData] = useState<Data | null>(null),
    [error, setError] = useState(''),
    [editing, setEditing] = useState(false);
  const load = useCallback(async () => {
    try {
      setData(await api<Data>('professional-profiles/' + professionalId));
      setError('');
    } catch (e) {
      setError((e as Error).message);
    }
  }, [professionalId]);
  useEffect(() => {
    void load();
  }, [load]);
  if (error && !data)
    return (
      <p className="error-banner" role="alert">
        {error}
      </p>
    );
  if (!data)
    return (
      <div className="loading">
        <RefreshCw className="spin" size={18} />
        Carregando perfil…
      </div>
    );
  if (editing)
    return (
      <ProfileForm
        data={data}
        onCancel={() => setEditing(false)}
        onSaved={() => {
          setEditing(false);
          void load();
        }}
      />
    );
  const p = data.profile,
    empty = !p.version;
  const insurerNames = p.accepted_insurer_ids
    .map((id) => data.insurers.find((i) => i.id === id)?.name)
    .filter(Boolean);
  return (
    <div className="pro-profile">
      <div className="pro-profile-head">
        <div>
          <h3>Como este profissional atende</h3>
          <small>
            A IA do atendimento usa estas informações para encaminhar cada família ao profissional
            certo.
          </small>
        </div>
        {data.canEdit && (
          <Button variant="secondary" onClick={() => setEditing(true)}>
            <Pencil size={15} />
            {empty ? 'Preencher perfil' : 'Editar perfil'}
          </Button>
        )}
      </div>
      {empty ? (
        <div className="empty">
          <strong>Perfil ainda não preenchido</strong>
          <p>
            Sem apresentação, abordagem e públicos atendidos, a IA encaminha só pela especialidade e
            pelas competências.
          </p>
        </div>
      ) : (
        <>
          <div className="pro-status">
            {p.accepts_new_patients ? (
              <Badge value="APPROVED" label="Aceita novos pacientes" />
            ) : (
              <Badge value="CANCELLED" label="Sem vagas para novos pacientes" />
            )}
            {p.weekly_hours_available !== null && (
              <span className="tag">
                <Clock size={12} />
                {p.weekly_hours_available}h livres por semana
              </span>
            )}
            {p.modalities.map((m) => {
              const [, label, Icon] = modalities.find((x) => x[0] === m)!;
              return (
                <span className="tag" key={m}>
                  <Icon size={12} />
                  {label}
                </span>
              );
            })}
          </div>
          {p.bio && (
            <section>
              <h4>Apresentação</h4>
              <p>{p.bio}</p>
            </section>
          )}
          {p.approach && (
            <section>
              <h4>Como trabalha</h4>
              <p>{p.approach}</p>
            </section>
          )}
          <div className="pro-columns">
            <section>
              <h4>Competências</h4>
              <div className="tags">
                {data.professional.competencies.map((c) => (
                  <span className="tag" key={c.code} title={c.code}>
                    {c.name}
                  </span>
                ))}
                {!data.professional.competencies.length && <small>Nenhuma cadastrada</small>}
              </div>
              {p.secondary_specialties.length > 0 && (
                <>
                  <h4>Também atua em</h4>
                  <div className="tags">
                    {p.secondary_specialties.map((s) => (
                      <span className="tag" key={s}>
                        {labels[s]}
                      </span>
                    ))}
                  </div>
                </>
              )}
            </section>
            <section>
              <h4>Públicos e condições que atende</h4>
              <div className="tags">
                {p.target_conditions.map((c) => (
                  <span className="tag" key={c}>
                    {c}
                  </span>
                ))}
                {!p.target_conditions.length && <small>Não informado</small>}
              </div>
              {p.excluded_profiles && (
                <p className="pro-excluded">
                  <UserRoundX size={15} />
                  <span>
                    <b>Não atende:</b> {p.excluded_profiles}
                  </span>
                </p>
              )}
            </section>
          </div>
          <section>
            <h4>Convênios aceitos</h4>
            <div className="tags">
              {insurerNames.length ? (
                insurerNames.map((n) => (
                  <span className="tag" key={n}>
                    {n}
                  </span>
                ))
              ) : (
                <small>Todos os convênios da clínica</small>
              )}
            </div>
          </section>
          {p.ai_notes && (
            <p className="note pro-ai-note">
              <Sparkles size={15} />{' '}
              <span>
                <b>Orientação para a IA e a recepção:</b> {p.ai_notes}
              </span>
            </p>
          )}
        </>
      )}
    </div>
  );
}

function ChipsInput({
  value,
  onChange,
  placeholder,
  id,
}: {
  value: string[];
  onChange: (v: string[]) => void;
  placeholder: string;
  id: string;
}) {
  const [draft, setDraft] = useState('');
  const add = () => {
    const v = draft.trim();
    if (v.length >= 2 && !value.includes(v) && value.length < 20) onChange([...value, v]);
    setDraft('');
  };
  const key = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      add();
    } else if (e.key === 'Backspace' && !draft && value.length) onChange(value.slice(0, -1));
  };
  return (
    <div className="chips-input">
      {value.map((v) => (
        <span className="chip" key={v}>
          {v}
          <button
            type="button"
            aria-label={'Remover ' + v}
            onClick={() => onChange(value.filter((x) => x !== v))}
          >
            <X size={12} />
          </button>
        </span>
      ))}
      <input
        id={id}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={key}
        onBlur={add}
        placeholder={value.length ? '' : placeholder}
        maxLength={80}
      />
    </div>
  );
}

function ProfileForm({
  data,
  onCancel,
  onSaved,
}: {
  data: Data;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const { add } = useNotices();
  const [form, setForm] = useState<Profile>(data.profile),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const set = <K extends keyof Profile>(k: K, v: Profile[K]) => setForm((f) => ({ ...f, [k]: v }));
  const toggle = (k: 'modalities' | 'secondary_specialties' | 'accepted_insurer_ids', v: string) =>
    set(k, form[k].includes(v) ? form[k].filter((x) => x !== v) : [...form[k], v]);
  async function save() {
    setBusy(true);
    setError('');
    try {
      await api('professional-profiles/' + data.professional.id, {
        method: 'PUT',
        body: JSON.stringify(form),
      });
      add('Perfil de atendimento salvo.');
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="pro-profile pro-form">
      <div className="pro-profile-head">
        <div>
          <h3>Perfil de atendimento</h3>
          <small>Escreva como você explicaria o profissional para a recepção.</small>
        </div>
      </div>
      <label className="field">
        Apresentação
        <textarea
          className="input"
          rows={3}
          maxLength={1500}
          value={form.bio}
          onChange={(e) => set('bio', e.target.value)}
          placeholder="Formação, experiência e foco principal."
        />
      </label>
      <label className="field">
        Como trabalha
        <textarea
          className="input"
          rows={3}
          maxLength={1500}
          value={form.approach}
          onChange={(e) => set('approach', e.target.value)}
          placeholder="Abordagem, rotina das sessões, participação da família."
        />
      </label>
      <div className="field">
        <label htmlFor="pro-conditions">Públicos e condições que atende</label>
        <ChipsInput
          id="pro-conditions"
          value={form.target_conditions}
          onChange={(v) => set('target_conditions', v)}
          placeholder="Digite e tecle Enter: TEA, atraso de fala…"
        />
      </div>
      <label className="field">
        Não atende
        <textarea
          className="input"
          rows={2}
          maxLength={800}
          value={form.excluded_profiles}
          onChange={(e) => set('excluded_profiles', e.target.value)}
          placeholder="Ex.: adultos, disfagia hospitalar."
        />
      </label>
      <div className="field">
        <span className="field-label">Modalidades</span>
        <div className="unit-grid">
          {modalities.map(([v, l, Icon]) => (
            <label
              key={v}
              className={'unit-option' + (form.modalities.includes(v) ? ' selected' : '')}
            >
              <input
                type="checkbox"
                checked={form.modalities.includes(v)}
                onChange={() => toggle('modalities', v)}
              />
              <Icon size={15} />
              {l}
            </label>
          ))}
        </div>
      </div>
      <div className="field">
        <span className="field-label">Também atua em</span>
        <div className="unit-grid">
          {specialtyOptions()
            .filter(([k]) => k !== data.professional.specialty)
            .map(([k, l]) => (
              <label
                key={k}
                className={
                  'unit-option' + (form.secondary_specialties.includes(k) ? ' selected' : '')
                }
              >
                <input
                  type="checkbox"
                  checked={form.secondary_specialties.includes(k)}
                  onChange={() => toggle('secondary_specialties', k)}
                />
                {l}
              </label>
            ))}
        </div>
      </div>
      <div className="form-grid">
        <label className="field">
          Horas livres por semana
          <input
            className="input"
            type="number"
            min={0}
            max={60}
            value={form.weekly_hours_available ?? ''}
            onChange={(e) =>
              set(
                'weekly_hours_available',
                e.target.value === '' ? null : Math.max(0, Math.min(60, Number(e.target.value))),
              )
            }
            placeholder="Não informado"
          />
        </label>
        <label className="field switch-field">
          <span>Aceita novos pacientes</span>
          <input
            type="checkbox"
            role="switch"
            className="switch"
            checked={form.accepts_new_patients}
            onChange={(e) => set('accepts_new_patients', e.target.checked)}
          />
        </label>
      </div>
      <div className="field">
        <span className="field-label">
          Convênios aceitos <span className="muted">(nenhum marcado = todos)</span>
        </span>
        <div className="unit-grid">
          {data.insurers.map((i) => (
            <label
              key={i.id}
              className={
                'unit-option' + (form.accepted_insurer_ids.includes(i.id) ? ' selected' : '')
              }
            >
              <input
                type="checkbox"
                checked={form.accepted_insurer_ids.includes(i.id)}
                onChange={() => toggle('accepted_insurer_ids', i.id)}
              />
              {i.name}
            </label>
          ))}
        </div>
      </div>
      <label className="field">
        Orientação para a IA e a recepção
        <textarea
          className="input"
          rows={2}
          maxLength={800}
          value={form.ai_notes}
          onChange={(e) => set('ai_notes', e.target.value)}
          placeholder="Ex.: priorizar casos de intervenção precoce; não marcar após 17h."
        />
      </label>
      {error && (
        <p className="error-banner" role="alert">
          {error}
        </p>
      )}
      <div className="form-footer">
        <span className="muted">As mudanças valem para a próxima conversa da IA.</span>
        <div className="actions">
          <Button variant="secondary" onClick={onCancel}>
            Cancelar
          </Button>
          <Button disabled={busy || !form.modalities.length} onClick={() => void save()}>
            {busy && <RefreshCw className="spin" size={15} />}Salvar perfil
          </Button>
        </div>
      </div>
    </div>
  );
}
