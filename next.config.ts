import type { NextConfig } from 'next';
const policy = (signature = false) =>
  "default-src 'self'; script-src 'self' 'unsafe-inline'" +
  (process.env.NODE_ENV === 'development' ? " 'unsafe-eval'" : '') +
  "; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; frame-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors " +
  (signature ? "'self'" : "'none'");
const config: NextConfig = {
  poweredByHeader: false,
  // Os testes de navegador sobem um segundo servidor (porta 3006) com build separado.
  distDir: process.env.NEXT_DIST_DIR || '.next',
  serverExternalPackages: ['pg'],
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'same-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
          { key: 'Content-Security-Policy', value: policy() },
        ],
      },
      {
        source: '/assinatura/:token',
        headers: [
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          { key: 'Content-Security-Policy', value: policy(true) },
        ],
      },
    ];
  },
};
export default config;
