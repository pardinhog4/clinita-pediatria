import type { Metadata } from 'next';
import { pageTitle } from '@/lib/navigation';
import { SettingsPage } from './settings-page';

export const metadata: Metadata = { title: pageTitle('configuracoes') };

export default function Page() {
  return <SettingsPage />;
}
