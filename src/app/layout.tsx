import type { Metadata, Viewport } from 'next';
import { themeBootScript } from '@/lib/theme';
import './globals.css';
export const metadata: Metadata = {
  title: 'Integrar · Plataforma clínica',
  description: 'Gestão integrada da clínica multidisciplinar',
  robots: { index: false, follow: false },
};
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f5f5f7' },
    { media: '(prefers-color-scheme: dark)', color: '#000000' },
  ],
};
// data-theme é definido pelo script antes da hidratação; suppressHydrationWarning evita o aviso dessa diferença esperada.
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootScript }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
