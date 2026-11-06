'use client';
let refresh: Promise<void> | null = null;
export class ApiClientError extends Error {
  constructor(
    public status: number,
    message: string,
    public fields?: Record<string, string[]>,
  ) {
    super(message);
  }
}
export const isUnauthorized = (e: unknown) => e instanceof ApiClientError && e.status === 401;
export const loginUrl = (next = location.pathname + location.search) =>
  '/login' +
  (next && next !== '/' && !next.startsWith('/login') ? '?next=' + encodeURIComponent(next) : '');
export const del = <T = any>(path: string) => api<T>(path, { method: 'DELETE' });
const csrf = () =>
  decodeURIComponent(
    document.cookie
      .split('; ')
      .find((v) => v.startsWith('integrar_csrf='))
      ?.split('=')[1] || '',
  );
// Telas abertas sem login: nelas uma sessão vencida não redireciona (evita voltar ao login em ciclo).
const publicPaths = ['/login', '/esqueci-senha', '/acesso', '/configuracao-inicial', '/assinatura'];
let expiring = false;
/**
 * A sessão não pode mais ser renovada (vencida, revogada, usuário desativado ou senha trocada em
 * outro lugar): apaga o cookie legível e volta ao login, que depois retorna para a mesma tela.
 */
function sessionExpired() {
  document.cookie = 'integrar_csrf=; Max-Age=0; path=/; SameSite=Strict';
  if (expiring || publicPaths.some((p) => location.pathname.startsWith(p))) return;
  expiring = true;
  location.replace(loginUrl());
}
export async function api<T = any>(
  path: string,
  options: RequestInit = {},
  retry = true,
): Promise<T> {
  const headers = new Headers(options.headers);
  if (options.body && !(options.body instanceof FormData))
    headers.set('Content-Type', 'application/json');
  if (options.method && options.method !== 'GET') headers.set('x-csrf-token', csrf());
  const response = await fetch('/api/' + path, {
    ...options,
    headers,
    credentials: 'same-origin',
    cache: 'no-store',
  });
  if (response.status === 401 && retry && !path.startsWith('auth/')) {
    if (!refresh)
      refresh = api('auth/refresh', { method: 'POST' }, false)
        .then(() => {})
        .finally(() => {
          refresh = null;
        });
    try {
      await refresh;
    } catch (e) {
      if (isUnauthorized(e)) sessionExpired();
      throw e;
    }
    return api<T>(path, options, false);
  }
  if (!response.ok) {
    // Ainda 401 depois de renovar: a sessão acabou.
    if (response.status === 401 && !path.startsWith('auth/')) sessionExpired();
    const body = await response.json().catch(() => ({ error: 'Erro de comunicação.' }));
    throw new ApiClientError(
      response.status,
      body.error || 'Não foi possível concluir.',
      body.fields,
    );
  }
  return response.json();
}
export const post = <T = any>(path: string, data: unknown) =>
  api<T>(path, { method: 'POST', body: JSON.stringify(data) });
export const patch = <T = any>(path: string, data: unknown) =>
  api<T>(path, { method: 'PATCH', body: JSON.stringify(data) });

/**
 * Todos os registros de uma listagem paginada (a API devolve até 100 por página).
 * Use para cadastros pequenos (profissionais, salas, convênios); pacientes usam busca (/directory).
 */
export async function fetchAll<T = any>(path: string): Promise<{ data: T[] }> {
  const sep = path.includes('?') ? '&' : '?';
  const data: T[] = [];
  for (let page = 1; page <= 50; page++) {
    const r = await api<{ data: T[]; total: number }>(`${path}${sep}limit=100&page=${page}`);
    data.push(...r.data);
    if (!r.data.length || data.length >= r.total) break;
  }
  return { data };
}
