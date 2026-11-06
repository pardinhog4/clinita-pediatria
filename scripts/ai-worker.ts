import 'dotenv/config';
import { config } from 'dotenv';
import { randomUUID } from 'node:crypto';
import { prepareDueContacts } from '../src/server/automations';
import { deliverPending } from '../src/server/mail';
import { claimRun, processRun } from '../src/server/ai/runner';
import { query, pool } from '../src/lib/db';
const workerId = randomUUID();
let stopping = false,
  lastAutomation = 0;
process.on('SIGINT', () => {
  stopping = true;
});
process.on('SIGTERM', () => {
  stopping = true;
});
async function main() {
  console.log('Worker de IA iniciado. Aguardando execuções do Sandbox.');
  while (!stopping) {
    try {
      config({ override: true, quiet: true });
      if (Date.now() - lastAutomation > 60000) {
        await prepareDueContacts();
        // E-mails pendentes ou com falha temporária (SMTP fora do ar etc.).
        await deliverPending();
        lastAutomation = Date.now();
      }
      await query(
        'INSERT INTO worker_heartbeats(id,last_seen) VALUES($1,now()) ON CONFLICT(id) DO UPDATE SET last_seen=now()',
        [workerId],
      );
      const job = await claimRun();
      if (job) {
        const heartbeat = setInterval(() => {
          void query('UPDATE worker_heartbeats SET last_seen=now() WHERE id=$1', [workerId]).catch(
            () => {},
          );
        }, 10000);
        try {
          await processRun(job);
        } finally {
          clearInterval(heartbeat);
        }
      } else await new Promise((r) => setTimeout(r, 1000));
    } catch (e) {
      console.error(
        'Worker temporariamente indisponível:',
        e instanceof Error ? e.message : 'erro',
      );
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
  await query('DELETE FROM worker_heartbeats WHERE id=$1', [workerId]);
  await pool.end();
}
main().catch(() => {
  console.error('Não foi possível iniciar o worker.');
  process.exitCode = 1;
});
