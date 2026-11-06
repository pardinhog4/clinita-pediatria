import { ApiError } from '@/lib/errors';
import type { Provider, ProviderInput, ProviderTurn } from './contracts';
import { brainConfig } from '@/server/brain/client';
export function aiConfiguration() {
  if (process.env.AI_ENGINE === 'brain')
    return { provider: 'brain', model: 'brain', configured: brainConfig().configured, key: '' };
  const provider = process.env.AI_PROVIDER === 'gemini' ? 'gemini' : 'openai';
  const key = process.env[provider === 'openai' ? 'OPENAI_API_KEY' : 'GEMINI_API_KEY']?.trim();
  const model =
    process.env[provider === 'openai' ? 'OPENAI_MODEL' : 'GEMINI_MODEL']?.trim() ||
    (provider === 'openai' ? 'gpt-5-mini' : '');
  return { provider, model, configured: !!key && !!model, key };
}
async function remote(
  url: string,
  key: string,
  body: unknown,
  signal: AbortSignal,
  google = false,
) {
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(google ? { 'x-goog-api-key': key } : { Authorization: 'Bearer ' + key }),
      },
      body: JSON.stringify(body),
      signal,
    });
  } catch (e) {
    if (signal.aborted)
      throw new ApiError(
        504,
        'O provedor demorou além do limite. Tente novamente ou assuma o atendimento.',
      );
    throw new ApiError(502, 'Não foi possível conectar ao provedor de IA.');
  }
  if (!response.ok) {
    if (response.status === 401 || response.status === 403)
      throw new ApiError(
        503,
        'A chave de IA não foi aceita ou não tem acesso ao modelo configurado.',
      );
    if (response.status === 429)
      throw new ApiError(
        429,
        'Limite ou saldo do provedor de IA indisponível. Confira a conta do provedor.',
      );
    throw new ApiError(
      502,
      'O provedor não concluiu a análise. Confira o modelo e os formatos suportados.',
    );
  }
  return response.json();
}
export function createProvider(provider: string, model: string, key: string): Provider {
  if (provider === 'openai')
    return {
      async turn(i: ProviderInput) {
        const input = i.history.length
          ? i.history
          : i.messages.map((m) => ({
              role: m.role,
              content: [
                { type: m.role === 'assistant' ? 'output_text' : 'input_text', text: m.text },
                ...(m.role === 'user' ? m.files || [] : []).map((f) =>
                  f.mime === 'application/pdf'
                    ? {
                        type: 'input_file',
                        filename: f.name,
                        file_data: 'data:application/pdf;base64,' + f.base64,
                      }
                    : {
                        type: 'input_image',
                        image_url: 'data:' + f.mime + ';base64,' + f.base64,
                        detail: 'auto',
                      },
                ),
              ],
            }));
        const raw = await remote(
          'https://api.openai.com/v1/responses',
          key,
          {
            model,
            store: false,
            include: ['reasoning.encrypted_content'],
            instructions: i.instructions,
            input,
            tools: i.tools.map((t) => ({
              type: 'function',
              name: t.name,
              description: t.description,
              parameters: t.schema,
              strict: true,
            })),
            tool_choice: i.finalOnly
              ? { type: 'function', name: 'finalizar_atendimento' }
              : 'required',
            parallel_tool_calls: false,
            max_output_tokens: 6000,
            ...(model.startsWith('gpt-5') ? { reasoning: { effort: 'low' } } : {}),
          },
          i.signal,
        );
        const calls = (raw.output || [])
          .filter((o: any) => o.type === 'function_call')
          .map((o: any) => {
            let args;
            try {
              args = JSON.parse(o.arguments);
            } catch {
              throw new ApiError(502, 'A IA retornou argumentos inválidos.');
            }
            return { id: o.call_id, name: o.name, arguments: args };
          });
        return {
          raw: { input, output: raw.output || [] },
          calls,
          inputTokens: raw.usage?.input_tokens || 0,
          outputTokens: raw.usage?.output_tokens || 0,
        };
      },
      continueHistory(_history, turn, outputs) {
        const raw = turn.raw as any;
        return [
          ...raw.input,
          ...raw.output,
          ...outputs.map((o) => ({
            type: 'function_call_output',
            call_id: o.call.id,
            output: JSON.stringify(o.result),
          })),
        ];
      },
    };
  if (provider === 'gemini')
    return {
      async turn(i: ProviderInput) {
        const contents = i.history.length
          ? i.history
          : i.messages.map((m) => ({
              role: m.role === 'assistant' ? 'model' : 'user',
              parts: [
                { text: m.text },
                ...(m.files || []).flatMap((f) => [
                  { text: 'Anexo ' + f.id + ' · ' + f.name },
                  { inlineData: { mimeType: f.mime, data: f.base64 } },
                ]),
              ],
            }));
        const raw = await remote(
          'https://generativelanguage.googleapis.com/v1beta/models/' +
            encodeURIComponent(model) +
            ':generateContent',
          key,
          {
            systemInstruction: { parts: [{ text: i.instructions }] },
            contents,
            tools: [
              {
                functionDeclarations: i.tools.map((t) => ({
                  name: t.name,
                  description: t.description,
                  parametersJsonSchema: t.schema,
                })),
              },
            ],
            toolConfig: {
              functionCallingConfig: {
                mode: 'ANY',
                ...(i.finalOnly ? { allowedFunctionNames: ['finalizar_atendimento'] } : {}),
              },
            },
            generationConfig: { maxOutputTokens: 6000 },
          },
          i.signal,
          true,
        );
        const content = raw.candidates?.[0]?.content;
        if (!content) throw new ApiError(502, 'O modelo não retornou uma decisão.');
        return {
          raw: { contents, content },
          calls: content.parts
            .filter((p: any) => p.functionCall)
            .map((p: any, index: number) => ({
              id: p.functionCall.id || String(index),
              name: p.functionCall.name,
              arguments: p.functionCall.args,
            })),
          inputTokens: raw.usageMetadata?.promptTokenCount || 0,
          outputTokens: raw.usageMetadata?.candidatesTokenCount || 0,
        };
      },
      continueHistory(_history, turn, outputs) {
        const raw = turn.raw as any;
        return [
          ...raw.contents,
          raw.content,
          {
            role: 'user',
            parts: outputs.map((o) => ({
              functionResponse: { name: o.call.name, response: { result: o.result } },
            })),
          },
        ];
      },
    };
  throw new ApiError(503, 'Provedor de IA não configurado.');
}
