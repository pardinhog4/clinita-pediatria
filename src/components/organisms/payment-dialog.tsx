'use client';
import { useClinicRules } from '@/hooks/use-clinic-rules';
import { useState, useEffect } from 'react';
import { LedgerCorrection, ReasonButton, HistoryButton } from './record-lifecycle';
import { z } from 'zod';
import { api, post } from '@/lib/client';
import { paymentSchema, reverseSchema } from '@/lib/schemas';
import { currency, dateLabel, type Entity } from '@/lib/types';
import { useNotices } from '@/stores/workspace';
import { Dialog } from '../molecules/dialog';
import { SchemaForm } from './schema-form';
import { Button } from '../atoms/button';
export const paymentMethods = [
  { value: 'PIX', label: 'Pix' },
  { value: 'TRANSFER', label: 'Transferência' },
  { value: 'BOLETO', label: 'Boleto' },
  { value: 'CASH', label: 'Dinheiro' },
  { value: 'CARD', label: 'Cartão em maquininha externa' },
  { value: 'OTHER', label: 'Outro' },
];
export function PaymentDialog({
  row,
  unitId,
  onClose,
  onSaved,
}: {
  row: Entity;
  unitId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { upload_max_mb } = useClinicRules();
  const [record, setRecord] = useState<Entity | null>(null),
    [file, setFile] = useState<File | null>(null),
    [reversing, setReversing] = useState(false),
    [error, setError] = useState('');
  const add = useNotices((s) => s.add);
  useEffect(() => {
    api<Entity>('ledger/' + row.id)
      .then(setRecord)
      .catch((e) => setError(e.message));
  }, [row.id]);
  return (
    <Dialog
      title={row.kind === 'INCOME' ? 'Recebimento manual' : 'Pagamento manual'}
      onClose={onClose}
      wide
    >
      <div className="record-header">
        <div>
          <h2>{row.description}</h2>
          <p>
            {currency(row.amount)} · vencimento {dateLabel(row.due_date)}
          </p>
        </div>
      </div>
      <div className="note">
        A operação acontece fora da plataforma. Este registro identifica a conferência feita pela
        equipe.
      </div>
      {record && (
        <div className="record-admin">
          {record.status === 'OPEN' && (
            <>
              <LedgerCorrection
                row={record}
                onDone={() => {
                  onSaved();
                  onClose();
                }}
              />
              <ReasonButton
                label="Cancelar lançamento"
                title={'Cancelar · ' + record.description}
                description="Lançamento em aberto cancelado sai das contas a pagar/receber. Fica registrado com o motivo. Lançamentos baixados se corrigem pelo estorno."
                action="ledger-cancel"
                payload={{ id: record.id, version: record.version }}
                done="Lançamento cancelado."
                onDone={() => {
                  onSaved();
                  onClose();
                }}
              />
            </>
          )}
          {record.status === 'CANCELLED' && (
            <span className="muted small">Cancelado: {record.cancel_reason}</span>
          )}
          <HistoryButton resource="ledger" entity={record} />
        </div>
      )}
      {error && <div className="error-banner">{error}</div>}
      {record?.status === 'OPEN' && !reversing && (
        <>
          <div className="field">
            <label htmlFor="receipt">Comprovante PDF opcional (até {upload_max_mb} MB)</label>
            <input
              className="input"
              id="receipt"
              type="file"
              accept="application/pdf"
              onChange={(e) => setFile(e.target.files?.[0] || null)}
            />
          </div>
          <SchemaForm
            schema={paymentSchema
              .extend({
                counterparty_ref: z.string().min(1, 'Selecione no cadastro.'),
                confirmed: z.literal(true, { error: 'Confirme a conferência do valor.' }),
              })
              .transform(({ confirmed, ...data }) => data)}
            fields={[
              { name: 'paid_date', label: 'Data realizada', type: 'date' },
              { name: 'method', label: 'Forma utilizada', type: 'select', options: paymentMethods },
              {
                name: 'counterparty_ref',
                label: row.kind === 'INCOME' ? 'Recebido de' : 'Pago a',
                type: 'directory',
                directoryKind: 'counterparties',
                unitId,
              },
              { name: 'reference', label: 'Referência / identificação opcional' },
              { name: 'notes', label: 'Observações', type: 'textarea' },
              {
                name: 'confirmed',
                label: 'Conferi a realização e o valor integral desta operação',
                type: 'checkbox',
              },
            ]}
            defaults={{
              version: record.version,
              paid_date: new Date().toLocaleDateString('sv-SE'),
              method: 'PIX',
              counterparty: record.counterparty || 'Seleção no cadastro',
              counterparty_ref:
                record.counterparty_ref || (record.counterparty ? 'ledger:' + record.id : ''),
              reference: '',
              notes: '',
              confirmed: false,
            }}
            label={row.kind === 'INCOME' ? 'Registrar recebimento' : 'Registrar pagamento'}
            onSubmit={async (data) => {
              if (file) {
                if (file.size > upload_max_mb * 1048576)
                  throw Error(`Comprovante acima de ${upload_max_mb} MB.`);
                const form = new FormData();
                form.set('file', file);
                form.set('unit_id', unitId);
                const document = await api<Entity>('documents', { method: 'POST', body: form });
                data.document_id = document.id;
              }
              await post('ledger/' + row.id + '/settle', data);
              add('Baixa registrada com histórico.');
              onSaved();
              onClose();
            }}
          />
        </>
      )}
      {record?.status === 'SETTLED' && !reversing && (
        <Button variant="secondary" onClick={() => setReversing(true)}>
          Corrigir baixa com justificativa
        </Button>
      )}
      {record && reversing && (
        <SchemaForm
          schema={reverseSchema}
          fields={[{ name: 'reason', label: 'Justificativa da correção', type: 'textarea' }]}
          defaults={{ version: record.version, reason: '' }}
          label="Confirmar correção"
          onSubmit={async (data) => {
            await post('ledger/' + row.id + '/reverse', data);
            add('Correção registrada; histórico preservado.');
            onSaved();
            onClose();
          }}
        />
      )}
      <h3 className="section-title">Histórico de registros</h3>
      {record?.events?.length ? (
        record.events.map((e: Entity) => (
          <div className="timeline-item" key={e.id}>
            <strong>{e.kind === 'SETTLEMENT' ? 'Baixa manual' : 'Correção de baixa'}</strong>
            <small>
              {e.author} · {new Date(e.created_at).toLocaleString('pt-BR')}
            </small>
            <p>
              {e.paid_date ? dateLabel(e.paid_date) + ' · ' : ''}
              {paymentMethods.find((m) => m.value === e.method)?.label} {e.counterparty}
            </p>
            <p className="muted">
              {e.reference} {e.notes}
            </p>
            {e.document_id && (
              <a className="button secondary small" href={'/api/documents/' + e.document_id}>
                Baixar comprovante
              </a>
            )}
          </div>
        ))
      ) : (
        <p className="muted">Nenhum pagamento ou recebimento registrado.</p>
      )}
    </Dialog>
  );
}
