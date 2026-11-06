import type { Metadata } from 'next';
import { pageTitle } from '@/lib/navigation';
import { IntegrationsPage } from './integrations-page';

export const metadata: Metadata = { title: pageTitle('integracoes') };

export default function Page() {
  return <IntegrationsPage />;
}
