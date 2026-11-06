import type { Metadata } from 'next';
import { pageTitle } from '@/lib/navigation';
import { BillingPage } from './billing-page';

export const metadata: Metadata = { title: pageTitle('auditoria') };

export default function Page() {
  return <BillingPage />;
}
