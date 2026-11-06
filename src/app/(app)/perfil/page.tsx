import type { Metadata } from 'next';
import { pageTitle } from '@/lib/navigation';
import { ProfilePage } from './profile-page';

export const metadata: Metadata = { title: pageTitle('perfil') };

export default function Page() {
  return <ProfilePage />;
}
