import type { Metadata } from 'next';
import { pageTitle } from '@/lib/navigation';
import { GuidesPage } from './guides-page';

export const metadata: Metadata = { title: pageTitle('guias') };

export default function Page() {
  return <GuidesPage />;
}
