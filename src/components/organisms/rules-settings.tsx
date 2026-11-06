'use client';
import { useEffect, useState } from 'react';
import { api, post } from '@/lib/client';
import {
  defaultRules,
  weekdayNames,
  type ClinicRules,
  type DayHours,
  type WeekHours,
} from '@/lib/clinic-rules';
import { useNotices } from '@/stores/workspace';
import { brazilTimezones } from '@/lib/timezone';
import { useWorkspaceContext } from '@/components/templates/workspace-context';
import { Button } from '../atoms/button';

// Configurações → Horários e regras: expediente da clínica e da unidade, domicílio, grade da
// agenda, durações, repasse, link de assinatura e anexos. Tudo validado no servidor
// (src/lib/clinic-rules.ts) e usado pela agenda, disponibilidade, repasses e encaminhamentos.

const order = [1, 2, 3, 4, 5, 6, 0];
const capital = (s: string) => s[0].toUpperCase() + s.slice(1);

type Settings = { value: Record<string, unknown> & { rules: ClinicRules }; version: number };

export function RulesSettings() {
  const { unitId, unitName, meta, refreshMeta, notifyChange } = useWorkspaceContext();
  const add = useNotices((s) => s.add);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [rules, setRules] = useState<ClinicRules>(defaultRules);
  const [ownHours, setOwnHours] = useState<WeekHours | null>(null);
  const [ownTimezone, setOwnTimezone] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const unit = meta.units.find((u) => u.id === unitId);

  useEffect(() => {
    let active = true;
    api<Settings>('settings')
      .then((s) => {
        if (!active) return;
        setSettings(s);
        setRules(s.value.rules);
      })
      .catch((e) => active && setError(e.message));
    return () => {
      active = false;
    };
  }, []);

  // Horário próprio da unidade selecionada (quando houver).
  useEffect(() => {
    setOwnHours(unit?.own_hours ? unit.rules.business_hours : null);
    setOwnTimezone(unit?.own_timezone ? unit.rules.timezone : '');
  }, [unit]);

  const set = <K extends keyof ClinicRules>(key: K, value: ClinicRules[K]) =>
    setRules((r) => ({ ...r, [key]: value }));

  async function save() {
    if (!settings) return;
    setBusy(true);
    setError('');
    try {
      await post('operations', {
        operation: 'SETTINGS_SAVE',
        unit_id: unitId,
        version: settings.version,
        value: { ...settings.value, rules },
      });
      await post('operations', {
        operation: 'UNIT_HOURS_SAVE',
        unit_id: unitId,
        business_hours: ownHours,
        timezone: ownTimezone || null,
      });
      setSettings(await api<Settings>('settings'));
      await refreshMeta();
      notifyChange();
      add('Horários e regras salvos.');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!settings)
    return error ? (
      <p className="error-banner">{error}</p>
    ) : (
      <p className="loading">Carregando regras…</p>
    );

  return (
    <div className="rules-settings">
      {error && <p className="error-banner">{error}</p>}

      <section className="card">
        <h3>Expediente da clínica</h3>
        <p className="muted">
          Vale para todas as unidades sem horário próprio. A agenda, a busca de horários e as
          sugestões de encaminhamento só oferecem horários dentro do expediente e fora do intervalo.
        </p>
        <WeekEditor
          label="clínica"
          value={rules.business_hours}
          onChange={(v) => set('business_hours', v)}
        />
      </section>

      <section className="card">
        <h3>Fuso horário</h3>
        <p className="muted">
          Agenda, lembretes e mensagens usam o fuso da unidade. Uma unidade em Manaus, por exemplo,
          marca "09:00" no horário de Manaus.
        </p>
        <div className="form-grid">
          <label className="field">
            Fuso padrão da clínica
            <select
              className="input"
              value={rules.timezone}
              onChange={(e) => set('timezone', e.target.value)}
            >
              {brazilTimezones.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            Fuso de {unitName}
            <select
              className="input"
              value={ownTimezone}
              onChange={(e) => setOwnTimezone(e.target.value)}
            >
              <option value="">Igual ao da clínica</option>
              {brazilTimezones.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      </section>

      <section className="card">
        <h3>Horário próprio · {unitName}</h3>
        <label className="check-line">
          <input
            type="checkbox"
            checked={!!ownHours}
            onChange={(e) => setOwnHours(e.target.checked ? rules.business_hours : null)}
          />
          Esta unidade tem horário diferente do expediente da clínica
        </label>
        {ownHours && <WeekEditor label={unitName} value={ownHours} onChange={setOwnHours} />}
      </section>

      <section className="card">
        <h3>Atendimento em domicílio</h3>
        <WeekEditor
          label="domicílio"
          value={rules.home_hours}
          onChange={(v) => set('home_hours', v)}
          withBreak={false}
        />
      </section>

      <section className="card">
        <h3>Agenda e sessões</h3>
        <div className="form-grid">
          <label className="field">
            Grade da agenda
            <select
              className="input"
              value={rules.slot_minutes}
              onChange={(e) => set('slot_minutes', Number(e.target.value) as 15 | 30 | 60)}
            >
              <option value={15}>De 15 em 15 minutos</option>
              <option value={30}>De 30 em 30 minutos</option>
              <option value={60}>De hora em hora</option>
            </select>
          </label>
          <NumberField
            label="Duração máxima na clínica (min)"
            value={rules.max_clinic_duration}
            onChange={(v) => set('max_clinic_duration', v)}
          />
          <NumberField
            label="Duração máxima em domicílio (min)"
            value={rules.max_home_duration}
            onChange={(v) => set('max_home_duration', v)}
          />
          <NumberField
            label="Iniciar a sessão até quantos min antes"
            value={rules.early_start_minutes}
            onChange={(v) => set('early_start_minutes', v)}
          />
        </div>
      </section>

      <section className="card">
        <h3>Painel</h3>
        <div className="form-grid">
          <NumberField
            label="Chegando agora: próximos quantos minutos"
            value={rules.arrival_window_minutes}
            onChange={(v) => set('arrival_window_minutes', v)}
          />
          <NumberField
            label="Conversa atrasada após quantos minutos"
            value={rules.inbox_overdue_minutes}
            onChange={(v) => set('inbox_overdue_minutes', v)}
          />
        </div>
      </section>

      <section className="card">
        <h3>Repasse PJ</h3>
        <div className="form-grid">
          <NumberField
            label="Dia de fechamento do período"
            value={rules.payout_closing_day}
            onChange={(v) => set('payout_closing_day', v)}
            hint={`Período de ${rules.payout_closing_day + 1} de um mês a ${rules.payout_closing_day} do seguinte.`}
          />
          <NumberField
            label="Dia de vencimento (mês seguinte)"
            value={rules.payout_due_day}
            onChange={(v) => set('payout_due_day', v)}
          />
          <NumberField
            label="Sessão curta (min)"
            value={rules.half_session_minutes}
            onChange={(v) => set('half_session_minutes', v)}
            hint="Paga pelo valor de sessão curta do profissional ou proporcional à hora."
          />
        </div>
      </section>

      <section className="card">
        <h3>Documentos</h3>
        <div className="form-grid">
          <NumberField
            label="Validade do link de assinatura (horas)"
            value={rules.signature_link_hours}
            onChange={(v) => set('signature_link_hours', v)}
          />
          <NumberField
            label="Tamanho máximo por anexo (MB, até 10)"
            value={rules.upload_max_mb}
            onChange={(v) => set('upload_max_mb', v)}
          />
          <NumberField
            label="Máximo de páginas por PDF anexado"
            value={rules.upload_max_pages}
            onChange={(v) => set('upload_max_pages', v)}
          />
        </div>
      </section>

      <div className="form-footer">
        <small className="muted">
          Mudanças valem para novos agendamentos. Sessões já marcadas não são alteradas.
        </small>
        <Button onClick={save} disabled={busy}>
          {busy ? 'Salvando…' : 'Salvar horários e regras'}
        </Button>
      </div>
    </div>
  );
}

function NumberField({
  label,
  value,
  onChange,
  hint,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  hint?: string;
}) {
  return (
    <label className="field">
      {label}
      <input
        type="number"
        className="input"
        value={Number.isFinite(value) ? value : ''}
        onChange={(e) => onChange(e.target.valueAsNumber)}
      />
      {hint && <small>{hint}</small>}
    </label>
  );
}

/** Tabela da semana: aberto/fechado, abertura, fechamento e intervalo opcional. */
function WeekEditor({
  label,
  value,
  onChange,
  withBreak = true,
}: {
  label: string;
  value: WeekHours;
  onChange: (v: WeekHours) => void;
  withBreak?: boolean;
}) {
  const update = (day: number, h: DayHours | null) =>
    onChange(value.map((d, i) => (i === day ? h : d)));
  return (
    <table className="week-editor">
      <thead>
        <tr>
          <th>Dia</th>
          <th>Abre</th>
          <th>Fecha</th>
          {withBreak && <th>Intervalo (opcional)</th>}
        </tr>
      </thead>
      <tbody>
        {order.map((day) => {
          const h = value[day];
          const name = capital(weekdayNames[day]);
          return (
            <tr key={day}>
              <td>
                <label className="check-line">
                  <input
                    type="checkbox"
                    aria-label={`${name} aberto · ${label}`}
                    checked={!!h}
                    onChange={(e) =>
                      update(day, e.target.checked ? { open: '08:00', close: '18:00' } : null)
                    }
                  />
                  {name}
                </label>
              </td>
              {h ? (
                <>
                  <td>
                    <input
                      type="time"
                      className="input"
                      step={300}
                      aria-label={`Abertura · ${name} · ${label}`}
                      value={h.open}
                      onChange={(e) => update(day, { ...h, open: e.target.value })}
                    />
                  </td>
                  <td>
                    <input
                      type="time"
                      className="input"
                      step={300}
                      aria-label={`Fechamento · ${name} · ${label}`}
                      value={h.close}
                      onChange={(e) => update(day, { ...h, close: e.target.value })}
                    />
                  </td>
                  {withBreak && (
                    <td>
                      <div className="week-break">
                        <input
                          type="time"
                          className="input"
                          step={300}
                          aria-label={`Início do intervalo · ${name} · ${label}`}
                          value={h.break_start || ''}
                          onChange={(e) =>
                            update(day, { ...h, break_start: e.target.value || null })
                          }
                        />
                        <span className="muted">às</span>
                        <input
                          type="time"
                          className="input"
                          step={300}
                          aria-label={`Fim do intervalo · ${name} · ${label}`}
                          value={h.break_end || ''}
                          onChange={(e) => update(day, { ...h, break_end: e.target.value || null })}
                        />
                      </div>
                    </td>
                  )}
                </>
              ) : (
                <td colSpan={withBreak ? 3 : 2} className="muted">
                  Fechado
                </td>
              )}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
