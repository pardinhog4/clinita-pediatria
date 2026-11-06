import 'dotenv/config';
import { chromium } from '@playwright/test';
import { pool, query } from '../src/lib/db';
// Teste real (com custo no provedor de IA) de uma conversa do Sandbox com laudo FICTÍCIO.
// Pré-requisitos: servidor em http://localhost:3005, worker em execução, chave de IA e
// SMOKE_EMAIL/SMOKE_PASSWORD (conta de gestão) no .env.
// Uso: npx tsx scripts/live-report-smoke.ts
const base = process.env.APP_ORIGIN || 'http://localhost:3005';
const turns = [
  {
    text: 'Oi, boa tarde! Recebi esse laudo da neuro do meu filho e queria saber se vocês conseguem atender ele.',
    file: 'tests/fixtures/laudo-sintetico-tea.pdf',
  },
  {
    text: 'Ele tem 4 anos. É pelo Bradesco Saúde. Prefiro a Filial 01, de manhã, de segunda a sexta.',
  },
];
async function waitRun(since: Date) {
  for (let i = 0; i < 90; i++) {
    const [run] = await query(
      'SELECT id,status,decision,trace,error_message,input_tokens,output_tokens FROM agent_runs WHERE created_at>$1 ORDER BY created_at DESC LIMIT 1',
      [since],
    );
    if (run && ['COMPLETED', 'FAILED', 'CANCELLED'].includes(run.status)) return run;
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error('A IA não respondeu em 3 minutos. O worker está rodando?');
}
async function main() {
  if (!process.env.OPENAI_API_KEY && !process.env.GEMINI_API_KEY) {
    console.log('Sem chave de IA: teste não executado.');
    return;
  }
  const browser = await chromium.launch({
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: true,
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  try {
    await page.goto(base + '/login');
    // Entra com uma conta de gestão (SMOKE_EMAIL e SMOKE_PASSWORD no .env).
    await page.getByLabel('E-mail').fill(process.env.SMOKE_EMAIL || '');
    await page.getByLabel('Senha', { exact: true }).fill(process.env.SMOKE_PASSWORD || '');
    await page.getByRole('button', { name: 'Entrar' }).click();
    await page.waitForURL('**/inicio');
    await page.goto(base + '/atendimento#sandbox');
    await page.getByRole('button', { name: 'Nova sessão de teste' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('checkbox', { name: /Usarei dados fictícios/ }).check();
    await dialog.getByRole('button', { name: 'Criar sessão', exact: true }).click();
    await dialog.waitFor({ state: 'hidden' });
    for (const [i, turn] of turns.entries()) {
      const since = new Date(Date.now() - 1000);
      if (turn.file) await page.locator('#sandbox-file').setInputFiles(turn.file);
      await page.getByLabel('Mensagem da simulação').fill(turn.text);
      await page.getByRole('button', { name: 'Enviar para IA', exact: true }).click();
      const run = await waitRun(since);
      console.log(
        `\n══ Turno ${i + 1} · família: ${turn.text}${turn.file ? ' [+ laudo fictício]' : ''}`,
      );
      if (run.status !== 'COMPLETED') {
        console.log('Falhou:', run.status, run.error_message);
        break;
      }
      const tools = (run.trace as any[])
        .filter((e) => e.kind === 'tool')
        .map((e) => e.title + ' ' + JSON.stringify(e.data?.arguments ?? {}).slice(0, 260));
      console.log('Ferramentas usadas:\n  ' + (tools.length ? tools.join('\n  ') : '(nenhuma)'));
      const d = run.decision;
      console.log('Resposta à família:\n  ' + d.reply.replace(/\n/g, '\n  '));
      console.log(`Decisão: ${d.next_action} → ${d.destination} · confiança ${d.confidence}`);
      console.log('Resumo para a equipe:\n  ' + d.summary.replace(/\n/g, '\n  '));
      if (d.professional_ids?.length) {
        const names = await query(
          'SELECT name,specialty FROM professionals WHERE id=ANY($1::uuid[])',
          [d.professional_ids],
        );
        console.log(
          'Profissionais sugeridos: ' +
            names.map((n) => n.name + ' (' + n.specialty + ')').join(', '),
        );
      }
      if (d.missing_information?.length)
        console.log('Pendências: ' + d.missing_information.join(' | '));
      console.log(`Tokens: ${run.input_tokens} entrada / ${run.output_tokens} saída`);
      const items = await query(
        'SELECT i.position,i.service_text,i.match_status,i.route,p.name AS professional,i.warnings FROM referral_items i JOIN referral_plans rp ON rp.id=i.plan_id LEFT JOIN professionals p ON p.id=i.professional_id WHERE rp.agent_run_id=$1 ORDER BY i.position',
        [run.id],
      );
      if (items.length)
        console.log(
          'Plano de encaminhamento salvo:\n  ' +
            items
              .map(
                (i) =>
                  `${i.position}. ${i.service_text.slice(0, 70)} → ${i.professional || (i.match_status === 'NOT_OFFERED' ? 'não oferecido' : 'coordenação clínica')}${i.warnings.length ? ' ⚠ ' + i.warnings.join('; ') : ''}`,
              )
              .join('\n  '),
        );
      await page.waitForTimeout(1500);
    }
    await page.screenshot({ path: 'artifacts/sandbox-laudo-sintetico.png', fullPage: true });
  } finally {
    await browser.close();
    await pool.end();
  }
}
main().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
