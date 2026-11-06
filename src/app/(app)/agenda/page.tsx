import type { Metadata } from 'next';
import { pageTitle } from '@/lib/navigation';
import { AgendaPage } from './agenda-page';

export const metadata: Metadata = { title: pageTitle('agenda') };

export default function Page() {
  return <AgendaPage />;
}
