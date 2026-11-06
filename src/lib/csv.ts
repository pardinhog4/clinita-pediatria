// Exportação CSV no formato do Excel brasileiro (separador ;, BOM UTF-8) com proteção contra injeção de fórmula.
export function downloadCsv(name: string, header: string[], rows: unknown[][]) {
  const cell = (v: unknown) =>
    '"' +
    String(v ?? '')
      .replace(/^[=+@-]/, "'")
      .replace(/"/g, '""') +
    '"';
  const blob = new Blob(
    ['\ufeff' + [header, ...rows].map((r) => r.map(cell).join(';')).join('\r\n')],
    { type: 'text/csv;charset=utf-8' },
  );
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}
