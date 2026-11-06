'use client';
import { DEFAULT_TIMEZONE } from '@/lib/timezone';
import { useEffect, useRef, useState } from 'react';
import { Button } from '../atoms/button';
type Point = { x: number; y: number };
export function SignaturePad({ onChange }: { onChange: (strokes: Point[][]) => void }) {
  const ref = useRef<HTMLCanvasElement>(null),
    drawing = useRef(false),
    paths = useRef<Point[][]>([]);
  function paint() {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = '#123d35';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    for (const path of paths.current) {
      ctx.beginPath();
      path.forEach((p, i) =>
        i
          ? ctx.lineTo(p.x * canvas.width, p.y * canvas.height)
          : ctx.moveTo(p.x * canvas.width, p.y * canvas.height),
      );
      ctx.stroke();
    }
  }
  return (
    <div className="signature-pad">
      <canvas
        ref={ref}
        width={600}
        height={200}
        aria-label="Quadro de assinatura"
        style={{
          width: '100%',
          height: 200,
          touchAction: 'none',
          border: '1px dashed #aac0b5',
          borderRadius: 10,
          background: '#fff',
        }}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          drawing.current = true;
          const r = e.currentTarget.getBoundingClientRect();
          paths.current.push([
            { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height },
          ]);
        }}
        onPointerMove={(e) => {
          if (!drawing.current) return;
          const r = e.currentTarget.getBoundingClientRect();
          paths.current.at(-1)!.push({
            x: Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)),
            y: Math.max(0, Math.min(1, (e.clientY - r.top) / r.height)),
          });
          paint();
        }}
        onPointerUp={() => {
          drawing.current = false;
          onChange(paths.current.map((s) => [...s]));
        }}
      />
      <Button
        variant="ghost"
        onClick={() => {
          paths.current = [];
          paint();
          onChange([]);
        }}
      >
        Limpar assinatura
      </Button>
    </div>
  );
}
export function PublicSignature({ token }: { token: string }) {
  const [info, setInfo] = useState<any>(null),
    [name, setName] = useState(''),
    [strokes, setStrokes] = useState<Point[][]>([]),
    [consent, setConsent] = useState(false),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [signed, setSigned] = useState(false);
  useEffect(() => {
    fetch('/api/signatures/' + token, { cache: 'no-store' })
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw Error(d.error);
        setInfo(d);
        setSigned(d.status === 'SIGNED');
      })
      .catch((e) => setError(e.message));
  }, [token]);
  return (
    <main className="signature-page">
      <div className="card">
        <div className="brand">
          <span className="brand-mark">i</span>
          <div>
            <b>integrar</b>
            <small>Confirmação de atendimento</small>
          </div>
        </div>
        {error && (
          <p className="error-banner" role="alert">
            {error}
          </p>
        )}
        {signed ? (
          <div className="empty">
            <h1>Registro recebido</h1>
            <p>A recepção já pode conferir a guia. Obrigado!</p>
          </div>
        ) : info ? (
          <>
            <h1>Confira o atendimento</h1>
            <p>
              {info.patient_name} ·{' '}
              {new Date(info.starts_at).toLocaleString('pt-BR', {
                timeZone: info.timezone || DEFAULT_TIMEZONE,
              })}{' '}
              · {info.unit_name}
            </p>
            <form
              className="form"
              onSubmit={async (e) => {
                e.preventDefault();
                setBusy(true);
                setError('');
                try {
                  const r = await fetch('/api/signatures/' + token, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name, strokes, consent }),
                  });
                  const d = await r.json();
                  if (!r.ok) throw Error(d.error);
                  setSigned(true);
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              <div className="field">
                <label htmlFor="signer-name">Nome de quem está confirmando</label>
                <input
                  className="input"
                  id="signer-name"
                  required
                  minLength={3}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>
              <SignaturePad onChange={setStrokes} />
              <label className="sandbox-consent">
                <input
                  type="checkbox"
                  checked={consent}
                  onChange={(e) => setConsent(e.target.checked)}
                />
                Confirmo o atendimento e autorizo o registro eletrônico local desta guia.
              </label>
              <Button type="submit" disabled={busy || !consent || !strokes.length}>
                {busy ? 'Registrando…' : 'Confirmar e assinar'}
              </Button>
              <small>
                Registro eletrônico para conferência da clínica. A aceitação pela operadora depende
                dos requisitos contratuais aplicáveis.
              </small>
            </form>
          </>
        ) : (
          !error && <p>Carregando guia…</p>
        )}
      </div>
    </main>
  );
}
