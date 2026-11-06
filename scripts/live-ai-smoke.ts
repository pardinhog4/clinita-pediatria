import 'dotenv/config';
import { PDFDocument } from 'pdf-lib';
import { aiConfiguration } from '../src/server/ai/providers';
async function main() {
  const config = aiConfiguration();
  if (!config.configured) {
    console.log('NÃO EXECUTADO: configure a chave de IA no .env para validar uma chamada real.');
    return;
  }
  const base = process.env.APP_ORIGIN || 'http://localhost:3005';
  const boot = await fetch(base + '/api/auth/session', {
    method: 'POST',
    headers: { Origin: base },
  });
  if (!boot.ok) throw Error('Não foi possível abrir a sessão local de teste.');
  const session = await boot.json();
  let cookie = boot.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ');
  const headers = { Origin: base, Cookie: cookie, 'x-csrf-token': session.csrfToken };
  async function request(path: string, data?: unknown) {
    const r = await fetch(base + '/api/' + path, {
      method: data ? 'POST' : 'GET',
      headers: { ...headers, ...(data ? { 'Content-Type': 'application/json' } : {}) },
      body: data ? JSON.stringify(data) : undefined,
    });
    const body = await r.json();
    if (!r.ok) throw Error(body.error || 'Falha na requisição de teste.');
    return body;
  }
  const meta = await request('meta');
  const unit = meta.units[0].id;
  const settings = await request('sandbox?unit=' + unit);
  if (!settings.configuration.worker_online) throw Error('Inicie o worker antes do teste real.');
  const conversation = await request('sandbox', {
    unit_id: unit,
    consent: true,
    include_clinical_context: false,
  });
  const greeting = await request('sandbox/' + conversation.id + '/messages', {
    request_id: crypto.randomUUID(),
    content: 'Olá, bom dia!',
  });
  const greetingDeadline = Date.now() + 120000;
  let greetingCompleted = false;
  while (Date.now() < greetingDeadline) {
    const detail = await request('sandbox/' + conversation.id);
    const result = detail.runs.find((r: any) => r.id === greeting.id);
    if (result?.status === 'COMPLETED') {
      if (detail.ai_mode !== 'AI')
        throw Error('BUG: saudação encaminhada prematuramente para atendimento humano.');
      greetingCompleted = true;
      console.log('Primeiro turno real concluído. Validando continuação com histórico e PDF.');
      break;
    }
    if (result && ['FAILED', 'CANCELLED'].includes(result.status))
      throw Error(result.error_message || 'Saudação interrompida.');
    await new Promise((r) => setTimeout(r, 1500));
  }
  if (!greetingCompleted) throw Error('Tempo de espera da saudação excedido.');
  const pdf = await PDFDocument.create();
  pdf
    .addPage()
    .drawText(
      'DOCUMENTO FICTICIO DE TESTE. Pedido: Fonoaudiologia. Idade informada: 6 anos. Metodo solicitado: PROMPT.',
      { x: 35, y: 700, size: 11, maxWidth: 500 },
    );
  const form = new FormData();
  form.set(
    'file',
    new File([new Uint8Array(await pdf.save())], 'pedido-ficticio-sandbox.pdf', {
      type: 'application/pdf',
    }),
  );
  const uploaded = await fetch(base + '/api/sandbox/' + conversation.id + '/attachments', {
    method: 'POST',
    headers,
    body: form,
  });
  const attachment = await uploaded.json();
  if (!uploaded.ok) throw Error(attachment.error);
  const run = await request('sandbox/' + conversation.id + '/messages', {
    request_id: crypto.randomUUID(),
    content:
      'Este é um teste com dados fictícios. Minha criança tem 6 anos e precisa de fonoaudiologia com PROMPT, conforme pedido em PDF. Consulte os profissionais cadastrados desta unidade e informe quem pode ser considerado, sem reservar ou confirmar uma sessão. Se precisar da equipe, encaminhe com resumo.',
    attachment_ids: [attachment.id],
  });
  const deadline = Date.now() + 120000;
  while (Date.now() < deadline) {
    const detail = await request('sandbox/' + conversation.id);
    const result = detail.runs.find((r: any) => r.id === run.id);
    if (result?.status === 'COMPLETED') {
      if (/\bprompt\b|pedido-ficticio-sandbox\.pdf/i.test(result.decision.reply))
        throw Error('A resposta à família repetiu detalhes técnicos do documento.');
      console.log(
        JSON.stringify(
          {
            status: 'CHAMADA REAL CONCLUÍDA',
            provider: result.provider,
            model: result.model,
            tools: result.trace.filter((t: any) => t.kind === 'tool').map((t: any) => t.title),
            inputTokens: result.input_tokens,
            outputTokens: result.output_tokens,
            sessionUrl: base + '/atendimento#sandbox',
          },
          null,
          2,
        ),
      );
      return;
    }
    if (result && ['FAILED', 'CANCELLED'].includes(result.status))
      throw Error(result.error_message || 'Análise interrompida.');
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw Error('Tempo de espera excedido; confira a sessão no Sandbox.');
}
main().catch((e) => {
  console.error(e instanceof Error ? e.message : 'Erro no teste real.');
  process.exitCode = 1;
});
