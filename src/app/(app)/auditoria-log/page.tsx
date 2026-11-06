import type { Metadata } from 'next';
import { pageTitle } from '@/lib/navigation';
import { AuditLogPage } from './audit-log-page';

export const metadata: Metadata = { title: pageTitle('auditoria-log') };

export default function Page() {
  return <AuditLogPage />;
}
