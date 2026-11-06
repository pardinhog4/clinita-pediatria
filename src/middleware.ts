import { NextRequest, NextResponse } from 'next/server';
// Triagem rápida de navegação: sem nenhum cookie de sessão, a página vai direto ao login.
// A validação real (assinatura, revogação, perfil) continua no servidor a cada chamada da API.
// Públicas: entrada, assinatura de guia, link de acesso por e-mail e "esqueci minha senha".
export function middleware(req: NextRequest) {
  const hasSession = req.cookies.has('integrar_access') || req.cookies.has('integrar_csrf');
  const { pathname, search } = req.nextUrl;
  if (pathname === '/')
    return NextResponse.redirect(new URL(hasSession ? '/inicio' : '/login', req.url));
  if (hasSession) return NextResponse.next();
  const url = new URL('/login', req.url);
  url.searchParams.set('next', pathname + search);
  return NextResponse.redirect(url);
}
export const config = {
  matcher: [
    '/((?!api|_next|login|assinatura|acesso|esqueci-senha|configuracao-inicial|favicon.ico).*)',
  ],
};
