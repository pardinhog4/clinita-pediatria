import Link from 'next/link';
export default function NotFound() {
  return (
    <main className="standalone">
      <h1>Página não encontrada</h1>
      <Link href="/" className="button primary">
        Voltar ao início
      </Link>
    </main>
  );
}
