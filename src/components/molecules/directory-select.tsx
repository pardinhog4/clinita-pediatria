'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/client';
import { Input } from '../atoms/input';
type Option = { value: string; label: string };
export function DirectorySelect({
  id,
  kind,
  unitId,
  value,
  onChange,
}: {
  id: string;
  kind: string;
  unitId: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const [options, setOptions] = useState<Option[]>([]),
    [query, setQuery] = useState(''),
    [error, setError] = useState(''),
    [loading, setLoading] = useState(false);
  useEffect(() => {
    let active = true;
    const timer = setTimeout(() => {
      setLoading(true);
      api<{ data: Option[] }>(
        'directory?unit=' + unitId + '&kind=' + kind + '&q=' + encodeURIComponent(query),
      )
        .then((r) => {
          if (active) {
            setOptions((prev) => {
              const selected = prev.find((x) => x.value === value);
              return selected && !r.data.some((x) => x.value === value)
                ? [selected, ...r.data]
                : r.data;
            });
            setError('');
          }
        })
        .catch((e) => {
          if (active) setError(e.message);
        })
        .finally(() => {
          if (active) setLoading(false);
        });
    }, 150);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [kind, unitId, query]);
  // Valor que já vem preenchido (ex.: profissional escolhido na agenda) e não está na primeira
  // página da busca: busca só ele, para o nome aparecer selecionado.
  useEffect(() => {
    if (!value || options.some((o) => o.value === value) || !/^[0-9a-f-]{36}$/.test(value)) return;
    if (kind !== 'patients' && kind !== 'professionals') return;
    let active = true;
    api<{ data: Option[] }>('directory?unit=' + unitId + '&kind=' + kind + '&id=' + value)
      .then((r) => {
        if (active && r.data[0]) setOptions((prev) => [r.data[0], ...prev]);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [kind, unitId, value, options]);
  return (
    <div className="directory-select">
      <Input
        aria-label={'Buscar opções de ' + id}
        placeholder="Buscar no cadastro…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <select
        id={id}
        className="input"
        value={value || ''}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">{loading ? 'Carregando cadastros…' : 'Selecione no cadastro…'}</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {error && <small className="field-error">{error}</small>}
    </div>
  );
}
