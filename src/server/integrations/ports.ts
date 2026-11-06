import { z } from 'zod';
import { specialtyCode } from '@/lib/schemas';
/** Contratos do próximo incremento; nenhuma integração externa é executada aqui. */
export const analysisDecisionSchema = z
  .object({
    summary: z.string().min(10).max(3000),
    confidence: z.number().min(0).max(1),
    recommendedSpecialties: z.array(specialtyCode),
    destination: z.enum(['RECEPTION', 'CLINICAL_REVIEW', 'AUDIT']),
    evidence: z.array(
      z.object({
        documentId: z.uuid().optional(),
        messageId: z.uuid().optional(),
        excerpt: z.string().max(1000),
      }),
    ),
    missingInformation: z.array(z.string().max(500)),
    requiresHumanApproval: z.literal(true),
  })
  .strict();
export type AnalysisDecision = z.infer<typeof analysisDecisionSchema>;
export type AuthorizedAnalysisInput = {
  tenantId: string;
  conversationId: string;
  patientId?: string;
  documentIds: string[];
  requestedBy: string;
  consentReference: string;
};
export interface ConversationAnalyzer {
  analyze(input: AuthorizedAnalysisInput): Promise<AnalysisDecision>;
}
export interface MessagingChannel {
  verifyWebhook(rawBody: Uint8Array, signature: string): boolean;
  receive(rawBody: Uint8Array): Promise<{
    externalMessageId: string;
    externalContactId: string;
    text: string;
    receivedAt: string;
  }>;
  send(input: {
    tenantId: string;
    conversationId: string;
    text: string;
    idempotencyKey: string;
  }): Promise<{ externalMessageId: string }>;
}
export interface PrivateDocumentStore {
  put(input: {
    tenantId: string;
    content: Uint8Array;
    mime: 'application/pdf';
  }): Promise<{ key: string }>;
  read(input: { tenantId: string; key: string }): Promise<Uint8Array>;
}
