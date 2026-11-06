import type { PoolClient } from 'pg';
import { readSheet } from 'read-excel-file/node';
import writeXlsxFile from 'write-excel-file/node';
import { z, ZodError } from 'zod';
import { transaction } from '@/lib/db';
import { ApiError } from '@/lib/errors';
import { permit, type Context } from '@/lib/security';
import { audit, managers } from './repository';
import { createWithClient } from './service';
import { tenantSpecialties } from './specialties';

// Importação de cadastros por planilha Excel (Configurações → Importar dados).
// Ordem recomendada: convênios → profissionais (precisam das salas) → pacientes (precisam dos convênios).
//
// Cada linha passa pelo mesmo cadastro da tela (createWithClient: validação, versão e auditoria).
// "Conferir" roda a importação inteira numa transação que é sempre desfeita, então os erros
// mostrados são exatamente os que a importação real teria. "Importar" grava tudo ou nada:
// com qualquer erro, nada é gravado. Registros que já existem são ignorados (não duplicam).

export type ImportKind = 'insurers' | 'professionals' | 'patients';
type Column = {
  key: string;
  label: string;
  required?: boolean;
  example: string | number;
  hint?: string;
};

const columns: Record<ImportKind, Column[]> = {
  insurers: [
    { key: 'name', label: 'Nome do convênio', required: true, example: 'Unimed Exemplo' },
    { key: 'duration', label: 'Duração da sessão (min)', required: true, example: 60 },
    { key: 'session_value', label: 'Valor da sessão (R$)', required: true, example: 120 },
    { key: 'token_required', label: 'Exige token (sim/não)', example: 'não' },
    { key: 'signature_required', label: 'Exige assinatura na guia (sim/não)', example: 'sim' },
    {
      key: 'documents',
      label: 'Documentos exigidos (separados por vírgula)',
      example: 'Pedido médico',
    },
    { key: 'ans_registry', label: 'Registro ANS', example: '' },
    { key: 'notes', label: 'Observações', example: '' },
  ],
  professionals: [
    { key: 'name', label: 'Nome completo', required: true, example: 'Maria Souza' },
    { key: 'specialty', label: 'Especialidade', required: true, example: 'Fonoaudiologia' },
    { key: 'unit', label: 'Unidade', required: true, example: 'Matriz' },
    {
      key: 'room',
      label: 'Sala',
      required: true,
      example: 'Sala 1',
      hint: 'Cadastre as salas antes, em Configurações → Salas e capacidade.',
    },
    { key: 'contract', label: 'Vínculo (PJ ou CLT)', required: true, example: 'PJ' },
    { key: 'hourly_rate', label: 'Valor da hora (R$)', required: true, example: 90 },
    { key: 'min_age', label: 'Idade mínima atendida', example: 0 },
    { key: 'max_age', label: 'Idade máxima atendida', example: 18 },
    {
      key: 'work_days',
      label: 'Dias de atendimento (ex.: seg, ter, qua)',
      example: 'seg, ter, qua, qui, sex',
    },
    { key: 'competencies', label: 'Competências (separadas por vírgula)', example: 'TEA, PROMPT' },
  ],
  patients: [
    { key: 'name', label: 'Nome completo', required: true, example: 'João da Silva' },
    { key: 'birth_date', label: 'Nascimento (dd/mm/aaaa)', required: true, example: '10/04/2019' },
    { key: 'guardian', label: 'Responsável', required: true, example: 'Ana da Silva' },
    { key: 'phone', label: 'Telefone', required: true, example: '(92) 99999-0000' },
    { key: 'unit', label: 'Unidade', required: true, example: 'Matriz' },
    { key: 'insurer', label: 'Convênio', required: true, example: 'Unimed Exemplo' },
    { key: 'card_number', label: 'Carteirinha', example: '' },
    {
      key: 'specialties',
      label: 'Especialidades do pedido (separadas por vírgula)',
      example: 'Fonoaudiologia, Psicologia',
    },
    { key: 'order_expires', label: 'Validade do pedido (dd/mm/aaaa)', example: '' },
    { key: 'notes', label: 'Observações', example: '' },
  ],
};
export const importKinds: Record<ImportKind, string> = {
  insurers: 'Convênios',
  professionals: 'Profissionais',
  patients: 'Pacientes',
};
const kindSchema = z.enum(['insurers', 'professionals', 'patients']);
const MAX_ROWS = 2000;

// ---------- Modelo para download ----------

export async function importTemplate(ctx: Context, kind: string) {
  permit(ctx, managers);
  const k = kindSchema.parse(kind);
  const cols = columns[k];
  const header = cols.map((c) => ({
    value: c.label + (c.required ? ' *' : ''),
    fontWeight: 'bold' as const,
  }));
  const buffer = await writeXlsxFile(
    [
      { sheet: 'Dados', data: [header], columns: cols.map(() => ({ width: 28 })) },
      {
        sheet: 'Exemplo',
        data: [header, cols.map((c) => c.example)],
        columns: cols.map(() => ({ width: 28 })),
      },
      {
        sheet: 'Instruções',
        data: [
          [{ value: `Importação de ${importKinds[k].toLowerCase()}`, fontWeight: 'bold' as const }],
          [
            'Preencha uma linha por registro na aba "Dados", a partir da linha 2. Não mude os títulos.',
          ],
          ['Colunas com * são obrigatórias. Veja a aba "Exemplo".'],
          ['Unidades, convênios, salas e especialidades devem ter o mesmo nome do sistema.'],
          ['Registros que já existem são ignorados; nada é duplicado.'],
          ...cols.filter((c) => c.hint).map((c) => [`${c.label}: ${c.hint}`]),
        ],
        columns: [{ width: 100 }],
      },
    ],
    { fontFamily: 'Calibri', fontSize: 11 },
  ).toBuffer();
  return { buffer, filename: `modelo-${k}.xlsx` };
}

// ---------- Leitura e conversão ----------

const norm = (v: unknown) =>
  String(v ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
const text = (v: unknown) => (v === null || v === undefined ? '' : String(v).trim());
const list = (v: unknown) =>
  text(v)
    .split(/[,;]/)
    .map((x) => x.trim())
    .filter(Boolean);

function yesNo(v: unknown, label: string) {
  const t = norm(v);
  if (!t) return false;
  if (['sim', 's', 'yes', 'true', '1', 'x'].includes(t)) return true;
  if (['nao', 'n', 'no', 'false', '0'].includes(t)) return false;
  throw new RowError(`${label}: use "sim" ou "não".`);
}
function number(v: unknown, label: string, required = false) {
  if (v === null || v === undefined || text(v) === '') {
    if (required) throw new RowError(`${label}: obrigatório.`);
    return undefined;
  }
  const n =
    typeof v === 'number'
      ? v
      : Number(
          text(v)
            .replace(/[R$\s]/g, '')
            .replace(/\.(?=\d{3}(\D|$))/g, '')
            .replace(',', '.'),
        );
  if (!Number.isFinite(n)) throw new RowError(`${label}: número inválido ("${text(v)}").`);
  return n;
}
/** Data da planilha: célula de data do Excel, "dd/mm/aaaa" ou "aaaa-mm-dd". */
function date(v: unknown, label: string, required = false) {
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v.toISOString().slice(0, 10);
  const t = text(v);
  if (!t) {
    if (required) throw new RowError(`${label}: obrigatório.`);
    return '';
  }
  let m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  m = t.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return t;
  throw new RowError(`${label}: data inválida ("${t}"). Use dd/mm/aaaa.`);
}
const weekdays: Record<string, number> = {
  dom: 0,
  domingo: 0,
  seg: 1,
  segunda: 1,
  ter: 2,
  terca: 2,
  qua: 3,
  quarta: 3,
  qui: 4,
  quinta: 4,
  sex: 5,
  sexta: 5,
  sab: 6,
  sabado: 6,
};

class RowError extends Error {}

type Refs = {
  units: Map<string, string>;
  insurers: Map<string, string>;
  rooms: Map<string, string>; // unidade|sala → id
  specialties: Map<string, string>; // nome ou código → código
  existing: Set<string>;
};

async function loadRefs(c: PoolClient, ctx: Context, kind: ImportKind): Promise<Refs> {
  const q = async (sql: string, args: unknown[]) => (await c.query(sql, args)).rows;
  const units = await q(
    'SELECT id,name FROM units WHERE tenant_id=$1 AND id=ANY($2::uuid[]) AND active=true',
    [ctx.tenantId, ctx.unitIds],
  );
  const insurers = await q('SELECT id,name FROM insurers WHERE tenant_id=$1 AND active=true', [
    ctx.tenantId,
  ]);
  const rooms = await q(
    'SELECT r.id,r.name,r.unit_id FROM rooms r WHERE r.tenant_id=$1 AND r.active=true AND r.unit_id=ANY($2::uuid[])',
    [ctx.tenantId, ctx.unitIds],
  );
  const specialties = (await tenantSpecialties(ctx.tenantId, c)).filter((s) => s.active);
  const existing =
    kind === 'insurers'
      ? (await q('SELECT name FROM insurers WHERE tenant_id=$1', [ctx.tenantId])).map((r) =>
          norm(r.name),
        )
      : kind === 'professionals'
        ? (
            await q('SELECT name,unit_id FROM professionals WHERE tenant_id=$1', [ctx.tenantId])
          ).map((r) => norm(r.name) + '|' + r.unit_id)
        : (
            await q('SELECT name,birth_date::text AS birth FROM patients WHERE tenant_id=$1', [
              ctx.tenantId,
            ])
          ).map((r) => norm(r.name) + '|' + r.birth);
  return {
    units: new Map(units.map((u) => [norm(u.name), u.id])),
    insurers: new Map(insurers.map((i) => [norm(i.name), i.id])),
    rooms: new Map(rooms.map((r) => [r.unit_id + '|' + norm(r.name), r.id])),
    specialties: new Map(
      specialties.flatMap((s) => [
        [norm(s.name), s.code],
        [norm(s.code), s.code],
      ]),
    ),
    existing: new Set(existing),
  };
}

function lookup(map: Map<string, string>, value: unknown, label: string, hint: string) {
  const t = text(value);
  if (!t) throw new RowError(`${label}: obrigatório.`);
  const id = map.get(norm(t));
  if (!id) throw new RowError(`${label}: "${t}" não encontrado. ${hint}`);
  return id;
}

/** Converte uma linha da planilha no mesmo formato do cadastro da tela. */
function toInput(kind: ImportKind, row: Record<string, unknown>, refs: Refs) {
  const req = (key: string, label: string) => {
    const t = text(row[key]);
    if (!t) throw new RowError(`${label}: obrigatório.`);
    return t;
  };
  if (kind === 'insurers') {
    const token = yesNo(row.token_required, 'Exige token'),
      signature = yesNo(row.signature_required, 'Exige assinatura');
    return {
      key: norm(row.name),
      input: {
        name: req('name', 'Nome do convênio'),
        rules: {
          duration: number(row.duration, 'Duração da sessão', true),
          session_value: number(row.session_value, 'Valor da sessão', true),
          token_required: token,
          signature_required: signature,
          documents: list(row.documents),
          notes: text(row.notes),
          ans_registry: text(row.ans_registry),
          authorization_type: token ? 'TOKEN' : signature ? 'GUIDE' : 'QUOTA',
        },
      },
    };
  }
  if (kind === 'professionals') {
    const unitId = lookup(refs.units, row.unit, 'Unidade', 'Use o nome exato da unidade.');
    const contract = text(row.contract).toUpperCase();
    if (!['PJ', 'CLT'].includes(contract)) throw new RowError('Vínculo: use PJ ou CLT.');
    const days = list(row.work_days).map((d) => {
      const n = weekdays[norm(d)];
      if (n === undefined)
        throw new RowError(`Dias de atendimento: "${d}" não é um dia da semana.`);
      return n;
    });
    return {
      key: norm(row.name) + '|' + unitId,
      input: {
        name: req('name', 'Nome completo'),
        specialty: lookup(
          refs.specialties,
          row.specialty,
          'Especialidade',
          'Use o nome cadastrado em Configurações → Especialidades.',
        ),
        unit_id: unitId,
        room_id: lookup(
          new Map(
            [...refs.rooms]
              .filter(([k]) => k.startsWith(unitId + '|'))
              .map(([k, v]) => [k.slice(unitId.length + 1), v]),
          ),
          row.room,
          'Sala',
          'Cadastre a sala nesta unidade antes de importar.',
        ),
        contract,
        hourly_rate: number(row.hourly_rate, 'Valor da hora', true),
        competencies: list(row.competencies),
        metadata: {
          ...(number(row.min_age, 'Idade mínima') !== undefined
            ? { min_age: number(row.min_age, 'Idade mínima') }
            : {}),
          ...(number(row.max_age, 'Idade máxima') !== undefined
            ? { max_age: number(row.max_age, 'Idade máxima') }
            : {}),
          ...(days.length ? { work_days: [...new Set(days)].sort() } : {}),
        },
      },
    };
  }
  const birth = date(row.birth_date, 'Nascimento', true);
  return {
    key: norm(row.name) + '|' + birth,
    input: {
      name: req('name', 'Nome completo'),
      birth_date: birth,
      guardian: req('guardian', 'Responsável'),
      phone: req('phone', 'Telefone'),
      unit_id: lookup(refs.units, row.unit, 'Unidade', 'Use o nome exato da unidade.'),
      insurer_id: lookup(
        refs.insurers,
        row.insurer,
        'Convênio',
        'Importe ou cadastre o convênio antes.',
      ),
      card_number: text(row.card_number),
      metadata: {
        specialties: list(row.specialties).map((s) =>
          lookup(
            refs.specialties,
            s,
            'Especialidades do pedido',
            'Use o nome cadastrado em Configurações → Especialidades.',
          ),
        ),
        order_expires: date(row.order_expires, 'Validade do pedido'),
        ...(text(row.notes) ? { notes: text(row.notes) } : {}),
      },
    },
  };
}

// Mensagens de validação em português, com o nome da coluna.
const fieldLabels: Record<string, string> = {
  name: 'Nome',
  birth_date: 'Nascimento',
  guardian: 'Responsável',
  phone: 'Telefone',
  card_number: 'Carteirinha',
  hourly_rate: 'Valor da hora',
  duration: 'Duração da sessão',
  session_value: 'Valor da sessão',
  min_age: 'Idade mínima',
  max_age: 'Idade máxima',
  competencies: 'Competências',
  notes: 'Observações',
  ans_registry: 'Registro ANS',
};
function errorMessage(e: unknown) {
  if (e instanceof RowError || e instanceof ApiError) return e.message;
  if (e instanceof ZodError)
    return e.issues
      .map((i) => {
        const field = String(i.path.at(-1) ?? '');
        const label = fieldLabels[field] || field;
        const msg =
          i.code === 'too_small'
            ? i.origin === 'string'
              ? 'muito curto'
              : `mínimo ${(i as { minimum?: number }).minimum}`
            : i.code === 'too_big'
              ? i.origin === 'string'
                ? 'muito longo'
                : `máximo ${(i as { maximum?: number }).maximum}`
              : /^[A-Z]/.test(i.message) &&
                  /[a-z]/.test(i.message) &&
                  !/[áéíóúãõç]/i.test(i.message)
                ? 'valor inválido'
                : i.message;
        return label ? `${label}: ${msg}` : msg;
      })
      .join('; ');
  const pg = e as { code?: string; message?: string };
  if (pg.code === '23514' || pg.code === '23505')
    return 'Valor recusado pelo banco: confira os campos.';
  return 'Não foi possível conferir esta linha.';
}

// ---------- Conferir / importar ----------

export type ImportResult = {
  kind: ImportKind;
  committed: boolean;
  total: number;
  ok: number;
  skipped: { line: number; name: string; reason: string }[];
  errors: { line: number; name: string; message: string }[];
};

class DryRun extends Error {}

export async function runImport(
  ctx: Context,
  kind: string,
  file: Buffer,
  commit: boolean,
): Promise<ImportResult> {
  permit(ctx, managers);
  const k = kindSchema.parse(kind);
  let sheet: unknown[][];
  try {
    sheet = (await readSheet(file, 'Dados').catch(() => readSheet(file))) as unknown[][];
  } catch {
    throw new ApiError(422, 'Não foi possível ler a planilha. Envie um arquivo .xlsx do modelo.');
  }
  const cols = columns[k];
  const header = (sheet[0] || []).map((h) => norm(String(h ?? '').replace(/\*$/, '')));
  const index = cols.map((c) => header.indexOf(norm(c.label)));
  const missing = cols.filter((c, i) => c.required && index[i] < 0).map((c) => c.label);
  if (missing.length)
    throw new ApiError(
      422,
      `Planilha fora do modelo: faltam as colunas ${missing.join(', ')}. Baixe o modelo de ${importKinds[k].toLowerCase()}.`,
    );
  const rows = sheet
    .slice(1)
    .map((r, i) => ({
      line: i + 2,
      values: Object.fromEntries(cols.map((c, j) => [c.key, index[j] >= 0 ? r[index[j]] : null])),
    }))
    .filter((r) => Object.values(r.values).some((v) => text(v) !== ''));
  if (!rows.length) throw new ApiError(422, 'A aba "Dados" está vazia.');
  if (rows.length > MAX_ROWS)
    throw new ApiError(422, `Envie até ${MAX_ROWS} linhas por planilha (esta tem ${rows.length}).`);

  const result: ImportResult = {
    kind: k,
    committed: false,
    total: rows.length,
    ok: 0,
    skipped: [],
    errors: [],
  };
  try {
    await transaction(async (c) => {
      const refs = await loadRefs(c, ctx, k);
      const seen = new Map<string, number>();
      for (const r of rows) {
        const name = text(r.values.name) || '(sem nome)';
        await c.query('SAVEPOINT import_row');
        try {
          const { key, input } = toInput(k, r.values, refs);
          if (refs.existing.has(key)) {
            result.skipped.push({ line: r.line, name, reason: 'Já cadastrado no sistema.' });
            await c.query('RELEASE SAVEPOINT import_row');
            continue;
          }
          if (seen.has(key)) throw new RowError(`Repetido na linha ${seen.get(key)}.`);
          seen.set(key, r.line);
          await createWithClient(c, ctx, k, input);
          await c.query('RELEASE SAVEPOINT import_row');
          result.ok++;
        } catch (e) {
          await c.query('ROLLBACK TO SAVEPOINT import_row');
          result.errors.push({ line: r.line, name, message: errorMessage(e) });
        }
      }
      if (!commit || result.errors.length) throw new DryRun();
      await audit(c, ctx, 'import.completed', 'platform', null, null, {
        kind: k,
        imported: result.ok,
        skipped: result.skipped.length,
      });
      result.committed = true;
    });
  } catch (e) {
    if (!(e instanceof DryRun)) throw e;
  }
  return result;
}
