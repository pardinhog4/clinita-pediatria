'use client';
import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/client';
import { useWorkspaceContext } from '@/components/templates/workspace-context';

/** Recurso de um caminho, sem a query string ("rooms?unit=1&page=2" -> "rooms"). */
const resourceOf = (path: string | null) => (path ? path.split('?')[0] : null);

/**
 * Busca um recurso da API e recarrega quando o caminho muda ou quando alguma gravação acontece
 * (revision do contexto). Passe null para não buscar.
 * Enquanto busca outra página ou filtro do mesmo recurso, mantém os dados anteriores na tela;
 * ao trocar de recurso, não devolve os dados do recurso antigo (eles têm outro formato).
 */
export function useApi<T>(path: string | null) {
  const { revision } = useWorkspaceContext();
  const [state, setState] = useState<{ resource: string | null; data: T | null }>({
    resource: null,
    data: null,
  });
  const [loading, setLoading] = useState(!!path);
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!path) {
      setLoading(false);
      return;
    }
    let active = true;
    setLoading(true);
    setError('');
    api<T>(path)
      .then((result) => {
        if (active) setState({ resource: resourceOf(path), data: result });
      })
      .catch((e: Error) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [path, revision, reloadKey]);

  const reload = useCallback(() => setReloadKey((v) => v + 1), []);
  const data = state.resource === resourceOf(path) ? state.data : null;
  return { data, loading, error, reload };
}
