'use client';
import { useState, type FormEvent } from 'react';
import { FilePlus2, Pencil, Plus, X } from 'lucide-react';
import { post } from '@/lib/client';
import type { Entity } from '@/lib/types';
import { specialtyOptions } from '@/lib/schemas';
import { useNotices } from '@/stores/workspace';
import { Button } from '../atoms/button';
import { Dialog } from '../molecules/dialog';
import { DirectorySelect } from '../molecules/directory-select';
// Encaminhamento manual (laudo trazido em papel, pedido por telefone): a recepção digita os serviços e o servidor
// aplica a mesma classificação e escolha de profissional usadas pela IA.
type Row = {
  servico: string;
  specialty: string;
  competencies: string;
  carga: string;
  weekly_hours: string;
  modality: string;
};
const emptyRow = (): Row => ({
  servico: '',
  specialty: '',
  competencies: '',
  carga: '',
  weekly_hours: '',
  modality: '',
});
const statusText: Record<string, string> = {
  SUGGESTED: 'profissional sugerido',
  PARTIAL: 'coordenação decide',
  NO_MATCH: 'sem profissional',
  NOT_OFFERED: 'não oferecido',
};
export function ManualReferralButton({ unitId, onDone }: { unitId: string; onDone: () => void }) {
  const add = useNotices((s) => s.add),
    [open, setOpen] = useState(false),
    [patient, setPatient] = useState(''),
    [notes, setNotes] = useState(''),
    [rows, setRows] = useState<Row[]>([emptyRow()]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [result, setResult] = useState<Entity[] | null>(null);
  const set = (i: number, k: keyof Row, v: string) =>
    setRows((r) => r.map((x, j) => (j === i ? { ...x, [k]: v } : x)));
  const close = () => {
    setOpen(false);
    setPatient('');
    setNotes('');
    setRows([emptyRow()]);
    setResult(null);
    setError('');
  };
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const items = rows
        .filter((r) => r.servico.trim())
        .map((r) => ({
          servico: r.servico,
          specialty: r.specialty || null,
          competencies: r.competencies
            .split(',')
            .map((x) => x.trim())
            .filter(Boolean),
          carga: r.carga,
          weekly_hours: r.weekly_hours ? Number(r.weekly_hours) : null,
          modality: r.modality || null,
        }));
      const res = await post<{ items: Entity[] }>('actions/referral-create', {
        patient_id: patient,
        notes,
        items,
      });
      setResult(res.items);
      add('Encaminhamento registrado.');
      onDone();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>
        <FilePlus2 size={15} />
        Encaminhamento manual
      </Button>
      {open && (
        <Dialog
          title="Encaminhamento manual"
          onClose={() => {
            if (!busy) close();
          }}
          wide
        >
          {result ? (
            <div className="form">
              <p className="muted">
                Os itens foram classificados como num laudo recebido pela IA e já estão nas caixas
                dos profissionais e da coordenação.
              </p>
              <ul className="manual-result">
                {result.map((r, i) => (
                  <li key={i}>
                    <strong>{r.service_text}</strong>
                    <span>{r.professional_name || statusText[r.match_status]}</span>
                  </li>
                ))}
              </ul>
              <div className="form-footer">
                <Button onClick={close}>Concluir</Button>
              </div>
            </div>
          ) : (
            <form className="form manual-referral" onSubmit={submit}>
              <p className="muted">
                Para laudos trazidos em papel ou pedidos feitos por telefone. Cada serviço vira um
                item, com o profissional mais aderente escolhido pelas mesmas regras da IA.
              </p>
              <div className="field">
                <label htmlFor="manual-patient">Paciente</label>
                <DirectorySelect
                  id="manual-patient"
                  kind="patients"
                  unitId={unitId}
                  value={patient}
                  onChange={setPatient}
                />
              </div>
              <label className="field">
                Observações (convênio, preferências)
                <input
                  className="input"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  maxLength={1000}
                />
              </label>
              {rows.map((r, i) => (
                <fieldset key={i} className="manual-item">
                  <legend>Serviço {i + 1}</legend>
                  <label className="field manual-wide">
                    Serviço pedido (como está no laudo)
                    <input
                      className="input"
                      value={r.servico}
                      onChange={(e) => set(i, 'servico', e.target.value)}
                      placeholder="Fonoaudiologia com PROMPT, 2x por semana"
                    />
                  </label>
                  <label className="field">
                    Especialidade
                    <select
                      className="input"
                      value={r.specialty}
                      onChange={(e) => set(i, 'specialty', e.target.value)}
                    >
                      <option value="">Identificar pelo texto</option>
                      {specialtyOptions().map(([c, n]) => (
                        <option key={c} value={c}>
                          {n}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field">
                    Competências (vírgula)
                    <input
                      className="input"
                      value={r.competencies}
                      onChange={(e) => set(i, 'competencies', e.target.value)}
                      placeholder="TEA, PROMPT"
                    />
                  </label>
                  <label className="field">
                    Carga
                    <input
                      className="input"
                      value={r.carga}
                      onChange={(e) => set(i, 'carga', e.target.value)}
                      placeholder="2x por semana, 1 h"
                    />
                  </label>
                  <label className="field">
                    Horas/semana
                    <input
                      className="input"
                      type="number"
                      min={0}
                      max={80}
                      step={0.5}
                      value={r.weekly_hours}
                      onChange={(e) => set(i, 'weekly_hours', e.target.value)}
                    />
                  </label>
                  <label className="field">
                    Local
                    <select
                      className="input"
                      value={r.modality}
                      onChange={(e) => set(i, 'modality', e.target.value)}
                    >
                      <option value="">Clínica</option>
                      <option value="HOME">Domicílio</option>
                      <option value="ONLINE">Online</option>
                    </select>
                  </label>
                  {rows.length > 1 && (
                    <Button
                      type="button"
                      variant="ghost"
                      aria-label="Remover serviço"
                      onClick={() => setRows((x) => x.filter((_, j) => j !== i))}
                    >
                      <X size={15} />
                    </Button>
                  )}
                </fieldset>
              ))}
              <Button
                type="button"
                variant="ghost"
                onClick={() => setRows((x) => [...x, emptyRow()])}
              >
                <Plus size={15} />
                Adicionar serviço
              </Button>
              {error && <p className="field-error">{error}</p>}
              <div className="form-footer">
                <Button type="button" variant="secondary" disabled={busy} onClick={close}>
                  Cancelar
                </Button>
                <Button
                  type="submit"
                  disabled={busy || !patient || !rows.some((r) => r.servico.trim().length >= 3)}
                >
                  {busy ? 'Classificando…' : 'Registrar encaminhamento'}
                </Button>
              </div>
            </form>
          )}
        </Dialog>
      )}
    </>
  );
}
export function ReferralItemEdit({ item, onDone }: { item: Entity; onDone: () => void }) {
  const add = useNotices((s) => s.add),
    [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const [form, setForm] = useState({
    service_text: item.service_text,
    load_text: item.load_text || '',
    weekly_hours:
      item.weekly_hours === null || item.weekly_hours === undefined
        ? ''
        : String(item.weekly_hours),
    modality: item.modality || '',
  });
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await post('actions/referral-item-edit', {
        id: item.id,
        version: item.version,
        service_text: form.service_text,
        load_text: form.load_text,
        weekly_hours: form.weekly_hours === '' ? null : Number(form.weekly_hours),
        modality: form.modality || null,
      });
      add('Encaminhamento atualizado.');
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
          title="Editar encaminhamento"
          onClose={() => {
            if (!busy) setOpen(false);
          }}
        >
          <form className="form" onSubmit={submit}>
            <p className="muted small">
              Para trocar o profissional, use Redistribuir. A alteração fica no histórico do item.
            </p>
            <label className="field">
              Serviço
              <input
                className="input"
                value={form.service_text}
                onChange={(e) => setForm({ ...form, service_text: e.target.value })}
                maxLength={400}
              />
            </label>
            <div className="form-grid">
              <label className="field">
                Carga
                <input
                  className="input"
                  value={form.load_text}
                  onChange={(e) => setForm({ ...form, load_text: e.target.value })}
                  maxLength={200}
                />
              </label>
              <label className="field">
                Horas/semana
                <input
                  className="input"
                  type="number"
                  min={0}
                  max={80}
                  step={0.5}
                  value={form.weekly_hours}
                  onChange={(e) => setForm({ ...form, weekly_hours: e.target.value })}
                />
              </label>
              <label className="field">
                Local
                <select
                  className="input"
                  value={form.modality}
                  onChange={(e) => setForm({ ...form, modality: e.target.value })}
                >
                  <option value="">Clínica</option>
                  <option value="HOME">Domicílio</option>
                  <option value="ONLINE">Online</option>
                </select>
              </label>
            </div>
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
              <Button type="submit" disabled={busy || form.service_text.trim().length < 3}>
                {busy ? 'Salvando…' : 'Salvar'}
              </Button>
            </div>
          </form>
        </Dialog>
      )}
    </>
  );
}
