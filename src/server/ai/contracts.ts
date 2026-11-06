import { z } from 'zod';
export const queueCodes = [
  'recepcao',
  'agenda',
  'convenios',
  'clinica',
  'auditoria',
  'financeiro',
] as const;
export const decisionSchema = z
  .object({
    reply: z.string().min(1).max(6000),
    summary: z.string().min(10).max(3000),
    confidence: z.number().min(0).max(1),
    next_action: z.enum(['ASK_USER', 'ANSWER', 'HANDOFF']),
    handoff_reason: z
      .enum([
        'USER_REQUEST',
        'CLINICAL_REVIEW',
        'OPERATIONAL_ACTION',
        'UNSUPPORTED',
        'INSUFFICIENT_CONFIDENCE',
      ])
      .nullable(),
    destination: z.enum(['AI', ...queueCodes]),
    requires_human: z.boolean(),
    recommended_specialties: z.array(z.string().trim().max(30)).max(7),
    professional_ids: z.array(z.uuid()).max(10),
    missing_information: z.array(z.string().max(500)).max(15),
    evidence: z
      .array(
        z
          .object({
            attachment_id: z.uuid(),
            page: z.number().int().min(1).max(20).nullable(),
            excerpt: z.string().max(1000),
          })
          .strict(),
      )
      .max(12),
  })
  .strict();
export type Decision = z.infer<typeof decisionSchema>;
export const decisionJsonSchema = {
  type: 'object',
  properties: {
    reply: { type: 'string' },
    summary: { type: 'string' },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    next_action: { type: 'string', enum: ['ASK_USER', 'ANSWER', 'HANDOFF'] },
    handoff_reason: {
      type: ['string', 'null'],
      enum: [
        'USER_REQUEST',
        'CLINICAL_REVIEW',
        'OPERATIONAL_ACTION',
        'UNSUPPORTED',
        'INSUFFICIENT_CONFIDENCE',
        null,
      ],
    },
    destination: { type: 'string', enum: ['AI', ...queueCodes] },
    requires_human: { type: 'boolean' },
    recommended_specialties: { type: 'array', items: { type: 'string' } },
    professional_ids: { type: 'array', items: { type: 'string' } },
    missing_information: { type: 'array', items: { type: 'string' } },
    evidence: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          attachment_id: { type: 'string' },
          page: { type: ['integer', 'null'] },
          excerpt: { type: 'string' },
        },
        required: ['attachment_id', 'page', 'excerpt'],
        additionalProperties: false,
      },
    },
  },
  required: [
    'reply',
    'summary',
    'confidence',
    'next_action',
    'handoff_reason',
    'destination',
    'requires_human',
    'recommended_specialties',
    'professional_ids',
    'missing_information',
    'evidence',
  ],
  additionalProperties: false,
};
export type ToolSpec = { name: string; description: string; schema: Record<string, unknown> };
export type AIContent = {
  role: 'user' | 'assistant';
  text: string;
  files?: { id: string; name: string; mime: string; base64: string }[];
};
export type ToolCall = { id: string; name: string; arguments: unknown };
export type ProviderTurn = {
  calls: ToolCall[];
  inputTokens: number;
  outputTokens: number;
  raw: unknown;
};
export type ProviderInput = {
  instructions: string;
  messages: AIContent[];
  history: any[];
  tools: ToolSpec[];
  finalOnly: boolean;
  signal: AbortSignal;
};
export interface Provider {
  turn(input: ProviderInput): Promise<ProviderTurn>;
  continueHistory(
    history: any[],
    turn: ProviderTurn,
    outputs: { call: ToolCall; result: unknown }[],
  ): any[];
}
