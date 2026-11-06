import type { Metadata } from 'next';
import { pageTitle } from '@/lib/navigation';
import { AvailabilityPage } from './availability-page';

export const metadata: Metadata = { title: pageTitle('buscar-horarios') };

export default function Page() {
  return <AvailabilityPage />;
}
