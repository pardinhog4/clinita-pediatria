import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from '@playwright/test';
// Gera os PDFs da documentação da IA a partir dos HTMLs em docs/.
// Uso: npx tsx scripts/build-ai-doc.ts            (todos)
//      npx tsx scripts/build-ai-doc.ts cenarios   (só um)
const docs: Record<string, { src: string; out: string; footer: string }> = {
  triagem: {
    src: 'docs/ia-triagem/ia-triagem-backend.html',
    out: 'docs/IA-triagem-backend.pdf',
    footer: 'Integrar · IA de triagem no WhatsApp · backend',
  },
  cenarios: {
    src: 'docs/ia-cenarios/ia-cenarios.html',
    out: 'docs/IA-cenarios.pdf',
    footer: 'Integrar · Cenários da IA · fluxogramas',
  },
};
async function main() {
  const pick = process.argv[2],
    list = pick ? [docs[pick]].filter(Boolean) : Object.values(docs);
  if (!list.length) throw new Error('Documento desconhecido: ' + pick);
  const browser = await chromium.launch({
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: true,
  });
  try {
    for (const d of list) {
      const page = await browser.newPage();
      await page.goto(pathToFileURL(path.resolve(d.src)).href, { waitUntil: 'load' });
      await page.pdf({
        path: path.resolve(d.out),
        format: 'A4',
        printBackground: true,
        preferCSSPageSize: true,
        displayHeaderFooter: true,
        headerTemplate: '<span></span>',
        footerTemplate: `<div style="width:100%;font:8px Segoe UI,sans-serif;color:#8e8e93;padding:0 18mm;display:flex;justify-content:space-between"><span>${d.footer}</span><span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>`,
      });
      await page.close();
      console.log('PDF gerado em', path.resolve(d.out));
    }
  } finally {
    await browser.close();
  }
}
main().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
