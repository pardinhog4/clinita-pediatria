'use client';
import { useState } from 'react';
import { CheckCircle2, Download, FileSpreadsheet, RefreshCw, Upload } from 'lucide-react';
import { api } from '@/lib/client';
import { useNotices } from '@/stores/workspace';
import { useWorkspaceContext } from '@/components/templates/workspace-context';
import { Badge } from '../atoms/badge';
import { Button } from '../atoms/button';

// Configurações → Importar dados: modelo .xlsx, conferência linha a linha e importação (tudo ou nada).

type Kind = 'insurers' | 'professionals' | 'patients';
type Result = {
  kind: Kind;
  committed: boolean;
  total: number;
  ok: number;
  skipped: { line: number; name: string; reason: string }[];
  errors: { line: number; name: string; message: string }[];
};

const kinds: { id: Kind; step: number; title: string; description: string }[] = [
  {
    id: 'insurers',
    step: 1,
    title: 'Convênios',
    description: 'Duração e valor da sessão, token e assinatura de guia.',
  },
  {
    id: 'professionals',
    step: 2,
    title: 'Profissionais',
    description: 'Precisa das salas cadastradas em Salas e capacidade.',
  },
  {
    id: 'patients',
    step: 3,
    title: 'Pacientes',
    description: 'Precisa dos convênios já cadastrados ou importados.',
  },
];

export function ImportBoard() {
  const { notifyChange } = useWorkspaceContext();
  const add = useNotices((s) => s.add);
  const [kind, setKind] = useState<Kind>('insurers');
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  async function send(commit: boolean) {
    if (!file) return;
    setBusy(commit ? 'import' : 'check');
    setError('');
    try {
      const form = new FormData();
      form.set('kind', kind);
      form.set('commit', String(commit));
      form.set('file', file);
      const r = await api<Result>('import', { method: 'POST', body: form });
      setResult(r);
      if (r.committed) {
        add(`${r.ok} registro(s) importado(s).`);
        notifyChange();
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy('');
    }
  }

  function choose(k: Kind) {
    setKind(k);
    setFile(null);
    setResult(null);
    setError('');
  }

  return (
    <div className="import-board">
      <div className="import-kinds" role="radiogroup" aria-label="O que importar">
        {kinds.map((k) => (
          <button
            key={k.id}
            type="button"
            role="radio"
            aria-checked={kind === k.id}
            className={'import-kind' + (kind === k.id ? ' active' : '')}
            onClick={() => choose(k.id)}
          >
            <span className="import-step">{k.step}</span>
            <strong>{k.title}</strong>
            <small>{k.description}</small>
          </button>
        ))}
      </div>

      <section className="card import-steps">
        <div className="import-row">
          <div>
            <strong>Baixe o modelo</strong>
            <small>
              Preencha a aba "Dados" (uma linha por registro). A aba "Exemplo" mostra o formato.
            </small>
          </div>
          <a className="button secondary" href={'/api/import/template?kind=' + kind} download>
            <Download size={15} />
            Modelo de {kinds.find((k) => k.id === kind)!.title.toLowerCase()}
          </a>
        </div>
        <div className="import-row">
          <div>
            <strong>Envie a planilha preenchida</strong>
            <small>Arquivo .xlsx de até 5 MB e 2.000 linhas.</small>
          </div>
          <label className="button secondary import-file">
            <FileSpreadsheet size={15} />
            {file ? file.name : 'Escolher arquivo'}
            <input
              type="file"
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              aria-label="Planilha para importar"
              onChange={(e) => {
                setFile(e.target.files?.[0] || null);
                setResult(null);
              }}
            />
          </label>
        </div>
        <div className="import-row">
          <div>
            <strong>Confira e importe</strong>
            <small>
              A conferência não grava nada. A importação grava tudo de uma vez, só se não houver
              erros.
            </small>
          </div>
          <div className="actions">
            <Button variant="secondary" disabled={!file || !!busy} onClick={() => void send(false)}>
              {busy === 'check' ? <RefreshCw className="spin" size={15} /> : <Upload size={15} />}
              Conferir planilha
            </Button>
            <Button
              disabled={
                !result || result.committed || result.errors.length > 0 || !result.ok || !!busy
              }
              onClick={() => void send(true)}
            >
              {busy === 'import' && <RefreshCw className="spin" size={15} />}
              Importar {result && !result.committed && !result.errors.length ? result.ok : ''}{' '}
              registro(s)
            </Button>
          </div>
        </div>
        {error && <p className="error-banner">{error}</p>}
      </section>

      {result && (
        <section className="card import-result" aria-live="polite">
          <div className="import-summary">
            {result.committed ? (
              <Badge value="APPROVED" label="Importado" />
            ) : result.errors.length ? (
              <Badge value="REJECTED" label="Corrija antes de importar" />
            ) : (
              <Badge value="PENDING" label="Pronto para importar" />
            )}
            <span>
              <b>{result.total}</b> linha(s) · <b>{result.ok}</b>{' '}
              {result.committed ? 'importada(s)' : 'válida(s)'} · <b>{result.skipped.length}</b> já
              cadastrada(s) · <b>{result.errors.length}</b> com erro
            </span>
          </div>
          {result.committed && (
            <p className="note">
              <CheckCircle2 size={15} /> Cadastros gravados com histórico e auditoria.
            </p>
          )}
          {result.errors.length > 0 && (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Linha</th>
                    <th>Registro</th>
                    <th>O que corrigir</th>
                  </tr>
                </thead>
                <tbody>
                  {result.errors.map((e) => (
                    <tr key={e.line}>
                      <td>{e.line}</td>
                      <td>{e.name}</td>
                      <td className="field-error">{e.message}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {result.skipped.length > 0 && (
            <details>
              <summary>Ignoradas por já existirem ({result.skipped.length})</summary>
              <ul>
                {result.skipped.map((s) => (
                  <li key={s.line}>
                    Linha {s.line} · {s.name}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </section>
      )}
    </div>
  );
}
