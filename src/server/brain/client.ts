import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { ApiError } from '@/lib/errors';

// Ligação com o brain-desk (motor de atendimento por IA separado).
// AI_ENGINE=brain liga; BRAIN_URL/BRAIN_API_KEY identificam a clínica no brain;
// BRAIN_TOOLS_SECRET protege as ferramentas que a Integrar expõe; BRAIN_WEBHOOK_SECRET confere os eventos.

export function brainConfig() {
  const enabled = process.env.AI_ENGINE === 'brain';
  return {
    enabled,
    url: process.env.BRAIN_URL?.trim() || 'http://127.0.0.1:4100/mcp',
    apiKey: process.env.BRAIN_API_KEY?.trim() || '',
    toolsSecret: process.env.BRAIN_TOOLS_SECRET?.trim() || '',
    webhookSecret: process.env.BRAIN_WEBHOOK_SECRET?.trim() || '',
    configured:
      enabled &&
      !!process.env.BRAIN_API_KEY?.trim() &&
      !!process.env.BRAIN_TOOLS_SECRET?.trim() &&
      !!process.env.BRAIN_WEBHOOK_SECRET?.trim(),
  };
}

export const brainEnabled = () => brainConfig().enabled;

/** Referência da conversa da Integrar dentro do brain. */
export const brainRef = (conversationId: string) => 'integrar:' + conversationId;

let cached: { key: string; client: Client } | null = null;
async function connection() {
  const cfg = brainConfig();
  if (!cfg.configured)
    throw new ApiError(503, 'Configure BRAIN_API_KEY, BRAIN_TOOLS_SECRET e BRAIN_WEBHOOK_SECRET.');
  const key = cfg.url + '|' + cfg.apiKey;
  if (cached?.key === key) return cached.client;
  const client = new Client({ name: 'integrar', version: '1.0.0' });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(cfg.url), {
      requestInit: { headers: { Authorization: 'Bearer ' + cfg.apiKey } },
    }),
  );
  cached = { key, client };
  return client;
}

/** Chama uma ferramenta do brain. Erros do brain viram ApiError com a mensagem dele. */
export async function brain<T = any>(name: string, args: Record<string, unknown> = {}): Promise<T> {
  let r: any;
  try {
    r = await (
      await connection()
    ).callTool({ name, arguments: args }, undefined, {
      timeout: 150000,
    });
  } catch (e) {
    cached = null;
    if (e instanceof ApiError) throw e;
    throw new ApiError(503, 'O brain-desk não respondeu: ' + (e as Error).message.slice(0, 200));
  }
  if (r.isError) {
    const text = r.content?.[0]?.text || 'Erro no brain-desk.';
    throw new ApiError(/não encontrad/i.test(text) ? 404 : 422, text);
  }
  return (r.structuredContent?.resultado ?? r.structuredContent) as T;
}

/** Chama o brain sem derrubar a operação da clínica se ele estiver fora (ações de equipe). */
export async function brainQuiet(name: string, args: Record<string, unknown> = {}) {
  if (!brainEnabled()) return null;
  try {
    return await brain(name, args);
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) return null;
    console.error('[brain]', name, (e as Error).message);
    return null;
  }
}

let healthAt = 0,
  healthOk = false;
export async function brainOnline() {
  if (Date.now() - healthAt < 15000) return healthOk;
  healthAt = Date.now();
  try {
    const r = await fetch(brainConfig().url.replace(/\/mcp$/, '/health'), {
      signal: AbortSignal.timeout(3000),
    });
    healthOk = r.ok;
  } catch {
    healthOk = false;
  }
  return healthOk;
}
