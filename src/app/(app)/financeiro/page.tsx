import type { Metadata } from 'next';
import { pageTitle } from '@/lib/navigation';
import { FinancePage } from './finance-page';

export const metadata: Metadata = { title: pageTitle('financeiro') };

export default function Page() {
  return <FinancePage />;
}
