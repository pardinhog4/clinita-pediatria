import type { Metadata } from 'next';
import { pageTitle } from '@/lib/navigation';
import { AttendancePage } from './attendance-page';

export const metadata: Metadata = { title: pageTitle('atendimento') };

export default function Page() {
  return <AttendancePage />;
}
