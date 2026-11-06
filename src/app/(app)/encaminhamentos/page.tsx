import type { Metadata } from 'next';
import { pageTitle } from '@/lib/navigation';
import { ReferralsPage } from './referrals-page';

export const metadata: Metadata = { title: pageTitle('encaminhamentos') };

export default function Page() {
  return <ReferralsPage />;
}
