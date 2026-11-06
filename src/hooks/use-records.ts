'use client';
import { useCallback, useEffect, useState } from 'react';
import type { Collection } from '@/lib/types';
import { useWorkspaceContext } from '@/components/templates/workspace-context';
import { useApi } from './use-api';

const emptyCollection: Collection = { data: [], total: 0, page: 1, limit: 50 };

/**
 * Lista paginada de um recurso da unidade atual, com busca (com espera de 250 ms) e filtros.
 * Volta para a primeira página ao trocar de unidade, de recurso, de busca ou de filtro.
 */
export function useRecords(resource: string | null, initialFilters: Record<string, string> = {}) {
  const { unitId } = useWorkspaceContext();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [filters, setFilters] = useState<Record<string, string>>(initialFilters);

  useEffect(() => {
    const timer = setTimeout(() => {
      setQuery(search);
      setPage(1);
    }, 250);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    setPage(1);
    setSearch('');
    setQuery('');
    setFilters(initialFilters);
    // initialFilters é só o valor inicial; trocar de recurso ou unidade recomeça a lista.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resource, unitId]);

  const setFilter = useCallback((key: string, value: string) => {
    setPage(1);
    setFilters((current) => ({ ...current, [key]: value }));
  }, []);

  const params = new URLSearchParams({
    unit: unitId,
    page: String(page),
    q: query,
    ...filters,
  });
  const result = useApi<Collection>(resource ? `${resource}?${params}` : null);

  return {
    collection: result.data ?? emptyCollection,
    loading: result.loading,
    error: result.error,
    reload: result.reload,
    page,
    setPage,
    search,
    setSearch,
    filters,
    setFilter,
  };
}

export type RecordsState = ReturnType<typeof useRecords>;
