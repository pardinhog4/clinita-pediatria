import type { Metadata } from 'next';
import { pageTitle } from '@/lib/navigation';
import { UsersPage } from './users-page';

export const metadata: Metadata = { title: pageTitle('usuarios') };

export default function Page() {
  return <UsersPage />;
}
