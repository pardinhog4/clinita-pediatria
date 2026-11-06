import type { ReactNode } from 'react';
import type { Entity } from '@/lib/types';
import { Button } from '../atoms/button';
export type Column = { key: string; label: string; render?: (row: Entity) => ReactNode };
export function DataTable({
  rows,
  columns,
  total,
  page,
  onPage,
  onRow,
}: {
  rows: Entity[];
  columns: Column[];
  total: number;
  page: number;
  onPage?: (page: number) => void;
  onRow?: (row: Entity) => void;
}) {
  return (
    <div className="card table-card">
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              {columns.map((c) => (
                <th key={c.key}>{c.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={r.id}
                className={onRow ? 'clickable' : ''}
                tabIndex={onRow ? 0 : undefined}
                onClick={() => onRow?.(r)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') onRow?.(r);
                }}
              >
                {columns.map((c) => (
                  <td key={c.key}>{c.render ? c.render(r) : String(r[c.key] ?? '—')}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length && (
          <div className="empty">
            <strong>Nenhum registro encontrado</strong>
            <p>Revise os filtros ou cadastre o primeiro registro.</p>
          </div>
        )}
      </div>
      <div className="pagination">
        <span>
          {total} registros · página {page}
        </span>
        {onPage && (
          <div className="actions">
            <Button variant="ghost" disabled={page <= 1} onClick={() => onPage(page - 1)}>
              Anterior
            </Button>
            <Button variant="ghost" disabled={page * 50 >= total} onClick={() => onPage(page + 1)}>
              Próxima
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
