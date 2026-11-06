import type { Metadata } from 'next';
import { InitialSetup } from '@/components/organisms/initial-setup';

export const metadata: Metadata = { title: 'Cadastro inicial · Integrar' };

export default function Page() {
  return <InitialSetup />;
}
