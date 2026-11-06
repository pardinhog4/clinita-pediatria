import type { Metadata } from 'next';
import { pageTitle } from '@/lib/navigation';
import { PayoutsPage } from './payouts-page';

export const metadata: Metadata = { title: pageTitle('repasses') };

export default function Page() {
  return <PayoutsPage />;
}
