import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { pool, query } from '../src/lib/db';
import type { Context } from '../src/lib/security';
import { brainConfig } from '../src/server/brain/client';
import { createSandbox, deleteSandbox, enqueueSandbox, sandboxDetail } from '../src/server/sandbox';

// Teste real do motor brain-desk pela Integrar: abre uma sessão de Sandbox (dados fictícios),
// manda mensagens, espera o webhook do brain fechar cada execução e apaga a sessão no fim.
//   npm run brain:live            (precisa de: brain-desk no ar, esta aplicação no ar em APP_ORIGIN, brain:sync feito)

async function main() {
  if (!brainConfig().configured)
    throw new Error('AI_ENGINE=brain e BRAIN_* precisam estar no .env.');
  const [m] = await query(
    "SELECT m.tenant_id,m.user_id,m.unit_ids,u.name FROM memberships m JOIN users u ON u.id=m.user_id JOIN tenants t ON t.id=m.tenant_id WHERE t.demo_admin_user_id IS NULL AND m.active AND m.role='ADMIN' ORDER BY m.created_at LIMIT 1",
  );
  if (!m) throw new Error('Nenhuma direção ativa na clínica.');
  const ctx: Context = {
    tenantId: m.tenant_id,
    userId: m.user_id,
    unitIds: m.unit_ids,
    name: m.name,
    role: 'ADMIN',
    sessionId: randomUUID(),
  };
  const conv = await createSandbox(ctx, { unit_id: m.unit_ids[0], consent: true });
  console.log('Sessão Sandbox', conv.id);
  try {
    for (const content of process.argv.slice(2).length
      ? process.argv.slice(2)
      : [
          'Oi, bom dia!',
          'Tenho um pedido de fono e TO para meu filho. Vocês atendem?',
          'Quero falar com uma pessoa.',
        ]) {
      const run = await enqueueSandbox(ctx, conv.id, { request_id: randomUUID(), content });
      const until = Date.now() + 150000;
      let r: any;
      while (Date.now() < until) {
        const d = await sandboxDetail(ctx, conv.id);
        r = d.runs.find((x: any) => x.id === run.id);
        if (!['QUEUED', 'RUNNING'].includes(r.status)) {
          console.log(
            `\n> ${content}\n< [${r.status}${r.decision ? ' · ' + r.decision.next_action + ' → ' + r.decision.destination : ''}] ${r.decision?.reply || r.error_message}`,
          );
          if (r.trace?.length)
            console.log(
              '  ferramentas:',
              r.trace
                .filter((t: any) => t.kind === 'tool')
                .map((t: any) => t.title)
                .join(', ') || 'nenhuma',
            );
          if (d.ai_mode === 'HUMAN') console.log(`  conversa com a equipe (fila ${d.queue_name})`);
          break;
        }
        await new Promise((x) => setTimeout(x, 1500));
      }
      if (['QUEUED', 'RUNNING'].includes(r?.status))
        console.log('tempo esgotado esperando o brain');
      const d = await sandboxDetail(ctx, conv.id);
      if (d.ai_mode === 'HUMAN') break;
    }
  } finally {
    await deleteSandbox(ctx, conv.id);
    console.log('\nSessão de teste excluída.');
  }
}

main()
  .catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
