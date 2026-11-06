import type { Metadata } from 'next';
import { AccessLink } from '@/components/organisms/access-forms';

// Link recebido por e-mail (convite ou recuperação de senha).
export const metadata: Metadata = { title: 'Definir senha · Integrar', referrer: 'no-referrer' };

export default async function Page({ params }: { params: Promise<{ token: string }> }) {
  return <AccessLink token={(await params).token} />;
}
