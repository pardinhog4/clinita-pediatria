import type { Metadata } from 'next';
import { pageTitle } from '@/lib/navigation';
import { AgentsPage } from './agents-page';

export const metadata: Metadata = { title: pageTitle('agentes') };

export default function Page() {
  return <AgentsPage />;
}
