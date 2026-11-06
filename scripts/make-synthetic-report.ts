import fs from 'node:fs';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
// Gera um laudo FICTÍCIO com a mesma estrutura de um laudo real de equipe multidisciplinar (TEA).
// Nomes, CPF, CRM e endereço são inventados. Uso exclusivo no Sandbox e nos testes.
const out = process.argv[2] || 'tests/fixtures/laudo-sintetico-tea.pdf';
const paragraphs: [string, 'title' | 'bold' | 'text' | 'item' | 'gap'][] = [
  ['Dra. Helena Vasconcelos Prado', 'bold'],
  ['Neurologia Pediátrica', 'text'],
  ['CRM-AM 00000 - RQE 0000 (fictício)', 'text'],
  ['Telefone: (92) 90000-0000 - Av. Exemplo, 100, Sala 1 - Manaus - AM', 'text'],
  ['', 'gap'],
  ['Paciente: Lucas Gabriel Andrade Sintético', 'bold'],
  ['CPF: 000.000.000-00', 'text'],
  ['', 'gap'],
  ['LAUDO MÉDICO', 'title'],
  ['', 'gap'],
  [
    'Atesto que Lucas Gabriel apresenta prejuízo persistente na comunicação social recíproca, além de padrões restritos e repetitivos de comportamento, interesses e atividades, recebendo o diagnóstico de Transtorno do Espectro Autista com comprometimento da linguagem concomitante, segundo os critérios do DSM-5. Condição crônica e permanente.',
    'text',
  ],
  [
    'A criança apresenta prejuízo motor por hipotonia muscular, com dificuldade para subir e descer escadas, chutar bola, correr e pular. Ainda não adquiriu a fala, mas evolui na intenção comunicativa e no compartilhar de interesses. Vem ampliando o repertório alimentar e a textura dos alimentos.',
    'text',
  ],
  [
    'Necessita de acompanhamento com equipe interdisciplinar, com início imediato e por tempo indeterminado:',
    'text',
  ],
  [
    '- Fonoaudiólogo especialista em TEA, desenvolvimento infantil, PROMPT e Comunicação Aumentativa e Alternativa: 5 horas semanais, com ênfase em reabilitação motora oral e terapia alimentar;',
    'item',
  ],
  [
    '- Supervisão fonoaudiológica especialista em Comunicação Alternativa: 1 hora por semana;',
    'item',
  ],
  [
    '- Psicólogo infantil especialista em TEA, desenvolvimento infantil e Denver: 2 vezes por semana (1 hora cada sessão);',
    'item',
  ],
  [
    '- Terapia Ocupacional especialista em TEA, Integração Sensorial de Ayres e seletividade alimentar: 4 vezes por semana (1 hora cada sessão);',
    'item',
  ],
  [
    '- Fisioterapeuta infantil motora especialista em TEA: 4 vezes por semana (1 hora cada sessão);',
    'item',
  ],
  [
    '- Assistente terapêutico para aplicação do Denver em domicílio: 5 vezes por semana, 4 horas por dia;',
    'item',
  ],
  [
    '- Supervisão semanal por especialista em Denver para o assistente terapêutico: 1 hora por semana;',
    'item',
  ],
  [
    '- Neuropsicopedagoga especialista em ABA, transtornos de aprendizagem e educação inclusiva: 4 vezes por semana (1 hora cada sessão);',
    'item',
  ],
  ['- Neurologista pediátrico: trimestral ou conforme necessidade;', 'item'],
  ['- Fonoaudiologia especialista em motricidade orofacial: 4 horas por semana;', 'item'],
  ['- Psicomotricidade com psicomotricista: 3 vezes por semana (1 hora cada sessão);', 'item'],
  ['- Equoterapia: 2 vezes por semana (1 hora cada sessão).', 'item'],
  ['', 'gap'],
  [
    'Reforço a importância de manter os profissionais que já acompanham a criança, preservando o vínculo terapêutico, e a necessidade da terapia com assistente terapêutico no domicílio.',
    'text',
  ],
  ['', 'gap'],
  ['CID: F84.0 | F80.8', 'bold'],
  ['', 'gap'],
  ['Manaus, 09 de agosto de 2026.', 'text'],
  ['', 'gap'],
  ['Dra. Helena Vasconcelos Prado - Neuropediatra (assinatura fictícia)', 'text'],
];
async function main() {
  const pdf = await PDFDocument.create();
  pdf.setTitle('Laudo médico fictício para teste');
  pdf.setAuthor('Integrar Sandbox');
  const font = await pdf.embedFont(StandardFonts.Helvetica),
    bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const page = pdf.addPage([595, 842]);
  const margin = 56,
    width = 595 - margin * 2;
  let y = 842 - margin;
  const draw = (text: string, f = font, size = 10.5, x = margin, max = width) => {
    const words = text.split(' ');
    let line = '';
    for (const w of words) {
      const next = line ? line + ' ' + w : w;
      if (f.widthOfTextAtSize(next, size) > max) {
        page.drawText(line, { x, y, size, font: f });
        y -= size * 1.45;
        line = w;
      } else line = next;
    }
    if (line) {
      page.drawText(line, { x, y, size, font: f });
      y -= size * 1.45;
    }
  };
  for (const [text, kind] of paragraphs) {
    if (kind === 'gap') {
      y -= 8;
      continue;
    }
    if (kind === 'title') {
      const w = bold.widthOfTextAtSize(text, 13);
      page.drawText(text, { x: (595 - w) / 2, y, size: 13, font: bold });
      y -= 20;
      continue;
    }
    if (kind === 'item') draw(text, font, 10, margin + 8, width - 8);
    else draw(text, kind === 'bold' ? bold : font);
    y -= 3;
  }
  page.drawLine({
    start: { x: margin, y: 40 },
    end: { x: 595 - margin, y: 40 },
    thickness: 0.5,
    color: rgb(0.6, 0.6, 0.6),
  });
  page.drawText(
    'DOCUMENTO FICTÍCIO - gerado para testes do Sandbox Integrar. Não corresponde a paciente real.',
    { x: margin, y: 28, size: 8, font, color: rgb(0.45, 0.45, 0.45) },
  );
  fs.mkdirSync(out.replace(/[\\/][^\\/]+$/, ''), { recursive: true });
  fs.writeFileSync(out, await pdf.save());
  console.log('Laudo fictício gerado em', out);
}
main().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
