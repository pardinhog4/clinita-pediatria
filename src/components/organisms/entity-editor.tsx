'use client';
import { fromLocalInput } from '@/lib/timezone';
import { viewTimezone } from '@/lib/view-timezone';
import type { Entity, Lookups } from '@/lib/types';
import { RecordActions, ProceduresButton } from './record-lifecycle';
import * as schemas from '@/lib/schemas';
import { post, patch } from '@/lib/client';
import { useNotices } from '@/stores/workspace';
import { Dialog } from '../molecules/dialog';
import { SchemaForm, type Field } from './schema-form';
import { z } from 'zod';
import { hoursLabel, weekdayNames } from '@/lib/clinic-rules';
import { useClinicRules } from '@/hooks/use-clinic-rules';
import { offsetLabel } from '@/lib/timezone';
const options = (list: Entity[]) => list.map((r) => ({ value: r.id, label: r.name }));
export function EntityEditor({
  resource,
  entity,
  preset,
  unitId,
  lookups,
  onClose,
  onSaved,
}: {
  resource: string;
  entity?: Entity;
  preset?: Record<string, any>;
  unitId: string;
  lookups: Lookups;
  onClose: () => void;
  onSaved: () => void;
}) {
  const add = useNotices((s) => s.add);
  const rules = useClinicRules(unitId);
  // Dias da semana em que a unidade abre (segunda primeiro), para as listas de dias.
  const openDays = [1, 2, 3, 4, 5, 6, 0]
    .filter((d) => rules.business_hours[d])
    .map((d) => ({
      value: String(d),
      label: weekdayNames[d][0].toUpperCase() + weekdayNames[d].slice(1),
    }));
  const specialtyOptions = schemas.specialtyOptions().map(([value, label]) => ({ value, label }));
  let schema: z.ZodType = schemas.patientSchema,
    fields: Field[] = [],
    defaults: Record<string, any> = {},
    title = '';
  if (resource === 'patients') {
    schema = schemas.patientSchema;
    title = 'paciente';
    fields = [
      { name: 'name', label: 'Nome completo' },
      { name: 'birth_date', label: 'Nascimento', type: 'date' },
      { name: 'guardian', label: 'Responsável' },
      { name: 'phone', label: 'Telefone' },
      {
        name: 'insurer_id',
        label: 'Convênio',
        type: 'select',
        options: options(
          lookups.insurers.filter((i: any) => i.active !== false || i.id === entity?.insurer_id),
        ),
      },
      { name: 'card_number', label: 'Carteirinha' },
      { name: 'metadata.order_expires', label: 'Validade do pedido', type: 'date' },
      {
        name: 'metadata.specialties',
        label: 'Especialidades do pedido',
        type: 'multiselect',
        options: specialtyOptions,
      },
      { name: 'metadata.order_issued', label: 'Data de emissão do pedido', type: 'date' },
      {
        name: 'metadata.authorized_total',
        label: 'Quantidade total autorizada (0 = não informada)',
        type: 'number',
      },
      { name: 'metadata.interventions', label: 'Intervenções solicitadas', type: 'tags' },
      { name: 'metadata.demands', label: 'Demandas / observações do pedido', type: 'tags' },
      {
        name: 'metadata.preferred_days',
        label: 'Dias preferidos',
        type: 'multiselect',
        options: openDays,
      },
      {
        name: 'metadata.preferred_period',
        label: 'Período preferido',
        type: 'select',
        options: [
          { value: 'ANY', label: 'Qualquer período' },
          { value: 'MORNING', label: 'Manhã' },
          { value: 'AFTERNOON', label: 'Tarde' },
        ],
      },
      { name: 'metadata.coparticipation', label: 'Paciente paga coparticipação', type: 'checkbox' },
      {
        name: 'metadata.biometric_required',
        label: 'Exige confirmação biométrica presencial',
        type: 'checkbox',
      },
      ...specialtyOptions.map((o) => ({
        name: 'metadata.fixed_professionals.' + o.value,
        label: 'Profissional fixo · ' + o.label,
        type: 'select' as const,
        options: lookups.professionals
          .filter((p) => p.active && p.specialty === o.value)
          .map((p) => ({ value: p.id, label: p.name })),
      })),
      ...specialtyOptions.map((o) => ({
        name: 'metadata.weekly_limits.' + o.value,
        label: 'Limite semanal · ' + o.label,
        type: 'number' as const,
        hint: '0 = quantitativo não informado.',
      })),
    ];
    defaults = {
      unit_id: unitId,
      name: entity?.name || '',
      birth_date: entity?.birth_date?.slice(0, 10) || '',
      guardian: entity?.guardian || '',
      phone: entity?.phone || '',
      insurer_id: entity?.insurer_id || '',
      card_number: entity?.card_number || '',
      metadata: {
        ...entity?.metadata,
        weekly_limits: entity?.metadata?.weekly_limits || {},
        preferred_period: entity?.metadata?.preferred_period || 'ANY',
        specialties: entity?.metadata?.specialties || [],
        order_expires: entity?.metadata?.order_expires || '',
      },
    };
  }
  if (resource === 'professionals') {
    schema = schemas.professionalSchema;
    title = 'profissional';
    fields = [
      { name: 'name', label: 'Nome completo' },
      { name: 'specialty', label: 'Especialidade', type: 'select', options: specialtyOptions },
      {
        name: 'room_id',
        label: 'Sala',
        type: 'select',
        options: options(
          lookups.rooms.filter((r: any) => r.active !== false || r.id === entity?.room_id),
        ),
      },
      {
        name: 'contract',
        label: 'Vínculo',
        type: 'select',
        options: [
          { value: 'PJ', label: 'Pessoa jurídica' },
          { value: 'CLT', label: 'CLT' },
        ],
      },
      { name: 'hourly_rate', label: 'Repasse por hora (R$)', type: 'number', step: '0.01' },
      {
        name: 'metadata.session_rate_30',
        label: 'Repasse por sessão de 30 min (R$)',
        type: 'number',
        step: '0.01',
        hint: '0 = metade do valor por hora.',
      },
      {
        name: 'competencies',
        label: 'Competências',
        type: 'tags',
        hint: 'Separe por vírgulas. A clínica deve conferir os certificados.',
      },
      { name: 'metadata.min_age', label: 'Idade mínima atendida (anos)', type: 'number' },
      { name: 'metadata.max_age', label: 'Idade máxima atendida (anos)', type: 'number' },
      {
        name: 'metadata.work_days',
        label: 'Dias de atendimento',
        type: 'multiselect',
        options: openDays,
      },
      {
        name: 'metadata.work_hours',
        label: 'Horário próprio por dia',
        type: 'week-hours',
        hint:
          'Marque só os dias com horário diferente do expediente da unidade (' +
          hoursLabel(rules.business_hours[1]) +
          ' na segunda).',
      },
      { name: 'metadata.assistant_names', label: 'Assistentes terapêuticas da sala', type: 'tags' },
    ];
    defaults = {
      unit_id: unitId,
      name: entity?.name || '',
      specialty: entity?.specialty || '',
      room_id: entity?.room_id || '',
      contract: entity?.contract || 'PJ',
      hourly_rate: entity?.hourly_rate ?? '',
      competencies: entity?.competencies || [],
      metadata: {
        session_rate_30: 0,
        min_age: 0,
        max_age: 18,
        work_days: openDays.map((d) => Number(d.value)),
        assistant_names: [],
        ...entity?.metadata,
      },
    };
  }
  if (resource === 'appointments') {
    schema = schemas.appointmentSchema;
    title = 'agendamento';
    fields = [
      {
        name: 'patient_id',
        label: 'Paciente',
        type: 'directory',
        directoryKind: 'patients',
        unitId,
        hint: 'Digite o nome do paciente ou do responsável.',
      },
      {
        name: 'professional_id',
        label: 'Profissional',
        type: 'directory',
        directoryKind: 'professionals',
        unitId,
        hint: 'Digite o nome ou a especialidade.',
      },
      {
        name: 'local_start',
        label: 'Data e hora (horário da unidade)',
        type: 'datetime-local',
        hint:
          'Fuso ' +
          offsetLabel(rules.timezone) +
          '. Expediente: ' +
          [1, 2, 3, 4, 5, 6, 0]
            .filter((d) => rules.business_hours[d])
            .map((d) => weekdayNames[d].slice(0, 3) + ' ' + hoursLabel(rules.business_hours[d]))
            .join(' · ') +
          '.',
      },
      {
        name: 'duration',
        label: 'Duração (minutos)',
        type: 'select',
        options: Array.from(
          { length: Math.floor(rules.max_clinic_duration / rules.slot_minutes) },
          (_, i) => (i + 1) * rules.slot_minutes,
        ).map((m) => ({ value: String(m), label: m + ' minutos' })),
      },
      {
        name: 'occurrences',
        label: 'Ocorrências semanais',
        type: 'number',
        hint: '1 a 12. A série inteira será validada antes de salvar.',
      },
      {
        name: 'appointment_kind',
        label: 'Tipo de atendimento',
        type: 'select',
        options: [
          { value: 'SESSION', label: 'Sessão' },
          { value: 'EVALUATION', label: 'Avaliação' },
          { value: 'REPLACEMENT', label: 'Reposição' },
          { value: 'ANTICIPATION', label: 'Antecipação' },
        ],
      },
      {
        name: 'override_duration',
        label: 'Duração excepcional justificada (risco de glosa)',
        type: 'checkbox',
      },
      { name: 'reason', label: 'Justificativa de encaixe / exceção', type: 'textarea' },
    ];
    schema = schemas.appointmentSchema
      .omit({ starts_at: true })
      .extend({ local_start: z.string().min(16) })
      .transform(({ local_start, ...v }) => ({
        ...v,
        starts_at: fromLocalInput(local_start, viewTimezone()).toISOString(),
      }));
    defaults = {
      unit_id: unitId,
      patient_id: '',
      professional_id: '',
      duration: Math.min(60, rules.max_clinic_duration),
      occurrences: 1,
      appointment_kind: 'SESSION',
      override_duration: false,
      reason: '',
      local_start: '',
    };
  }
  if (resource === 'ledger') {
    schema = schemas.ledgerSchema;
    title = 'lançamento';
    fields = [
      { name: 'description', label: 'Descrição' },
      {
        name: 'kind',
        label: 'Tipo',
        type: 'select',
        options: [
          { value: 'INCOME', label: 'A receber' },
          { value: 'EXPENSE', label: 'A pagar' },
        ],
      },
      { name: 'amount', label: 'Valor (R$)', type: 'number', step: '0.01' },
      { name: 'due_date', label: 'Vencimento', type: 'date' },
      {
        name: 'category',
        label: 'Categoria',
        type: 'select',
        options: [
          'Convênios',
          'Particular',
          'Estrutura',
          'Materiais',
          'Pessoal',
          'Repasse PJ',
          'Outros',
        ].map((value) => ({ value, label: value })),
      },
      {
        name: 'counterparty_ref',
        label: 'Cliente / fornecedor / favorecido',
        type: 'directory',
        directoryKind: 'counterparties',
        unitId,
        hint: 'Selecione um cadastro existente. O nome será preenchido pelo servidor.',
      },
    ];
    defaults = {
      unit_id: unitId,
      kind: 'INCOME',
      amount: '',
      due_date: new Date().toLocaleDateString('sv-SE'),
      description: '',
      category: 'Outros',
      counterparty: '',
      counterparty_ref: '',
    };
  }
  if (resource === 'inventory') {
    schema = schemas.inventorySchema;
    title = 'material';
    // Na edição a quantidade não aparece: o saldo só muda por entrada/saída (fica registrado).
    fields = [
      { name: 'name', label: 'Material' },
      ...(entity
        ? []
        : [{ name: 'quantity', label: 'Quantidade inicial', type: 'number' } as const]),
      { name: 'minimum', label: 'Estoque mínimo', type: 'number' },
    ];
    defaults = {
      unit_id: entity?.unit_id || unitId,
      name: entity?.name || '',
      quantity: entity?.quantity ?? 0,
      minimum: entity?.minimum ?? 5,
    };
  }
  if (resource === 'agents') {
    schema = schemas.agentSchema;
    title = 'agente';
    fields = [
      { name: 'name', label: 'Nome' },
      {
        name: 'specialty',
        label: 'Responsabilidade / fila',
        type: 'select',
        options: [
          { value: 'triagem', label: 'Acolhimento e triagem' },
          { value: 'agenda', label: 'Agenda' },
          { value: 'convenios', label: 'Convênios e documentos' },
          { value: 'guias', label: 'Guias e autorizações' },
          { value: 'auditoria', label: 'Auditoria' },
          { value: 'retorno', label: 'Relacionamento e retorno' },
        ],
      },
      { name: 'instructions', label: 'Instruções', type: 'textarea' },
      { name: 'knowledge', label: 'Base de conhecimento', type: 'textarea' },
      { name: 'confidence_threshold', label: 'Confiança mínima (%)', type: 'number' },
      { name: 'enabled', label: 'Habilitado na configuração', type: 'checkbox' },
      { name: 'use_scenarios', label: 'Usar cenários da clínica', type: 'checkbox' },
    ];
    defaults = entity
      ? Object.fromEntries(
          [
            'name',
            'specialty',
            'instructions',
            'knowledge',
            'confidence_threshold',
            'enabled',
            'use_scenarios',
          ].map((k) => [k, entity[k]]),
        )
      : {
          name: '',
          specialty: 'triagem',
          instructions: 'Acolha a família e encaminhe a solicitação para revisão humana.',
          knowledge: 'Utilize apenas informações cadastradas e confirmadas pela clínica.',
          confidence_threshold: 80,
          enabled: true,
          use_scenarios: false,
        };
  }
  if (resource === 'rooms') {
    schema = schemas.roomSchema;
    title = 'sala';
    fields = [
      { name: 'name', label: 'Nome da sala' },
      {
        name: 'capacity',
        label: 'Capacidade simultânea',
        type: 'number',
        hint: 'Salas ABA podem receber mais de um paciente; assistentes não ganham acesso próprio.',
      },
    ];
    defaults = { unit_id: unitId, name: entity?.name || '', capacity: entity?.capacity || 1 };
  }
  if (resource === 'conversations') {
    schema = z.object({
      unit_id: schemas.uuid,
      patient_id: schemas.uuid,
      summary: z.string().max(1000),
    });
    title = 'conversa';
    fields = [
      {
        name: 'patient_id',
        label: 'Paciente / responsável',
        type: 'directory',
        directoryKind: 'patients',
        unitId,
      },
      { name: 'summary', label: 'Resumo da demanda', type: 'textarea' },
    ];
    defaults = { unit_id: unitId, patient_id: '', summary: '' };
  }
  if (resource === 'insurers') {
    schema = schemas.insurerSchema;
    title = 'convênio';
    fields = [
      { name: 'name', label: 'Operadora / plano' },
      { name: 'rules.duration', label: 'Duração contratual (min)', type: 'number' },
      { name: 'rules.session_value', label: 'Valor contratado (R$)', type: 'number' },
      { name: 'rules.token_required', label: 'Exige token / autorização', type: 'checkbox' },
      { name: 'rules.signature_required', label: 'Exige guia assinada', type: 'checkbox' },
      { name: 'rules.documents', label: 'Documentos obrigatórios', type: 'tags' },
      { name: 'rules.notes', label: 'Observações contratuais', type: 'textarea' },
      {
        name: 'rules.authorization_type',
        label: 'Como a operadora autoriza',
        type: 'select',
        options: [
          { value: 'TOKEN', label: 'Token por sessão' },
          { value: 'GUIDE', label: 'Guia assinada' },
          { value: 'QUOTA', label: 'Cota / autorização prévia' },
          { value: 'PRIVATE', label: 'Particular' },
        ],
      },
      { name: 'rules.tokens_per_session', label: 'Tokens por sessão', type: 'number' },
      {
        name: 'rules.tokens_per_30',
        label: 'Tokens a cada 30 minutos (0 = usar por sessão)',
        type: 'number',
      },
      {
        name: 'rules.token_minutes_before',
        label: 'Solicitar token quantos minutos antes',
        type: 'number',
      },
      { name: 'rules.co_payment', label: 'Coparticipação (%)', type: 'number' },
      { name: 'rules.contract_end', label: 'Fim do contrato com a operadora', type: 'date' },
      {
        name: 'rules.authorized_sessions',
        label: 'Quantidade de sessões autorizadas (0 = conferir pedido)',
        type: 'number',
      },
      { name: 'rules.procedure_code', label: 'Código do procedimento contratado' },
      { name: 'rules.ans_registry', label: 'Registro ANS da operadora' },
      {
        name: 'change_reason',
        label: 'Justificativa da mudança de regra',
        type: 'textarea',
        hint: 'Obrigatória ao editar regras existentes.',
      },
    ];
    schema = schemas.insurerSchema.extend({
      change_reason: entity ? z.string().min(10) : z.string().optional(),
      rules: schemas.insurerSchema.shape.rules.extend({
        duration: z.coerce.number().int().min(15).max(180),
        session_value: z.preprocess(
          (v) => (v === '' ? undefined : v),
          z.coerce.number({ error: 'Informe o valor da sessão.' }).min(0),
        ),
      }),
    });
    defaults = {
      name: entity?.name || '',
      change_reason: '',
      rules: {
        duration: 60,
        session_value: '',
        token_required: false,
        signature_required: false,
        documents: ['Pedido médico'],
        notes: '',
        tokens_per_session: 1,
        tokens_per_30: 0,
        token_minutes_before: 30,
        co_payment: 0,
        authorized_sessions: 0,
        procedure_code: '',
        ans_registry: '',
        ...entity?.rules,
        authorization_type:
          entity?.rules?.authorization_type ||
          (entity?.rules?.token_required
            ? 'TOKEN'
            : entity?.rules?.signature_required
              ? 'GUIDE'
              : 'QUOTA'),
      },
    };
  }
  return (
    <Dialog title={(entity ? 'Editar ' : 'Cadastrar ') + title} onClose={onClose} wide>
      <SchemaForm
        schema={schema}
        fields={fields}
        defaults={{
          ...defaults,
          ...Object.fromEntries(
            Object.entries(preset || {}).filter(([key]) => key !== 'proposal_conversation'),
          ),
        }}
        label={
          entity
            ? 'Salvar alterações'
            : preset?.proposal_conversation
              ? 'Preparar proposta para a família'
              : 'Cadastrar'
        }
        onSubmit={async (data) => {
          const { change_reason, ...record } = data;
          if (entity)
            await patch(resource + '/' + entity.id, {
              version: entity.version,
              data: record,
              ...(change_reason ? { reason: change_reason } : {}),
            });
          else if (resource === 'appointments' && preset?.proposal_conversation) {
            const appointments = Array.from({ length: record.occurrences || 1 }, (_, i) => ({
              professional_id: record.professional_id,
              starts_at: new Date(
                new Date(record.starts_at).getTime() + i * 7 * 86400000,
              ).toISOString(),
              duration: record.duration,
            }));
            await post('operations', {
              operation: 'PROPOSAL_CREATE',
              unit_id: unitId,
              conversation_id: preset.proposal_conversation,
              request_id: crypto.randomUUID(),
              patient_id: record.patient_id,
              appointments,
            });
          } else await post(resource, record);
          add(
            preset?.proposal_conversation
              ? 'Proposta preparada. Registre o aceite e aprove em WhatsApp → Propostas.'
              : 'Registro salvo.',
          );
          onSaved();
          onClose();
        }}
      />
      {entity && (resource === 'insurers' || resource === 'rooms') && (
        <div className="record-admin">
          {resource === 'insurers' && <ProceduresButton insurer={entity} canManage />}
          <RecordActions
            resource={resource}
            entity={entity}
            role="ADMIN"
            onChanged={() => {
              onSaved();
              onClose();
            }}
          />
        </div>
      )}
    </Dialog>
  );
}
