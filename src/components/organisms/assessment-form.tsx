'use client';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Button } from '../atoms/button';
export function AssessmentForm({
  questions,
  onSubmit,
}: {
  questions: any[];
  onSubmit: (answers: Record<string, string | number>) => Promise<void>;
}) {
  const steps = [...new Set<number>(questions.map((q) => Number(q.step) || 1))].sort(
      (a, b) => a - b,
    ),
    [step, setStep] = useState(0),
    [error, setError] = useState('');
  const {
    register,
    trigger,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<Record<string, any>>();
  return (
    <form
      className="form"
      onSubmit={handleSubmit(async (data) => {
        setError('');
        try {
          await onSubmit(data);
        } catch (e) {
          setError((e as Error).message);
        }
      })}
    >
      <div className="actions between">
        <strong>
          Etapa {step + 1} de {steps.length}
        </strong>
        <span className="tag">{questions.length} perguntas</span>
      </div>
      {questions.map((q, index) => {
        const name = String(index);
        return (
          <div key={name} className="field" hidden={(Number(q.step) || 1) !== steps[step]}>
            <label htmlFor={'assessment-' + name}>{q.label}</label>
            {q.type === 'select' ? (
              <select
                id={'assessment-' + name}
                className="input"
                {...register(name, { required: 'Resposta obrigatória.' })}
              >
                <option value="">Selecione…</option>
                {q.options?.map((o: string) => (
                  <option value={o} key={o}>
                    {o}
                  </option>
                ))}
              </select>
            ) : q.type === 'number' ? (
              <input
                id={'assessment-' + name}
                className="input"
                type="number"
                {...register(name, {
                  required: 'Resposta obrigatória.',
                  valueAsNumber: true,
                  validate: (v) => Number.isFinite(v) || 'Informe um número válido.',
                })}
              />
            ) : (
              <textarea
                id={'assessment-' + name}
                className="input"
                {...register(name, { required: 'Resposta obrigatória.' })}
              />
            )}{' '}
            {errors[name] && <small className="field-error">{String(errors[name]?.message)}</small>}
          </div>
        );
      })}
      {error && <p className="error-banner">{error}</p>}
      <div className="form-footer">
        <Button variant="secondary" disabled={!step} onClick={() => setStep(step - 1)}>
          Voltar
        </Button>
        {step < steps.length - 1 ? (
          <Button
            onClick={async () => {
              const names = questions
                .map((q, i) => ((Number(q.step) || 1) === steps[step] ? String(i) : ''))
                .filter(Boolean);
              if (await trigger(names)) setStep(step + 1);
            }}
          >
            Próxima etapa
          </Button>
        ) : (
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? 'Salvando…' : 'Salvar avaliação'}
          </Button>
        )}
      </div>
    </form>
  );
}
