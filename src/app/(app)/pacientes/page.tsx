import type { Metadata } from 'next';
import { pageTitle } from '@/lib/navigation';
import { PatientsPage } from './patients-page';

export const metadata: Metadata = { title: pageTitle('pacientes') };

export default function Page() {
  return <PatientsPage />;
}
