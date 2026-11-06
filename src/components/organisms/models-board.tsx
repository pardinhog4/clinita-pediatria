'use client';
import { useEffect, useState } from 'react';
import { HistoryButton, ArchiveButton } from './record-lifecycle';
import { useForm, useFieldArray } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { api, post, patch, fetchAll } from '@/lib/client';
import { modelSchema, labels, specialtyOptions, specialtyCode } from '@/lib/schemas';
import type { Entity } from '@/lib/types';
import { useNotices } from '@/stores/workspace';
import { Button } from '../atoms/button';
import { Badge } from '../atoms/badge';
export function ModelsBoard() {
  const [models, setModels] = useState<Entity[]>([]),
    [selected, setSelected] = useState<Entity | null>(null),
    [specialty, setSpecialty] = useState('fono'),
    [error, setError] = useState('');
  const add = useNotices((s) => s.add);
  const {
    register,
    control,
    reset,
    watch,
    setValue,
    handleSubmit,
    formState: { isSubmitting },
  } = useForm<any>({
    resolver: zodResolver(modelSchema) as any,
    defaultValues: {
      name: '',
      specialty: 'fono',
      questions: [{ label: '', type: 'text', step: 1 }],
    },
  });
  const { fields, append, remove, move } = useFieldArray({ control, name: 'questions' });
  const questions = watch('questions');
  async function load() {
    try {
      const r = await fetchAll<Entity>('models');
      setModels(r.data);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => {
    void load();
  }, []);
  function choose(m: Entity | null) {
    setSelected(m);
    reset(
      m
        ? { name: m.name, specialty: m.specialty, questions: m.questions }
        : { name: '', specialty, questions: [{ label: '', type: 'text', step: 1 }] },
    );
  }
  return (
    <>
      {error && (
        <p className="error-banner" role="alert">
          {error}
        </p>
      )}
      <div className="toolbar">
        <label className="field">
          Especialidade dos modelos
          <select
            className="input"
            value={specialty}
            onChange={(e) => {
              setSpecialty(e.target.value);
              choose(null);
            }}
          >
            {specialtyOptions().map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <Button onClick={() => choose(null)}>Novo modelo clínico</Button>
      </div>
      <div className="model-layout">
        <aside className="card model-list">
          {models
            .filter((m) => m.specialty === specialty)
            .map((m) => (
              <button
                key={m.id}
                className={selected?.id === m.id ? 'active' : ''}
                onClick={() => choose(m)}
              >
                <strong>{m.name}</strong>
                <small>
                  {m.questions.length} perguntas · versão {m.version}
                </small>
              </button>
            ))}
          {!models.some((m) => m.specialty === specialty) && (
            <p className="empty">Nenhum modelo nesta especialidade.</p>
          )}
        </aside>
        <form
          className="card form"
          onSubmit={handleSubmit(
            async (d) => {
              setError('');
              try {
                const saved = selected
                  ? await patch<Entity>('models/' + selected.id, {
                      version: selected.version,
                      data: d,
                    })
                  : await post<Entity>('models', d);
                await load();
                choose(saved);
                add('Modelo salvo. Aplicações anteriores preservam a versão original.');
              } catch (e) {
                setError((e as Error).message);
              }
            },
            () => setError('Confira o nome, as perguntas e as opções de resposta.'),
          )}
        >
          <div className="actions between">
            <h2>{selected ? 'Editar modelo' : 'Criar modelo clínico'}</h2>
            {selected && (
              <div className="actions">
                <Badge value="APPROVED" label={'Versão ' + selected.version} />
                <HistoryButton
                  resource="models"
                  entity={selected}
                  onRestored={() => {
                    setSelected(null);
                    void load();
                  }}
                />
                <ArchiveButton
                  resource="models"
                  entity={selected}
                  onDone={() => {
                    setSelected(null);
                    void load();
                  }}
                />
              </div>
            )}
          </div>
          <label className="field">
            Nome do modelo
            <input className="input" {...register('name')} />
          </label>
          <label className="field">
            Área do instrumento
            <select className="input" {...register('specialty')}>
              {specialtyOptions().map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <p className="note">
            Conteúdo criado pela clínica. Instrumentos licenciados podem ser anexados em PDF ao
            prontuário sem reproduzir perguntas protegidas.
          </p>
          {fields.map((f, index) => (
            <div className="question-editor" key={f.id}>
              <label className="field">
                Pergunta {index + 1}
                <input className="input" {...register(`questions.${index}.label`)} />
              </label>
              <label className="field">
                Tipo de resposta
                <select className="input" {...register(`questions.${index}.type`)}>
                  <option value="text">Texto livre</option>
                  <option value="number">Número / escala</option>
                  <option value="select">Seleção</option>
                </select>
              </label>
              <label className="field">
                Etapa
                <input
                  className="input"
                  type="number"
                  min="1"
                  max="20"
                  {...register(`questions.${index}.step`, { valueAsNumber: true })}
                />
              </label>
              {questions?.[index]?.type === 'select' && (
                <label className="field full">
                  Opções de resposta
                  <input
                    className="input"
                    value={(questions[index].options || []).join('; ')}
                    onChange={(e) => {
                      setValue(
                        `questions.${index}.options`,
                        e.target.value.split(';').map((v) => v.trim()),
                      );
                    }}
                    placeholder="Sim; Não; Em avaliação"
                  />
                </label>
              )}
              <div className="actions">
                <Button variant="ghost" disabled={!index} onClick={() => move(index, index - 1)}>
                  Subir
                </Button>
                <Button
                  variant="ghost"
                  disabled={index === fields.length - 1}
                  onClick={() => move(index, index + 1)}
                >
                  Descer
                </Button>
                <Button
                  variant="danger"
                  disabled={fields.length === 1}
                  onClick={() => remove(index)}
                >
                  Remover
                </Button>
              </div>
            </div>
          ))}
          <Button variant="secondary" onClick={() => append({ label: '', type: 'text', step: 1 })}>
            Adicionar pergunta
          </Button>
          <div className="form-footer">
            <small>Mudanças valem para as próximas avaliações.</small>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Salvando…' : 'Salvar modelo clínico'}
            </Button>
          </div>
        </form>
      </div>
    </>
  );
}
