import { z } from 'zod';
import { query, transaction } from '@/lib/db';
import { ApiError } from '@/lib/errors';
import { permit, type Context } from '@/lib/security';
import { specialtyCode } from '@/lib/schemas';
import { assertSpecialties } from './specialties';
import { audit, scopeRow, managers, readRoles } from './repository';
export type CatalogEntry = {
  code: string;
  name: string;
  description: string;
  synonyms: string[];
  specialties: string[];
  offered: boolean;
};
export const modalityLabels: Record<string, string> = {
  CLINIC: 'Na clínica',
  HOME: 'Em domicílio',
  ONLINE: 'Online',
};
const emptyProfile = {
  bio: '',
  approach: '',
  target_conditions: [] as string[],
  excluded_profiles: '',
  modalities: ['CLINIC'],
  secondary_specialties: [] as string[],
  weekly_hours_available: null as number | null,
  accepts_new_patients: true,
  accepted_insurer_ids: [] as string[],
  ai_notes: '',
  version: 0,
};

export const normalize = (v: string) =>
  v
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9.]+/g, ' ')
    .trim();
// Siglas curtas (IS, AT, TEA) só valem como palavra inteira, para "is" não casar com "análise".
function mentions(text: string, term: string) {
  const t = normalize(term);
  if (!t) return false;
  if (t.length <= 4) return ` ${text} `.includes(` ${t} `);
  return text.includes(t);
}
export function matchCatalog(catalog: CatalogEntry[], term: string) {
  const text = normalize(term);
  if (!text) return [];
  return catalog.filter(
    (c) =>
      normalize(c.code) === text ||
      mentions(text, c.name) ||
      c.synonyms.some((s) => mentions(text, s)) ||
      (text.length > 4 && normalize(c.name).includes(text)),
  );
}
export async function loadCatalog(tenantId: string) {
  return query<CatalogEntry>(
    'SELECT code,name,description,synonyms,specialties,offered FROM competency_catalog WHERE tenant_id=$1 AND active ORDER BY name',
    [tenantId],
  );
}
// Traduz termos livres (do laudo ou da conversa) para códigos do catálogo; termos sem correspondência voltam em "unmatched".
export function resolveTerms(catalog: CatalogEntry[], terms: string[]) {
  const resolved: { term: string; codes: string[]; names: string[]; offered: boolean }[] = [],
    unmatched: string[] = [];
  for (const term of terms) {
    const hits = matchCatalog(catalog, term);
    if (hits.length)
      resolved.push({
        term,
        codes: hits.map((h) => h.code),
        names: hits.map((h) => h.name),
        offered: hits.some((h) => h.offered),
      });
    else unmatched.push(term);
  }
  return { resolved, unmatched };
}

export async function competencyCatalog(ctx: Context) {
  permit(ctx, readRoles.professionals);
  return { data: await loadCatalog(ctx.tenantId) };
}

export async function getProfile(ctx: Context, professionalId: string) {
  permit(ctx, readRoles.professionals);
  z.uuid().parse(professionalId);
  return transaction(async (c) => {
    const p = await scopeRow(c, ctx, 'professionals', professionalId);
    const {
      rows: [profile],
    } = await c.query(
      'SELECT bio,approach,target_conditions,excluded_profiles,modalities,secondary_specialties,weekly_hours_available,accepts_new_patients,accepted_insurer_ids,ai_notes,version,updated_at FROM professional_profiles WHERE tenant_id=$1 AND professional_id=$2',
      [ctx.tenantId, professionalId],
    );
    const { rows: insurers } = await c.query(
      'SELECT id,name FROM insurers WHERE tenant_id=$1 ORDER BY name',
      [ctx.tenantId],
    );
    const { rows: catalog } = await c.query(
      'SELECT code,name,offered FROM competency_catalog WHERE tenant_id=$1 AND code=ANY($2::text[])',
      [ctx.tenantId, p.competencies],
    );
    return {
      professional: {
        id: p.id,
        name: p.name,
        specialty: p.specialty,
        competencies: p.competencies.map((code: string) => ({
          code,
          name: catalog.find((x) => x.code === code)?.name || code,
        })),
      },
      profile: profile || emptyProfile,
      insurers,
      canEdit: managers.includes(ctx.role),
    };
  });
}

const profileInput = z
  .object({
    version: z.number().int().min(0),
    bio: z.string().trim().max(1500),
    approach: z.string().trim().max(1500),
    target_conditions: z.array(z.string().trim().min(2).max(80)).max(20),
    excluded_profiles: z.string().trim().max(800),
    modalities: z
      .array(z.enum(['CLINIC', 'HOME', 'ONLINE']))
      .min(1, 'Escolha ao menos uma modalidade.')
      .max(3),
    secondary_specialties: z.array(specialtyCode).max(6),
    weekly_hours_available: z.number().int().min(0).max(60).nullable(),
    accepts_new_patients: z.boolean(),
    accepted_insurer_ids: z.array(z.uuid()).max(100),
    ai_notes: z.string().trim().max(800),
  })
  .strict();
export async function saveProfile(ctx: Context, professionalId: string, input: unknown) {
  permit(ctx, managers);
  z.uuid().parse(professionalId);
  const d = profileInput.parse(input);
  await assertSpecialties(ctx.tenantId, d.secondary_specialties);
  return transaction(async (c) => {
    const p = await scopeRow(c, ctx, 'professionals', professionalId, true);
    if (d.secondary_specialties.includes(p.specialty))
      throw new ApiError(
        422,
        'A especialidade principal não precisa ser repetida como secundária.',
      );
    if (d.accepted_insurer_ids.length) {
      const {
        rows: [{ n }],
      } = await c.query(
        'SELECT count(*)::int AS n FROM insurers WHERE tenant_id=$1 AND id=ANY($2::uuid[])',
        [ctx.tenantId, d.accepted_insurer_ids],
      );
      if (n !== new Set(d.accepted_insurer_ids).size) throw new ApiError(422, 'Convênio inválido.');
    }
    const {
      rows: [current],
    } = await c.query(
      'SELECT version FROM professional_profiles WHERE tenant_id=$1 AND professional_id=$2 FOR UPDATE',
      [ctx.tenantId, professionalId],
    );
    if ((current?.version || 0) !== d.version)
      throw new ApiError(
        409,
        'O perfil foi alterado por outra pessoa. Recarregue para ver a versão atual.',
      );
    const values = [
      ctx.tenantId,
      professionalId,
      d.bio,
      d.approach,
      [...new Set(d.target_conditions)],
      d.excluded_profiles,
      [...new Set(d.modalities)],
      [...new Set(d.secondary_specialties)],
      d.weekly_hours_available,
      d.accepts_new_patients,
      [...new Set(d.accepted_insurer_ids)],
      d.ai_notes,
      ctx.userId,
    ];
    if (current)
      await c.query(
        'UPDATE professional_profiles SET bio=$3,approach=$4,target_conditions=$5,excluded_profiles=$6,modalities=$7,secondary_specialties=$8,weekly_hours_available=$9,accepts_new_patients=$10,accepted_insurer_ids=$11,ai_notes=$12,updated_by=$13,updated_at=now(),version=version+1 WHERE tenant_id=$1 AND professional_id=$2',
        values,
      );
    else
      await c.query(
        'INSERT INTO professional_profiles(tenant_id,professional_id,bio,approach,target_conditions,excluded_profiles,modalities,secondary_specialties,weekly_hours_available,accepts_new_patients,accepted_insurer_ids,ai_notes,updated_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)',
        values,
      );
    await audit(
      c,
      ctx,
      'professional.profile_updated',
      'professionals',
      professionalId,
      p.unit_id,
      {
        modalities: d.modalities,
        accepts_new_patients: d.accepts_new_patients,
        weekly_hours_available: d.weekly_hours_available,
      },
    );
    return { ok: true };
  });
}
