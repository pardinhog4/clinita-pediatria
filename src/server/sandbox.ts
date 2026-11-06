import { megabytes } from '@/lib/clinic-rules';
import { tenantRules } from './clinic-rules';
import { randomUUID, createHash } from 'node:crypto';
import { z } from 'zod';
import { NextRequest, NextResponse } from 'next/server';
import { PDFDocument } from 'pdf-lib';
import { query, transaction } from '@/lib/db';
import { ApiError } from '@/lib/errors';
import { permit, assertUnit, type Context } from '@/lib/security';
import { audit, scopeRow, clinicalAccess, receptionRoles, clinicRoles } from './repository';
import { readLimited } from './http';
import { aiConfiguration } from './ai/providers';
import { conversationPlan } from './referrals';
import { brainEnabled, brainOnline } from './brain/client';
import {
  brainClose,
  brainFamilyMessage,
  brainGiveBack,
  brainReset,
  brainTakeOver,
  brainTeamMessage,
  sendToBrain,
  sweepStaleBrainRuns,
} from './brain/bridge';
export async function sandboxConversation(
  c: import('pg').PoolClient,
  ctx: Context,
  id: string,
  lock = false,
) {
  permit(ctx, receptionRoles);
  const conv = await scopeRow(c, ctx, 'conversations', z.uuid().parse(id), lock);
  if (!conv.sandbox || conv.deleted_at) throw new ApiError(404, 'Sessão Sandbox não encontrada.');
  if (conv.include_clinical_context && conv.patient_id) await clinicalAccess(ctx, conv.patient_id);
  return conv;
}
export async function ensureQueues(c: import('pg').PoolClient, tenantId: string, unitId: string) {
  await c.query(
    "INSERT INTO service_queues(tenant_id,unit_id,code,name) SELECT $1,$2,v.code,v.name FROM(VALUES('recepcao','Recepção'),('agenda','Agendamento'),('convenios','Documentos e convênios'),('clinica','Coordenação clínica'),('auditoria','Auditoria'),('financeiro','Financeiro'))v(code,name) ON CONFLICT DO NOTHING",
    [tenantId, unitId],
  );
}
export async function listSandbox(ctx: Context, unitId: string) {
  permit(ctx, receptionRoles);
  assertUnit(ctx, unitId);
  const config = aiConfiguration();
  const [worker] = brainEnabled()
    ? [{ online: await brainOnline() }]
    : await query(
        "SELECT EXISTS(SELECT 1 FROM worker_heartbeats WHERE last_seen>now()-interval '30 seconds') AS online",
      );
  const data = await query(
    `SELECT c.id,c.guardian,c.patient_id,c.ai_mode,c.version,c.created_at,c.summary,c.queue_id,q.name AS queue_name,ar.status AS run_status FROM conversations c LEFT JOIN service_queues q ON q.id=c.queue_id AND q.tenant_id=c.tenant_id LEFT JOIN LATERAL(SELECT status FROM agent_runs WHERE tenant_id=c.tenant_id AND conversation_id=c.id ORDER BY created_at DESC LIMIT 1)ar ON true WHERE c.tenant_id=$1 AND c.unit_id=$2 AND c.sandbox=true AND c.deleted_at IS NULL AND (c.include_clinical_context=false OR $3::boolean) ORDER BY c.created_at DESC LIMIT 100`,
    [ctx.tenantId, unitId, clinicRoles.includes(ctx.role)],
  );
  return {
    data,
    configuration: {
      provider: config.provider,
      model: config.model,
      configured: config.configured,
      worker_online: !!worker.online,
      max_file_mb: 2,
      max_files_per_message: 3,
      max_pdf_pages: 20,
    },
  };
}
export async function createSandbox(ctx: Context, input: unknown) {
  permit(ctx, receptionRoles);
  const d = z
    .object({
      unit_id: z.uuid(),
      patient_id: z.uuid().optional(),
      consent: z.literal(true),
      include_clinical_context: z.boolean().default(false),
    })
    .strict()
    .parse(input);
  assertUnit(ctx, d.unit_id);
  if (d.include_clinical_context) {
    if (!d.patient_id) throw new ApiError(422, 'Vincule um paciente antes de incluir prontuário.');
    await clinicalAccess(ctx, d.patient_id);
  }
  return transaction(async (c) => {
    let guardian = 'Família · teste sem cadastro';
    if (d.patient_id) {
      const p = await scopeRow(c, ctx, 'patients', d.patient_id);
      if (p.unit_id !== d.unit_id) throw new ApiError(422, 'Paciente de outra unidade.');
      guardian = p.guardian;
    }
    await ensureQueues(c, ctx.tenantId, d.unit_id);
    const {
      rows: [conv],
    } = await c.query(
      "INSERT INTO conversations(tenant_id,unit_id,patient_id,guardian,channel,sandbox,ai_mode,include_clinical_context,consent_at) VALUES($1,$2,$3,$4,'SANDBOX',true,'AI',$5,now()) RETURNING *",
      [ctx.tenantId, d.unit_id, d.patient_id || null, guardian, d.include_clinical_context],
    );
    await audit(c, ctx, 'sandbox.created', 'conversations', conv.id, d.unit_id, {
      clinicalContext: d.include_clinical_context,
      syntheticDataConfirmed: true,
    });
    return conv;
  });
}
export async function sandboxDetail(ctx: Context, id: string) {
  await sweepStaleBrainRuns(ctx.tenantId);
  return transaction(async (c) => {
    const conv = await sandboxConversation(c, ctx, id);
    const { rows: messages } = await c.query(
      `SELECT m.id,m.direction,m.content,m.created_at,m.agent_name,m.agent_run_id,coalesce((SELECT json_agg(json_build_object('id',a.id,'name',a.name,'mime',a.mime)) FROM message_attachments ma JOIN sandbox_attachments a ON a.id=ma.attachment_id AND a.tenant_id=ma.tenant_id WHERE ma.message_id=m.id AND ma.tenant_id=m.tenant_id),'[]') AS attachments FROM messages m WHERE m.tenant_id=$1 AND m.conversation_id=$2 ORDER BY m.created_at,m.id LIMIT 300`,
      [ctx.tenantId, id],
    );
    const { rows: runs } = await c.query(
      'SELECT id,status,provider,model,decision,trace,input_tokens,output_tokens,attempts,error_code,error_message,created_at,finished_at FROM agent_runs WHERE tenant_id=$1 AND conversation_id=$2 ORDER BY created_at DESC LIMIT 30',
      [ctx.tenantId, id],
    );
    const { rows: profiles } = await c.query(
      'SELECT id,name,specialty,version,enabled FROM agents WHERE tenant_id=$1 ORDER BY name',
      [ctx.tenantId],
    );
    const {
      rows: [queue],
    } = conv.queue_id
      ? await c.query('SELECT name FROM service_queues WHERE tenant_id=$1 AND id=$2', [
          ctx.tenantId,
          conv.queue_id,
        ])
      : { rows: [] };
    return {
      ...conv,
      queue_name: queue?.name || null,
      messages,
      runs,
      agents: profiles,
      plan: await conversationPlan(ctx.tenantId, id),
    };
  });
}
export async function uploadSandbox(req: NextRequest, ctx: Context, id: string) {
  await transaction((c) => sandboxConversation(c, ctx, id));
  const { upload_max_mb, upload_max_pages } = await tenantRules(ctx.tenantId);
  const bytes = await readLimited(req, megabytes(upload_max_mb) + 300000);
  const form = await new Response(new Uint8Array(bytes), {
    headers: { 'content-type': req.headers.get('content-type') || '' },
  }).formData();
  const file = form.get('file');
  if (!(file instanceof File) || file.size > megabytes(upload_max_mb) || file.size < 5)
    throw new ApiError(422, `Envie PDF, PNG, JPEG ou WEBP de até ${upload_max_mb} MB.`);
  const content = Buffer.from(await file.arrayBuffer());
  let mime = '';
  let pageCount: number | null = null;
  if (content.subarray(0, 5).toString() === '%PDF-') {
    mime = 'application/pdf';
    try {
      const pdf = await PDFDocument.load(content);
      pageCount = pdf.getPageCount();
      if (pdf.getPageCount() > upload_max_pages)
        throw new ApiError(422, `Limite de ${upload_max_pages} páginas por PDF.`);
    } catch (e) {
      if (e instanceof ApiError) throw e;
      throw new ApiError(422, 'PDF inválido, protegido por senha ou não suportado.');
    }
  } else if (content.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
    mime = 'image/png';
  else if (content[0] === 255 && content[1] === 216 && content[2] === 255) mime = 'image/jpeg';
  else if (
    content.subarray(0, 4).toString() === 'RIFF' &&
    content.subarray(8, 12).toString() === 'WEBP'
  )
    mime = 'image/webp';
  if (!mime) throw new ApiError(422, 'Formato não suportado. Use PDF, PNG, JPEG ou WEBP.');
  return transaction(async (c) => {
    const conv = await sandboxConversation(c, ctx, id, true);
    const {
      rows: [doc],
    } = await c.query(
      'INSERT INTO sandbox_attachments(tenant_id,unit_id,conversation_id,name,mime,content,sha256,created_by,page_count) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id,name,mime',
      [
        ctx.tenantId,
        conv.unit_id,
        id,
        file.name.slice(0, 180),
        mime,
        content,
        createHash('sha256').update(content).digest('hex'),
        ctx.userId,
        pageCount,
      ],
    );
    await audit(c, ctx, 'sandbox.attachment_uploaded', 'conversations', id, conv.unit_id, {
      attachmentId: doc.id,
      mime,
    });
    return doc;
  });
}
export async function sandboxAttachment(ctx: Context, id: string, attachmentId: string) {
  return transaction(async (c) => {
    await sandboxConversation(c, ctx, id);
    const {
      rows: [file],
    } = await c.query(
      'SELECT name,mime,content FROM sandbox_attachments WHERE tenant_id=$1 AND conversation_id=$2 AND id=$3',
      [ctx.tenantId, id, z.uuid().parse(attachmentId)],
    );
    if (!file) throw new ApiError(404, 'Anexo não encontrado.');
    return new NextResponse(new Uint8Array(file.content), {
      headers: {
        'Content-Type': file.mime,
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(file.name)}`,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  });
}
export async function humanSandboxMessage(ctx: Context, id: string, input: unknown) {
  const d = z
    .object({
      content: z.string().trim().min(1).max(10000),
      direction: z.enum(['INBOUND', 'OUTBOUND']),
      request_id: z.uuid(),
    })
    .strict()
    .parse(input);
  return transaction(async (c) => {
    const conv = await sandboxConversation(c, ctx, id, true);
    if (conv.ai_mode !== 'HUMAN')
      throw new ApiError(409, 'Assuma o atendimento antes de responder como equipe.');
    const {
      rows: [message],
    } = await c.query(
      'INSERT INTO messages(tenant_id,conversation_id,direction,content,created_by,request_id) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(tenant_id,conversation_id,request_id) WHERE request_id IS NOT NULL DO UPDATE SET request_id=EXCLUDED.request_id RETURNING id',
      [ctx.tenantId, id, d.direction, d.content, ctx.userId, d.request_id],
    );
    await audit(c, ctx, 'sandbox.human_message', 'conversations', id, conv.unit_id, {
      direction: d.direction,
    });
    if (d.direction === 'OUTBOUND') await brainTeamMessage(id, d.content, ctx.name);
    else await brainFamilyMessage(id, d.content, d.request_id);
    return message;
  });
}
export async function enqueueSandbox(ctx: Context, id: string, input: unknown) {
  permit(ctx, receptionRoles);
  const d = z
    .object({
      request_id: z.uuid(),
      content: z.string().trim().max(10000).default(''),
      attachment_ids: z
        .array(z.uuid())
        .max(3)
        .refine((ids) => new Set(ids).size === ids.length, 'Não repita o mesmo anexo.')
        .default([]),
      agent_id: z.uuid().optional(),
      retry_run_id: z.uuid().optional(),
    })
    .strict()
    .parse(input);
  const config = aiConfiguration();
  if (!config.configured)
    throw new ApiError(
      503,
      brainEnabled()
        ? 'Configure BRAIN_API_KEY, BRAIN_TOOLS_SECRET e BRAIN_WEBHOOK_SECRET no .env (motor brain-desk).'
        : 'Configure OPENAI_API_KEY no .env e reinicie o servidor e o worker. Para Gemini, configure também GEMINI_MODEL.',
    );
  const queued = await transaction(async (c) => {
    const conv = await sandboxConversation(c, ctx, id, true);
    const {
      rows: [existing],
    } = await c.query(
      'SELECT run_id FROM sandbox_requests WHERE tenant_id=$1 AND conversation_id=$2 AND request_id=$3',
      [ctx.tenantId, id, d.request_id],
    );
    if (existing) return { id: existing.run_id, idempotent: true };
    if (conv.ai_mode !== 'AI')
      throw new ApiError(409, 'A equipe está no controle. Devolva para a IA antes de executar.');
    if (!conv.consent_at) throw new ApiError(422, 'Confirmação de dados de teste ausente.');
    if (
      (
        await c.query(
          "SELECT id FROM agent_runs WHERE tenant_id=$1 AND conversation_id=$2 AND status IN('QUEUED','RUNNING')",
          [ctx.tenantId, id],
        )
      ).rowCount
    )
      throw new ApiError(409, 'Aguarde a análise atual.');
    const { rows: profiles } = await c.query(
      'SELECT id,name,specialty,instructions,knowledge,version,confidence_threshold,use_scenarios FROM agents WHERE tenant_id=$1 AND enabled=true ORDER BY name',
      [ctx.tenantId],
    );
    const selected = d.agent_id
      ? profiles.find((p) => p.id === d.agent_id)
      : profiles.find((p) => p.specialty === 'triagem') || profiles[0];
    if (!selected) throw new ApiError(422, 'Habilite um agente para esta clínica.');
    let inputId: string;
    if (d.retry_run_id) {
      const {
        rows: [old],
      } = await c.query(
        "SELECT ar.input_message_id FROM agent_runs ar JOIN messages m ON m.id=ar.input_message_id AND m.tenant_id=ar.tenant_id JOIN conversations c ON c.id=ar.conversation_id AND c.tenant_id=ar.tenant_id WHERE ar.tenant_id=$1 AND ar.conversation_id=$2 AND ar.id=$3 AND ar.status='FAILED' AND (c.context_started_at IS NULL OR m.created_at>=c.context_started_at)",
        [ctx.tenantId, id, d.retry_run_id],
      );
      if (!old) throw new ApiError(422, 'Execução indisponível para repetir.');
      inputId = old.input_message_id;
    } else {
      if (!d.content && !d.attachment_ids.length)
        throw new ApiError(422, 'Envie uma mensagem ou anexo.');
      if (d.attachment_ids.length) {
        const {
          rows: [count],
        } = await c.query(
          'SELECT count(*)::int AS count FROM sandbox_attachments WHERE tenant_id=$1 AND conversation_id=$2 AND id=ANY($3::uuid[])',
          [ctx.tenantId, id, d.attachment_ids],
        );
        if (count.count !== new Set(d.attachment_ids).size)
          throw new ApiError(422, 'Anexo inválido para esta conversa.');
      }
      const {
        rows: [msg],
      } = await c.query(
        "INSERT INTO messages(tenant_id,conversation_id,direction,content,created_by,request_id) VALUES($1,$2,'INBOUND',$3,$4,$5) RETURNING id",
        [
          ctx.tenantId,
          id,
          d.content || 'Analise os documentos anexados para organizar o atendimento.',
          ctx.userId,
          d.request_id,
        ],
      );
      inputId = msg.id;
      for (const attachmentId of d.attachment_ids)
        await c.query(
          'INSERT INTO message_attachments(tenant_id,message_id,attachment_id) VALUES($1,$2,$3)',
          [ctx.tenantId, msg.id, attachmentId],
        );
    }
    const {
      rows: [run],
    } = await c.query(
      'INSERT INTO agent_runs(tenant_id,unit_id,conversation_id,input_message_id,requested_by,provider,model,agent_snapshot,automation_epoch) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id,status',
      [
        ctx.tenantId,
        conv.unit_id,
        id,
        inputId,
        ctx.userId,
        config.provider,
        config.model,
        JSON.stringify({ selected, profiles }),
        conv.automation_epoch,
      ],
    );
    await c.query(
      'INSERT INTO sandbox_requests(tenant_id,conversation_id,request_id,run_id) VALUES($1,$2,$3,$4)',
      [ctx.tenantId, id, d.request_id, run.id],
    );
    await audit(c, ctx, 'sandbox.run_queued', 'conversations', id, conv.unit_id, {
      runId: run.id,
      provider: config.provider,
      model: config.model,
    });
    return { run, conv, inputId, selected };
  });
  if ('idempotent' in queued) return queued;
  if (brainEnabled()) {
    // O brain recebe a mensagem (e os anexos) depois do commit, para enxergar a execução pendente.
    const [input] = await query('SELECT content FROM messages WHERE tenant_id=$1 AND id=$2', [
      ctx.tenantId,
      queued.inputId,
    ]);
    const attachmentIds = (
      await query(
        'SELECT attachment_id FROM message_attachments WHERE tenant_id=$1 AND message_id=$2',
        [ctx.tenantId, queued.inputId],
      )
    ).map((r) => r.attachment_id as string);
    await sendToBrain(
      ctx,
      queued.conv,
      queued.run.id,
      input.content,
      attachmentIds,
      queued.selected.specialty,
    );
  }
  return queued.run;
}
export async function controlSandbox(ctx: Context, id: string, input: unknown) {
  const d = z
    .object({
      action: z.enum(['takeover', 'resume', 'reset']),
      version: z.number().int().positive(),
    })
    .strict()
    .parse(input);
  return transaction(async (c) => {
    const conv = await sandboxConversation(c, ctx, id, true);
    if (conv.version !== d.version)
      throw new ApiError(409, 'A conversa mudou. Atualize antes de continuar.');
    const ai = d.action !== 'takeover';
    await c.query(
      "UPDATE agent_runs SET status='CANCELLED',finished_at=now(),error_message='Execução interrompida por mudança de controle.' WHERE tenant_id=$1 AND conversation_id=$2 AND status IN('QUEUED','RUNNING')",
      [ctx.tenantId, id],
    );
    const {
      rows: [row],
    } = await c.query(
      "UPDATE conversations SET ai_mode=$3,automation_epoch=automation_epoch+1,version=version+1,status=$4,context_started_at=CASE WHEN $5 THEN now() ELSE context_started_at END,summary=CASE WHEN $5 THEN '' ELSE summary END,queue_id=CASE WHEN $3='AI' THEN NULL ELSE queue_id END,assigned_to=CASE WHEN $3='AI' THEN NULL ELSE assigned_to END,assigned_user_id=CASE WHEN $3='AI' THEN NULL ELSE assigned_user_id END WHERE tenant_id=$1 AND id=$2 RETURNING id,version,ai_mode",
      [ctx.tenantId, id, ai ? 'AI' : 'HUMAN', ai ? 'WAITING' : 'HUMAN', d.action === 'reset'],
    );
    await c.query(
      "INSERT INTO messages(tenant_id,conversation_id,direction,content,created_by) VALUES($1,$2,'SYSTEM',$3,$4)",
      [
        ctx.tenantId,
        id,
        d.action === 'reset'
          ? 'Novo contexto de teste iniciado. Histórico anterior preservado.'
          : ai
            ? 'Atendimento devolvido à IA.'
            : 'Equipe assumiu o atendimento. IA pausada.',
        ctx.userId,
      ],
    );
    await audit(c, ctx, 'sandbox.' + d.action, 'conversations', id, conv.unit_id);
    return row;
  }).then(async (row) => {
    if (d.action === 'takeover') await brainTakeOver(id, ctx.name);
    else {
      await brainGiveBack(id);
      if (d.action === 'reset') await brainReset(id);
    }
    return row;
  });
}

export async function deleteSandbox(ctx: Context, id: string) {
  return transaction(async (c) => {
    const conv = await sandboxConversation(c, ctx, id, true);
    await c.query(
      "UPDATE agent_runs SET status='CANCELLED',finished_at=now(),error_message='Conversa excluída.' WHERE tenant_id=$1 AND conversation_id=$2 AND status IN('QUEUED','RUNNING')",
      [ctx.tenantId, id],
    );
    await c.query(
      "UPDATE conversations SET deleted_at=now(),ai_mode='HUMAN',automation_epoch=automation_epoch+1,version=version+1 WHERE tenant_id=$1 AND id=$2",
      [ctx.tenantId, id],
    );
    await audit(c, ctx, 'sandbox.deleted', 'conversations', id, conv.unit_id);
    return { deleted: true };
  }).then(async (r) => {
    await brainClose(id, 'Sessão excluída na Integrar.');
    return r;
  });
}
