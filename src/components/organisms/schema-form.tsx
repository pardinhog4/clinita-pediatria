'use client';
import { useState } from 'react';
import { useForm, Controller, type FieldValues, type Resolver } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import type { z } from 'zod';
import { Input } from '../atoms/input';
import { Button } from '../atoms/button';
import { DirectorySelect } from '../molecules/directory-select';
import { WeekHoursInput } from '../molecules/week-hours-input';
export type Field = {
  name: string;
  label: string;
  type?:
    | 'text'
    | 'number'
    | 'date'
    | 'datetime-local'
    | 'textarea'
    | 'select'
    | 'multiselect'
    | 'tags'
    | 'checkbox'
    | 'directory'
    | 'week-hours';
  options?: { value: string; label: string }[];
  directoryKind?: string;
  unitId?: string;
  hint?: string;
  step?: string;
};
export function SchemaForm({
  schema,
  fields,
  defaults,
  onSubmit,
  label = 'Salvar',
}: {
  schema: z.ZodType;
  fields: Field[];
  defaults?: FieldValues;
  onSubmit: (data: any) => Promise<void>;
  label?: string;
}) {
  const [error, setError] = useState('');
  const {
    register,
    handleSubmit,
    control,
    formState: { errors, isSubmitting },
  } = useForm<FieldValues>({
    resolver: zodResolver(schema as never) as Resolver<FieldValues>,
    defaultValues: defaults,
  });
  return (
    <form
      className="form"
      onSubmit={handleSubmit(async (d) => {
        setError('');
        try {
          await onSubmit(d);
        } catch (e) {
          setError(e instanceof Error ? e.message : 'Não foi possível salvar.');
        }
      })}
    >
      <div className="form-grid">
        {fields.map((f) => (
          <div
            className={
              'field ' +
              (['textarea', 'multiselect', 'tags', 'week-hours'].includes(f.type || '')
                ? 'full'
                : '')
            }
            key={f.name}
          >
            <label htmlFor={f.name}>{f.label}</label>
            {f.type === 'directory' ? (
              <Controller
                name={f.name}
                control={control}
                render={({ field }) => (
                  <DirectorySelect
                    id={f.name}
                    kind={f.directoryKind || 'patients'}
                    unitId={f.unitId || ''}
                    value={field.value || ''}
                    onChange={field.onChange}
                  />
                )}
              />
            ) : f.type === 'week-hours' ? (
              <Controller
                name={f.name}
                control={control}
                render={({ field }) => (
                  <WeekHoursInput id={f.name} value={field.value} onChange={field.onChange} />
                )}
              />
            ) : f.type === 'textarea' ? (
              <textarea className="input" id={f.name} rows={4} {...register(f.name)} />
            ) : f.type === 'select' ? (
              <select className="input" id={f.name} {...register(f.name)}>
                <option value="">Selecione…</option>
                {f.options?.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            ) : f.type === 'checkbox' ? (
              <input type="checkbox" id={f.name} {...register(f.name)} />
            ) : f.type === 'tags' ? (
              <Controller
                name={f.name}
                control={control}
                render={({ field }) => (
                  <Input
                    id={f.name}
                    value={(field.value || []).join(', ')}
                    onChange={(e) =>
                      field.onChange(
                        e.target.value
                          .split(',')
                          .map((x) => x.trim())
                          .filter(Boolean),
                      )
                    }
                  />
                )}
              />
            ) : f.type === 'multiselect' ? (
              <Controller
                name={f.name}
                control={control}
                render={({ field }) => (
                  <div className="check-list">
                    {f.options?.map((o) => (
                      <label key={o.value}>
                        <input
                          type="checkbox"
                          checked={(field.value || []).map(String).includes(o.value)}
                          onChange={(e) =>
                            field.onChange(
                              e.target.checked
                                ? [...(field.value || []), o.value]
                                : (field.value || []).filter((v: string) => String(v) !== o.value),
                            )
                          }
                        />
                        {o.label}
                      </label>
                    ))}
                  </div>
                )}
              />
            ) : (
              <Input
                type={f.type || 'text'}
                id={f.name}
                step={f.step || 'any'}
                {...register(f.name)}
              />
            )}
            <small>{f.hint}</small>
            {fieldError(errors, f.name) && (
              <span className="field-error">{fieldError(errors, f.name)}</span>
            )}
          </div>
        ))}
      </div>
      {error && (
        <div className="error-banner" role="alert">
          {error}
        </div>
      )}
      <div className="form-footer">
        <span className="muted">Alterações validadas no servidor</span>
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? 'Salvando…' : label}
        </Button>
      </div>
    </form>
  );
}

/** Mensagem de erro de um campo, inclusive aninhado ("metadata.order_expires", "metadata.work_hours.2.end"). */
function fieldError(errors: Record<string, any>, name: string): string | null {
  const node = name.split('.').reduce<any>((o, k) => o?.[k], errors);
  if (!node) return null;
  if (typeof node.message === 'string') return node.message;
  // Erro dentro de um objeto/lista (ex.: um dos dias do horário): mostra o primeiro.
  const stack = [node];
  while (stack.length) {
    const n = stack.shift();
    if (n && typeof n === 'object') {
      if (typeof n.message === 'string') return n.message;
      stack.push(...Object.values(n));
    }
  }
  return 'Campo inválido.';
}
