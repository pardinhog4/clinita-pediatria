import type { Metadata } from 'next';
import { pageTitle } from '@/lib/navigation';
import { ProfessionalsPage } from './professionals-page';

export const metadata: Metadata = { title: pageTitle('profissionais') };

export default function Page() {
  return <ProfessionalsPage />;
}
