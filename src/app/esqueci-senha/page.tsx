import type { Metadata } from 'next';
import { ForgotPassword } from '@/components/organisms/access-forms';

export const metadata: Metadata = { title: 'Esqueci minha senha · Integrar' };

export default function Page() {
  return <ForgotPassword />;
}
