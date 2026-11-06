import 'dotenv/config';
import { pool, query } from '../src/lib/db';
import { brainConfig } from '../src/server/brain/client';
import { syncTenantToBrain } from '../src/server/brain/sync';

// Sincroniza a clínica com o brain-desk (filas, agentes, cenários, ferramentas e webhook).
//   npm run brain:sync
// Antes: AI_ENGINE=brain e BRAIN_* no .env; brain-desk e esta aplicação no ar (para o teste das ferramentas).

async function main() {
  const cfg = brainConfig();
  if (!cfg.configured)
    throw new Error(
      'Defina AI_ENGINE=brain, BRAIN_API_KEY, BRAIN_TOOLS_SECRET e BRAIN_WEBHOOK_SECRET no .env.',
    );
  const tenants = await query('SELECT id,name FROM tenants WHERE demo_admin_user_id IS NULL');
  if (tenants.length !== 1)
    throw new Error(
      `Esperava 1 clínica real no banco, encontrei ${tenants.length}. A chave do brain identifica uma clínica.`,
    );
  const r = await syncTenantToBrain(tenants[0].id);
  console.log(
    `${tenants[0].name}: ${r.filas} filas · ${r.agentes} agentes · ${r.cenarios} cenários enviados ao brain.`,
  );
  console.log(
    r.ferramentas.ok
      ? `Ferramentas da clínica vistas pelo brain: ${r.ferramentas.ferramentas.map((f: any) => f.nome).join(', ')}`
      : `O brain não conseguiu listar as ferramentas (${r.ferramentas.erro}). Suba a aplicação (npm run dev) e rode de novo.`,
  );
}

main()
  .catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
