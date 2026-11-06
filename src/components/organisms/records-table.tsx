'use client';
import type { ReactNode } from 'react';
import { Search } from 'lucide-react';
import type { Entity } from '@/lib/types';
import type { RecordsState } from '@/hooks/use-records';
import { Input } from '../atoms/input';
import { DataTable, type Column } from '../molecules/data-table';
import { useWorkspaceContext } from '../templates/workspace-context';

// Lista paginada com busca, filtros opcionais e contagem de registros da unidade.
export function RecordsTable({
  records,
  columns,
  rows,
  filters,
  onRow,
  searchPlaceholder = 'Buscar registros…',
  searchDisabled = false,
}: {
  records: RecordsState;
  columns: Column[];
  rows?: Entity[];
  filters?: ReactNode;
  onRow?: (row: Entity) => void;
  searchPlaceholder?: string;
  searchDisabled?: boolean;
}) {
  const { unitName } = useWorkspaceContext();
  return (
    <>
      <div className="toolbar">
        <div className="search-field">
          <Search size={17} />
          <Input
            aria-label="Buscar registros"
            placeholder={searchPlaceholder}
            value={records.search}
            disabled={searchDisabled}
            onChange={(e) => records.setSearch(e.target.value)}
          />
        </div>
        <span className="muted small">
          {records.collection.total} registros · {unitName}
        </span>
      </div>
      {filters && <div className="operational-filters">{filters}</div>}
      <DataTable
        rows={rows ?? records.collection.data}
        columns={columns}
        total={records.collection.total}
        page={records.page}
        onPage={records.setPage}
        onRow={onRow}
      />
    </>
  );
}

/** Filtro de lista em formato select, ligado a uma chave dos filtros do useRecords. */
export function FilterSelect({
  records,
  name,
  label,
  options,
  allLabel,
}: {
  records: RecordsState;
  name: string;
  label: string;
  options: [string, string][];
  allLabel: string;
}) {
  return (
    <label className="field">
      {label}
      <select
        aria-label={label}
        className="input"
        value={records.filters[name] || ''}
        onChange={(e) => records.setFilter(name, e.target.value)}
      >
        <option value="">{allLabel}</option>
        {options.map(([value, text]) => (
          <option key={value} value={value}>
            {text}
          </option>
        ))}
      </select>
    </label>
  );
}
