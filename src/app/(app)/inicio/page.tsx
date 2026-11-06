import type { Metadata } from 'next';
import { pageTitle } from '@/lib/navigation';
import { HomePage } from './home-page';

export const metadata: Metadata = { title: pageTitle('inicio') };

export default function Page() {
  return <HomePage />;
}
