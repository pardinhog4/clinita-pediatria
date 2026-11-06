'use client';
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <main className="standalone">
      <h1>Não foi possível abrir esta tela</h1>
      <p>Tente novamente. Seus registros permanecem no banco.</p>
      <button className="button primary" onClick={reset}>
        Tentar novamente
      </button>
    </main>
  );
}
