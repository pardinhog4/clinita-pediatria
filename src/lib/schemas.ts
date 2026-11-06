import { workHoursSchema } from './clinic-rules';
import { z } from 'zod';
// Especialidades vêm da tabela specialties de cada clínica; aqui só o formato do código e os nomes padrão (atualizados pela sessão).
export const specialtyCode = z
  .string()
  .trim()
  .regex(/^[a-z][a-z0-9_]{1,29}$/, 'Especialidade inválida.');
export const labels: Record<string, string> = {
  fono: 'Fonoaudiologia',
  psico: 'Psicologia',
  to: 'Terapia ocupacional',
  aba: 'Terapia ABA',
  psped: 'Psicopedagogia',
  fisio: 'Fisioterapia',
  nutri: 'Nutrição',
};
// No navegador, a lista da clínica chega em /api/meta e substitui os nomes padrão. O servidor valida pela tabela (src/server/specialties.ts) e nunca usa este estado.
type SpecialtyInfo = { code: string; name: string; shared_room: boolean; active: boolean };
let specialtyState: SpecialtyInfo[] = Object.entries(labels).map(([code, name]) => ({
  code,
  name,
  shared_room: code === 'aba',
  active: true,
}));
export function setSpecialties(list: SpecialtyInfo[]) {
  specialtyState = list;
  for (const s of list) labels[s.code] = s.name;
}
export const specialtyOptions = (): [string, string][] =>
  specialtyState.filter((s) => s.active).map((s) => [s.code, s.name]);
export const sharedSpecialty = (code: string) =>
  !!specialtyState.find((s) => s.code === code)?.shared_room;
export const uuid = z.uuid();
const text = z.string().trim().min(2).max(500);
const date = z.iso.date();
/** Número obrigatório: campo vazio no formulário é recusado em vez de virar 0. */
const requiredNumber = (n: z.ZodNumber) =>
  z.preprocess((v) => (v === '' || v === null || v === undefined ? undefined : Number(v)), n);
export const patientSchema = z
  .object({
    name: text,
    birth_date: date.refine(
      (d) => d <= new Date().toISOString().slice(0, 10),
      'Nascimento no futuro.',
    ),
    guardian: text,
    phone: z.string().regex(/^[\d\s()+-]{10,22}$/, 'Telefone inválido.'),
    insurer_id: uuid,
    unit_id: uuid,
    card_number: z.string().max(80).default(''),
    metadata: z
      .object({
        specialties: z.array(specialtyCode).default([]),
        order_expires: z.union([date, z.literal('')]).optional(),
        notes: z.string().max(2000).optional(),
        parent_relationship: z.string().max(50).default('Responsável'),
        fixed_professionals: z.record(z.string(), z.union([z.uuid(), z.literal('')])).default({}),
        weekly_limits: z.record(z.string(), z.coerce.number().int().min(0).max(50)).default({}),
        interventions: z.array(z.string().max(100)).default([]),
        demands: z.array(z.string().max(100)).default([]),
        preferred_days: z.array(z.coerce.number().int().min(0).max(6)).default([]),
        preferred_period: z.enum(['ANY', 'MORNING', 'AFTERNOON']).default('ANY'),
        coparticipation: z.boolean().default(false),
        order_issued: z.union([z.iso.date(), z.literal('')]).optional(),
        authorized_total: z.coerce.number().int().min(0).max(10000).default(0),
        biometric_required: z.boolean().default(false),
      })
      .default({
        specialties: [],
        parent_relationship: 'Responsável',
        fixed_professionals: {},
        weekly_limits: {},
        interventions: [],
        demands: [],
        preferred_days: [],
        preferred_period: 'ANY',
        coparticipation: false,
        authorized_total: 0,
        biometric_required: false,
      }),
  })
  .strict();
export const professionalSchema = z
  .object({
    name: text,
    specialty: specialtyCode,
    unit_id: uuid,
    room_id: uuid,
    contract: z.enum(['PJ', 'CLT']),
    competencies: z.array(z.string().min(2).max(80)).max(30).default([]),
    hourly_rate: requiredNumber(z.number({ error: 'Informe o valor da hora.' }).min(0).max(100000)),
    metadata: z
      .object({
        session_rate_30: z.coerce.number().min(0).max(100000).default(0),
        min_age: z.coerce.number().int().min(0).max(100).default(0),
        max_age: z.coerce.number().int().min(0).max(100).default(18),
        work_days: z.array(z.coerce.number().int().min(0).max(6)).default([1, 2, 3, 4, 5, 6]),
        // Horário próprio por dia (opcional); sem ele, vale o expediente da unidade.
        work_hours: workHoursSchema,
        assistant_names: z.array(z.string().max(100)).default([]),
        pj_documents_confirmed: z.boolean().default(false),
        pj_documents_evidence: z.string().max(2000).optional(),
        certifications: z
          .array(
            z.object({
              code: z.string().max(100),
              level: z.string().max(50),
              verified: z.boolean(),
              document_id: z.uuid().optional(),
            }),
          )
          .default([]),
        user_id: z.uuid().optional(),
        transferred_to: z.uuid().optional(),
        notes: z.string().max(2000).optional(),
      })
      .default({
        session_rate_30: 0,
        min_age: 0,
        max_age: 18,
        work_days: [1, 2, 3, 4, 5, 6],
        assistant_names: [],
        pj_documents_confirmed: false,
        certifications: [],
      }),
  })
  .strict();
export const appointmentSchema = z
  .object({
    unit_id: uuid,
    patient_id: uuid,
    professional_id: uuid,
    starts_at: z.iso.datetime({ offset: true }),
    duration: z.coerce.number().int().min(15).max(240),
    location: z.enum(['CLINIC', 'HOME']).default('CLINIC'),
    occurrences: z.coerce.number().int().min(1).max(12).default(1),
    appointment_kind: z
      .enum(['SESSION', 'EVALUATION', 'REPLACEMENT', 'ANTICIPATION'])
      .default('SESSION'),
    replacement_credit_id: z.uuid().optional(),
    conversation_id: z.uuid().optional(),
    waitlist_id: z.uuid().optional(),
    reason: z.string().trim().max(3000).default(''),
    override_duration: z.boolean().default(false),
  })
  .strict();
export const ledgerSchema = z
  .object({
    unit_id: uuid,
    description: text,
    kind: z.enum(['INCOME', 'EXPENSE']),
    amount: z.coerce
      .number()
      .positive()
      .max(100000000)
      .refine(
        (v) => Math.abs(v * 100 - Math.round(v * 100)) < 0.00001,
        'Use até duas casas decimais.',
      ),
    due_date: date,
    category: text,
    counterparty: z.string().trim().max(200).default(''),
    counterparty_ref: z.string().max(100).optional(),
  })
  .strict();
export const paymentSchema = z
  .object({
    version: z.number().int().positive(),
    paid_date: date.refine((d) => d <= new Date().toLocaleDateString('sv-SE'), 'Data no futuro.'),
    method: z.enum(['PIX', 'TRANSFER', 'BOLETO', 'CASH', 'CARD', 'OTHER']),
    counterparty: text,
    counterparty_ref: z.string().max(100).optional(),
    reference: z.string().max(200).default(''),
    notes: z.string().max(2000).default(''),
    document_id: uuid.optional(),
  })
  .strict();
export const reverseSchema = z
  .object({ version: z.number().int().positive(), reason: z.string().trim().min(10).max(1000) })
  .strict();
export const agentSchema = z
  .object({
    name: text,
    specialty: z.string().min(2).max(100),
    instructions: z.string().trim().min(20).max(12000),
    knowledge: z.string().trim().min(10).max(30000),
    enabled: z.boolean(),
    confidence_threshold: z.coerce.number().int().min(60).max(100),
    use_scenarios: z.boolean().default(false),
  })
  .strict();
export const conversationSchema = z
  .object({
    unit_id: uuid,
    guardian: text.default('Contato'),
    patient_id: uuid.optional(),
    summary: z.string().max(1000).default(''),
  })
  .strict();
export const inventorySchema = z
  .object({
    unit_id: uuid,
    name: text,
    quantity: z.coerce.number().int().min(0).max(100000),
    minimum: z.coerce.number().int().min(0).max(100000),
  })
  .strict();
export const clinicalSchema = z
  .object({
    patient_id: uuid,
    kind: z.enum(['ANAMNESIS', 'ASSESSMENT', 'PLAN', 'REPORT']),
    content: z.string().trim().min(20).max(30000),
    recipient: z.string().trim().max(200).optional(),
    model_id: uuid.optional(),
    answers: z
      .record(z.string(), z.union([z.string().max(5000), z.number(), z.boolean()]))
      .optional(),
  })
  .strict();
export const modelSchema = z
  .object({
    name: text,
    specialty: specialtyCode,
    questions: z
      .array(
        z.object({
          label: text,
          type: z.enum(['text', 'number', 'select']),
          options: z.array(z.string().trim().min(1).max(500)).optional(),
          step: z.coerce.number().int().min(1).max(20).default(1),
        }),
      )
      .min(1)
      .max(50),
  })
  .strict();
export const roomSchema = z
  .object({ unit_id: uuid, name: text, capacity: z.coerce.number().int().min(1).max(10) })
  .strict();
export const insurerSchema = z
  .object({
    name: text,
    rules: z.object({
      duration: z.number().int().min(15).max(180),
      token_required: z.boolean(),
      signature_required: z.boolean(),
      documents: z.array(z.string().max(150)),
      session_value: z.number().min(0),
      notes: z.string().max(2000),
      authorization_type: z.enum(['TOKEN', 'GUIDE', 'QUOTA', 'PRIVATE']).optional(),
      tokens_per_session: z.coerce.number().int().min(1).max(12).default(1),
      tokens_per_30: z.coerce.number().int().min(0).max(4).default(0),
      token_minutes_before: z.coerce.number().int().min(0).max(1440).default(30),
      co_payment: z.coerce.number().min(0).max(100).default(0),
      contract_end: z.union([z.iso.date(), z.literal('')]).optional(),
      authorized_sessions: z.coerce.number().int().min(0).max(10000).default(0),
      procedure_code: z.string().max(20).default(''),
      ans_registry: z.string().max(20).default(''),
      integration_status: z.enum(['NOT_CONNECTED', 'MANUAL']).default('MANUAL'),
    }),
  })
  .strict();
export const eventSchema = z
  .object({
    version: z.number().int().positive(),
    action: z.enum([
      'arrive',
      'authorize',
      'start',
      'complete',
      'absent',
      'cancel',
      'approve',
      'return',
      'sign',
    ]),
    reason: z.string().trim().max(5000).default(''),
    content: z.string().trim().max(30000).default(''),
    tokens: z.array(z.string().trim().min(3).max(128)).max(12).optional(),
    authorization_expires: z.iso.date().optional(),
    absence_kind: z.enum(['PATIENT', 'PROFESSIONAL']).default('PATIENT'),
    assistant_names: z.array(z.string().max(100)).max(10).default([]),
  })
  .strict();
