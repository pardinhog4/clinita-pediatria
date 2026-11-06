import { z } from 'zod';
import { tenantSpecialties } from './specialties';
import type { PoolClient } from 'pg';
import { query, transaction } from '@/lib/db';
import { ApiError } from '@/lib/errors';
import { permit, assertUnit, type Context } from '@/lib/security';
import { audit, managers, receptionRoles } from './repository';
import { loadCatalog, matchCatalog, type CatalogEntry } from './professional-profiles';
import type { ToolScope } from './ai/tools';
// Plano de encaminhamento: cada serviço pedido no laudo vira um item com profissional sugerido (fila do profissional) ou coordenação clínica.
export type Modality = 'CLINIC' | 'HOME' | 'ONLINE';
type RankInput = {
  specialties: string[];
  terms: string[];
  age: number | null;
  modality: Modality | null;
  weeklyHours: number | null;
};
const clip = (v: string | null, n = 300) => (v ? (v.length > n ? v.slice(0, n) + '…' : v) : null);
const hours = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1).replace('.', ','));
export async function rankProfessionals(scope: ToolScope, d: RankInput, catalog?: CatalogEntry[]) {
  const rows = d.specialties.length
    ? await query(
        `SELECT p.id,p.name,p.specialty,p.competencies,p.metadata,(p.specialty=ANY($3::text[])) AS primary_specialty,pp.bio,pp.approach,coalesce(pp.target_conditions,'{}') AS target_conditions,pp.excluded_profiles,coalesce(pp.modalities,'{CLINIC}') AS modalities,pp.weekly_hours_available,coalesce(pp.accepts_new_patients,true) AS accepts_new_patients,coalesce(pp.accepted_insurer_ids,'{}') AS accepted_insurer_ids,pp.ai_notes
  FROM professionals p LEFT JOIN professional_profiles pp ON pp.tenant_id=p.tenant_id AND pp.professional_id=p.id WHERE p.tenant_id=$1 AND p.unit_id=$2 AND p.active=true AND (p.specialty=ANY($3::text[]) OR coalesce(pp.secondary_specialties,'{}')&&$3::text[]) ORDER BY p.name`,
        [scope.tenantId, scope.unitId, d.specialties],
      )
    : [];
  let age = d.age,
    insurer: string | null = null;
  if (scope.patientId) {
    const [p] = await query(
      'SELECT birth_date,insurer_id FROM patients WHERE tenant_id=$1 AND unit_id=$2 AND id=$3',
      [scope.tenantId, scope.unitId, scope.patientId],
    );
    if (p) {
      age = (Date.now() - new Date(p.birth_date).getTime()) / (365.25 * 86400000);
      insurer = p.insurer_id;
    }
  }
  catalog ??= await loadCatalog(scope.tenantId);
  // Termos sem correspondência no catálogo não reprovam ninguém: são devolvidos para conferência humana.
  const seen = new Set<string>(),
    requested: { term: string; codes: string[] }[] = [],
    unrecognized: string[] = [];
  // Cada competência citada vira um requisito próprio: "TEA, PROMPT e CAA" exige as três.
  for (const term of d.terms) {
    const hits = matchCatalog(catalog, term);
    if (!hits.length) {
      unrecognized.push(term);
      continue;
    }
    for (const c of hits.filter((c) => c.offered && !seen.has(c.code))) {
      seen.add(c.code);
      requested.push({ term: c.name, codes: [c.code] });
    }
  }
  const name = (code: string) => catalog!.find((x) => x.code === code)?.name || code;
  const professionals = rows
    .filter(
      (p) =>
        age === null || (age >= (p.metadata.min_age || 0) && age < (p.metadata.max_age || 120) + 1),
    )
    .map((p) => {
      const own: string[] = p.competencies || [],
        matched = requested.filter((r) => r.codes.some((c) => own.includes(c))),
        missing = requested.filter((r) => !r.codes.some((c) => own.includes(c)));
      const modality_ok = !d.modality || p.modalities.includes(d.modality),
        insurer_ok = insurer
          ? !p.accepted_insurer_ids.length || p.accepted_insurer_ids.includes(insurer)
          : null;
      const capacity_ok =
        d.weeklyHours === null || p.weekly_hours_available === null
          ? null
          : Number(p.weekly_hours_available) >= d.weeklyHours;
      const fit_score = Math.round(
        (requested.length ? matched.length / requested.length : 1) * 60 +
          (p.primary_specialty ? 10 : 0) +
          (modality_ok ? 10 : 0) +
          (p.accepts_new_patients ? 10 : 0) +
          (capacity_ok === false ? 0 : 5) +
          (insurer_ok === false ? 0 : 5),
      );
      const warnings = [
        ...(p.accepts_new_patients ? [] : ['Sem vaga para novos pacientes']),
        ...(modality_ok
          ? []
          : [
              d.modality === 'HOME'
                ? 'Não atende em domicílio'
                : d.modality === 'ONLINE'
                  ? 'Não atende online'
                  : 'Não atende na clínica',
            ]),
        ...(capacity_ok === false
          ? [
              `Carga pedida (${hours(d.weeklyHours!)} h) acima das horas livres (${hours(Number(p.weekly_hours_available))} h)`,
            ]
          : []),
        ...(insurer_ok === false ? ['Não atende o convênio do paciente'] : []),
        ...missing.map((r) => 'Sem registro de: ' + r.codes.map(name).join(' / ')),
      ];
      return {
        id: p.id as string,
        name: p.name as string,
        specialty: p.specialty as string,
        primary_specialty: p.primary_specialty as boolean,
        competencies: own.map(name),
        matched_requirements: matched.map((r) => r.term),
        missing_requirements: missing.map((r) => r.term),
        age_range: { min_years: p.metadata.min_age || 0, max_years: p.metadata.max_age || 120 },
        modalities: p.modalities as string[],
        modality_ok,
        accepts_new_patients: p.accepts_new_patients as boolean,
        weekly_hours_available:
          p.weekly_hours_available === null ? null : Number(p.weekly_hours_available),
        capacity_ok,
        accepts_patient_insurer: insurer_ok,
        profile: {
          bio: clip(p.bio),
          approach: clip(p.approach),
          target_conditions: p.target_conditions,
          does_not_attend: clip(p.excluded_profiles, 200),
          notes: clip(p.ai_notes, 200),
        },
        fit_score,
        competency_match: requested.length ? missing.length === 0 : null,
        requires_manual_verification: missing.length > 0 || !modality_ok || !p.accepts_new_patients,
        warnings,
      };
    })
    .sort((a, b) => b.fit_score - a.fit_score || a.name.localeCompare(b.name))
    .slice(0, 8);
  for (const p of professionals) scope.knownProfessionalIds.add(p.id);
  return { professionals, requested, unrecognized, age };
}

export const planItemSchema = z
  .object({
    servico: z.string().trim().min(1).max(400),
    specialty: z.string().trim().max(30).nullable(),
    competencies: z.array(z.string().trim().min(1).max(200)).max(12),
    carga: z.string().trim().max(200),
    weekly_hours: z.number().min(0).max(80).nullable(),
    modality: z.enum(['CLINIC', 'HOME', 'ONLINE']).nullable(),
  })
  .strict();
export const planInputSchema = z
  .object({
    patient_first_name: z.string().trim().max(60).nullable(),
    age_years: z.number().min(0).max(120).nullable(),
    notes: z.string().trim().max(1000),
    items: z.array(planItemSchema).min(1).max(20),
  })
  .strict();
export const planToolJsonSchema = {
  type: 'object',
  properties: {
    patient_first_name: {
      type: ['string', 'null'],
      description: 'Primeiro nome do paciente, se informado na conversa ou no documento.',
    },
    age_years: { type: ['number', 'null'], minimum: 0, maximum: 120 },
    notes: {
      type: 'string',
      description:
        'Convênio, unidade e preferências de dias/período informados pela família. Sem diagnóstico.',
    },
    items: {
      type: 'array',
      minItems: 1,
      maxItems: 20,
      description:
        'UM item por serviço pedido no documento, inclusive os que a clínica talvez não ofereça.',
      items: {
        type: 'object',
        properties: {
          servico: { type: 'string', description: 'O pedido como escrito no documento.' },
          specialty: {
            type: ['string', 'null'],
            description:
              'Código da especialidade da clínica que atende o item (lista nas instruções); null se não houver ou se não souber.',
          },
          competencies: {
            type: 'array',
            items: { type: 'string' },
            description:
              'Métodos, competências e perfis exigidos, como escritos (ex.: "PROMPT", "TEA", "supervisão").',
          },
          carga: {
            type: 'string',
            description: 'Frequência como escrita (ex.: "4x por semana, 1 h").',
          },
          weekly_hours: {
            type: ['number', 'null'],
            description: 'Horas semanais calculadas a partir da carga.',
          },
          modality: { type: ['string', 'null'], enum: ['CLINIC', 'HOME', 'ONLINE', null] },
        },
        required: ['servico', 'specialty', 'competencies', 'carga', 'weekly_hours', 'modality'],
        additionalProperties: false,
      },
    },
  },
  required: ['patient_first_name', 'age_years', 'notes', 'items'],
  additionalProperties: false,
};
export type PlanItem = {
  position: number;
  service_text: string;
  specialties: string[];
  requirements: string[];
  catalog_codes: string[];
  load_text: string;
  weekly_hours: number | null;
  modality: Modality | null;
  match_status: 'SUGGESTED' | 'PARTIAL' | 'NO_MATCH' | 'NOT_OFFERED';
  professional_id: string | null;
  professional_name: string | null;
  alternatives: { id: string; name: string; fit_score: number; warnings: string[] }[];
  reason: string;
  warnings: string[];
};
export type PlanDraft = {
  patient_label: string;
  age_years: number | null;
  notes: string;
  items: PlanItem[];
};
export async function buildPlan(scope: ToolScope, input: unknown): Promise<PlanDraft> {
  const d = planInputSchema.parse(input);
  const catalog = await loadCatalog(scope.tenantId);
  const items: PlanItem[] = [];
  // Só especialidades ativas da clínica; um código desconhecido vindo da IA é tratado como "não informado".
  const tenantCodes = new Set(
    (await tenantSpecialties(scope.tenantId)).filter((s) => s.active).map((s) => s.code),
  );
  // O mesmo profissional pode receber mais de um item; a carga acumulada entra no aviso de capacidade.
  const load = new Map<string, number>();
  for (const [i, it] of d.items.entries()) {
    const terms = [it.servico, ...it.competencies],
      hits = terms.flatMap((t) => matchCatalog(catalog, t)),
      codes = [...new Set(hits.map((c) => c.code))];
    // Item só de serviço não oferecido (equoterapia, neurologista) não vira busca, mesmo se a IA sugerir uma especialidade.
    const core = hits.filter((c) => c.offered && c.code !== 'tea'),
      notOffered = core.length
        ? []
        : [...new Map(hits.filter((c) => !c.offered).map((c) => [c.code, c])).values()];
    const chosen = it.specialty && tenantCodes.has(it.specialty) ? it.specialty : null;
    const specialties = notOffered.length
      ? []
      : chosen
        ? [chosen]
        : [...new Set(core.flatMap((c) => c.specialties))].filter((s) => tenantCodes.has(s));
    const base = {
      position: i + 1,
      service_text: it.servico,
      specialties,
      requirements: it.competencies,
      catalog_codes: codes,
      load_text: it.carga,
      weekly_hours: it.weekly_hours,
      modality: it.modality,
    };
    if (!specialties.length) {
      items.push({
        ...base,
        match_status: notOffered.length ? 'NOT_OFFERED' : 'NO_MATCH',
        professional_id: null,
        professional_name: null,
        alternatives: [],
        reason: notOffered.length
          ? `${notOffered.map((c) => c.name).join(', ')}: a clínica não oferece. Coordenação orienta a família sobre alternativa externa.`
          : 'Serviço sem correspondência no catálogo da clínica. Coordenação define quem atende.',
        warnings: [],
      });
      continue;
    }
    const ranked = await rankProfessionals(
      scope,
      {
        specialties,
        terms: [it.servico, ...it.competencies],
        age: d.age_years,
        modality: it.modality,
        weeklyHours: null,
      },
      catalog,
    );
    const withLoad = ranked.professionals.map((p) => {
      const used = load.get(p.id) || 0,
        need = (it.weekly_hours || 0) + used,
        free = p.weekly_hours_available;
      const over = it.weekly_hours !== null && free !== null && need > free;
      return {
        ...p,
        warnings: [
          ...p.warnings,
          ...(over
            ? [
                `${used ? 'Carga somada no plano' : 'Carga pedida'} (${hours(need)} h) acima das horas livres (${hours(free!)} h)`,
              ]
            : []),
        ],
        eligible:
          p.modality_ok &&
          p.accepts_new_patients &&
          p.accepts_patient_insurer !== false &&
          p.matched_requirements.length * 2 >=
            p.matched_requirements.length + p.missing_requirements.length,
        over,
      };
    });
    // Bloqueiam: modalidade, sem vaga, convênio, menos da metade dos requisitos. Requisito secundário faltante e carga acima das horas livres viram avisos: o profissional confere antes de aceitar.
    // Entre os elegíveis, prefere quem ainda tem horas livres para distribuir a carga do plano.
    const best = withLoad.find((p) => p.eligible && !p.over) || withLoad.find((p) => p.eligible),
      alternatives = withLoad
        .filter((p) => p !== best)
        .slice(0, 2)
        .map((p) => ({ id: p.id, name: p.name, fit_score: p.fit_score, warnings: p.warnings }));
    if (best) {
      load.set(best.id, (load.get(best.id) || 0) + (it.weekly_hours || 0));
      items.push({
        ...base,
        match_status: 'SUGGESTED',
        professional_id: best.id,
        professional_name: best.name,
        alternatives,
        reason: `Aderência ${best.fit_score}/100. ${best.matched_requirements.length ? 'Atende: ' + best.matched_requirements.join(', ') + '.' : 'Especialidade compatível.'}${ranked.unrecognized.length ? ' Conferir: ' + ranked.unrecognized.join(', ') + '.' : ''}`,
        warnings: best.warnings,
      });
    } else
      items.push({
        ...base,
        match_status: withLoad.length ? 'PARTIAL' : 'NO_MATCH',
        professional_id: null,
        professional_name: null,
        alternatives: withLoad
          .slice(0, 3)
          .map((p) => ({ id: p.id, name: p.name, fit_score: p.fit_score, warnings: p.warnings })),
        reason: withLoad.length
          ? 'Nenhum profissional cumpre o mínimo (modalidade, vaga, convênio e metade das competências pedidas). Coordenação decide entre as alternativas.'
          : 'Nenhum profissional ativo desta especialidade e faixa etária na unidade.',
        warnings: [],
      });
  }
  return {
    patient_label: d.patient_first_name || '',
    age_years: d.age_years,
    notes: d.notes,
    items,
  };
}
export function planForModel(plan: PlanDraft) {
  const label = {
    SUGGESTED: 'profissional sugerido, aguarda aceite',
    PARTIAL: 'coordenação clínica decide entre alternativas',
    NO_MATCH: 'coordenação clínica: sem profissional compatível',
    NOT_OFFERED: 'não oferecido pela clínica',
  };
  return {
    itens: plan.items.map((i) => ({
      item: i.position,
      servico: i.service_text,
      situacao: label[i.match_status],
      profissional: i.professional_name,
      alternativas: i.alternatives.map((a) => a.name),
      motivo: i.reason,
      avisos: i.warnings,
    })),
    salvo:
      'O plano será salvo ao finalizar e enviado às caixas dos profissionais e à coordenação clínica.',
    orientacao:
      'Para a família: diga em linguagem simples o que a clínica consegue organizar e o que não oferece; não cite nomes de profissionais antes do aceite da equipe.',
  };
}

export async function persistPlan(
  c: PoolClient,
  run: {
    tenant_id: string;
    unit_id: string;
    conversation_id: string;
    id: string;
    requested_by: string;
  },
  conv: { patient_id: string | null; sandbox: boolean; guardian: string },
  plan: PlanDraft,
) {
  const { rows: old } = await c.query(
    "UPDATE referral_plans SET status='SUPERSEDED' WHERE tenant_id=$1 AND conversation_id=$2 AND status='ACTIVE' RETURNING id",
    [run.tenant_id, run.conversation_id],
  );
  if (old.length)
    await c.query(
      `UPDATE referral_items SET state='SUPERSEDED',updated_at=now(),version=version+1,history=history||jsonb_build_array(jsonb_build_object('at',now(),'action','SUPERSEDED','note','Plano refeito pela IA.')) WHERE tenant_id=$1 AND plan_id=ANY($2::uuid[]) AND state='PENDING'`,
      [run.tenant_id, old.map((o) => o.id)],
    );
  const {
    rows: [p],
  } = await c.query(
    'INSERT INTO referral_plans(tenant_id,unit_id,conversation_id,agent_run_id,patient_id,patient_label,age_years,notes,sandbox) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id',
    [
      run.tenant_id,
      run.unit_id,
      run.conversation_id,
      run.id,
      conv.patient_id,
      (plan.patient_label || conv.guardian).slice(0, 120),
      plan.age_years,
      plan.notes,
      conv.sandbox,
    ],
  );
  for (const i of plan.items)
    await c.query(
      `INSERT INTO referral_items(tenant_id,unit_id,plan_id,conversation_id,position,service_text,specialties,requirements,catalog_codes,load_text,weekly_hours,modality,match_status,professional_id,alternatives,reason,warnings,route,history) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,jsonb_build_array(jsonb_build_object('at',now(),'action','CREATED','note',$16::text)))`,
      [
        run.tenant_id,
        run.unit_id,
        p.id,
        run.conversation_id,
        i.position,
        i.service_text,
        i.specialties,
        i.requirements,
        i.catalog_codes,
        i.load_text,
        i.weekly_hours,
        i.modality,
        i.match_status,
        i.professional_id,
        JSON.stringify(i.alternatives),
        i.reason,
        i.warnings,
        i.professional_id ? 'PROFESSIONAL' : 'COORDINATION',
      ],
    );
  await c.query(
    "INSERT INTO audit_events(tenant_id,unit_id,actor_id,action,entity_type,entity_id,details) VALUES($1,$2,$3,'referral.plan_created','referral_plans',$4,$5)",
    [
      run.tenant_id,
      run.unit_id,
      run.requested_by,
      p.id,
      JSON.stringify({
        runId: run.id,
        items: plan.items.length,
        suggested: plan.items.filter((i) => i.professional_id).length,
      }),
    ],
  );
  return p.id as string;
}

const itemSelect = `SELECT i.id,i.plan_id,i.conversation_id,i.position,i.service_text,i.specialties,i.requirements,i.load_text,i.weekly_hours,i.modality,i.match_status,i.professional_id,pr.name AS professional_name,pr.specialty AS professional_specialty,i.alternatives,i.reason,i.warnings,i.route,i.state,i.history,i.decided_at,du.name AS decided_by_name,i.proposal_id,cp.status AS proposal_status,cp.patient_id AS proposal_patient_id,i.scheduled_at,(SELECT coalesce(jsonb_agg(a ORDER BY a->>'starts_at'),'[]') FROM jsonb_array_elements(cp.appointments) a WHERE a->>'referral_item_id'=i.id::text) AS proposed_slots,i.version,i.created_at,rp.patient_label,rp.age_years,rp.notes,rp.sandbox,c.guardian
 FROM referral_items i JOIN referral_plans rp ON rp.id=i.plan_id AND rp.tenant_id=i.tenant_id JOIN conversations c ON c.id=i.conversation_id AND c.tenant_id=i.tenant_id LEFT JOIN professionals pr ON pr.id=i.professional_id AND pr.tenant_id=i.tenant_id LEFT JOIN users du ON du.id=i.decided_by LEFT JOIN conversation_proposals cp ON cp.id=i.proposal_id AND cp.tenant_id=i.tenant_id`;
export async function conversationPlan(tenantId: string, conversationId: string) {
  const [plan] = await query(
    "SELECT id,patient_label,age_years,notes,created_at FROM referral_plans WHERE tenant_id=$1 AND conversation_id=$2 AND status='ACTIVE'",
    [tenantId, conversationId],
  );
  if (!plan) return null;
  return {
    ...plan,
    items: await query(itemSelect + ' WHERE i.tenant_id=$1 AND i.plan_id=$2 ORDER BY i.position', [
      tenantId,
      plan.id,
    ]),
  };
}
async function ownProfessional(ctx: Context) {
  const [p] = await query(
    "SELECT id,name,unit_id FROM professionals WHERE tenant_id=$1 AND metadata->>'user_id'=$2 AND active=true",
    [ctx.tenantId, ctx.userId],
  );
  return p as { id: string; name: string; unit_id: string } | undefined;
}
export async function listReferrals(ctx: Context, params: URLSearchParams) {
  permit(ctx, [...receptionRoles, 'CLINICIAN']);
  const view = z
      .enum(['professional', 'scheduling', 'coordination', 'accepted', 'all'])
      .catch('professional')
      .parse(params.get('view')),
    professional = params.get('professional') || '';
  if (ctx.role === 'CLINICIAN') {
    const own = await ownProfessional(ctx);
    if (!own)
      return {
        data: [],
        summary: { pending: 0, coordination: 0, accepted: 0 },
        own: null,
        canManage: false,
      };
    const data = await query(
      itemSelect +
        ` WHERE i.tenant_id=$1 AND i.professional_id=$2 AND i.state<>'SUPERSEDED' AND ($3::text='all' OR ($3='accepted' AND i.state IN('ACCEPTED','SCHEDULED')) OR ($3<>'accepted' AND i.state='PENDING')) ORDER BY i.state='PENDING' DESC,i.created_at DESC,i.position LIMIT 200`,
      [ctx.tenantId, own.id, view],
    );
    const [s] = await query(
      "SELECT count(*) FILTER(WHERE state='PENDING')::int AS pending,count(*) FILTER(WHERE state IN('ACCEPTED','SCHEDULED'))::int AS accepted FROM referral_items WHERE tenant_id=$1 AND professional_id=$2",
      [ctx.tenantId, own.id],
    );
    return { data, summary: { ...s, coordination: 0 }, own, canManage: false };
  }
  const unit = params.get('unit') || ctx.unitIds[0];
  assertUnit(ctx, unit);
  if (professional) z.uuid().parse(professional);
  const where = {
    professional: "i.route='PROFESSIONAL' AND i.state='PENDING'",
    coordination: "i.route='COORDINATION' AND i.state='PENDING'",
    scheduling: "i.state='ACCEPTED'",
    accepted: "i.state IN('SCHEDULED','RESOLVED')",
    all: "i.state<>'SUPERSEDED'",
  }[view];
  const data = await query(
    itemSelect +
      ` WHERE i.tenant_id=$1 AND i.unit_id=$2 AND ${where} AND ($3::uuid IS NULL OR i.professional_id=$3) ORDER BY i.created_at DESC,i.position LIMIT 300`,
    [ctx.tenantId, unit, professional || null],
  );
  const [s] = await query(
    "SELECT count(*) FILTER(WHERE route='PROFESSIONAL' AND state='PENDING')::int AS pending,count(*) FILTER(WHERE route='COORDINATION' AND state='PENDING')::int AS coordination,count(*) FILTER(WHERE state='ACCEPTED')::int AS scheduling,count(*) FILTER(WHERE state IN('SCHEDULED','RESOLVED') AND updated_at>now()-interval '30 days')::int AS accepted FROM referral_items WHERE tenant_id=$1 AND unit_id=$2",
    [ctx.tenantId, unit],
  );
  const professionals = await query(
    'SELECT id,name,specialty FROM professionals WHERE tenant_id=$1 AND unit_id=$2 AND active=true ORDER BY name',
    [ctx.tenantId, unit],
  );
  return {
    data,
    summary: s,
    own: null,
    canManage: true,
    canResolve: managers.includes(ctx.role),
    professionals,
  };
}
export async function referralCount(ctx: Context, unit: string) {
  if (ctx.role === 'CLINICIAN') {
    const [r] = await query(
      "SELECT count(*)::int AS n FROM referral_items i JOIN professionals p ON p.id=i.professional_id AND p.tenant_id=i.tenant_id WHERE i.tenant_id=$1 AND i.state='PENDING' AND p.metadata->>'user_id'=$2",
      [ctx.tenantId, ctx.userId],
    );
    return r.n as number;
  }
  if (!receptionRoles.includes(ctx.role)) return 0;
  const [r] = await query(
    "SELECT count(*)::int AS n FROM referral_items WHERE tenant_id=$1 AND unit_id=$2 AND (state='PENDING' OR state='ACCEPTED' AND proposal_id IS NULL)",
    [ctx.tenantId, unit],
  );
  return r.n as number;
}
const actionSchema = z.discriminatedUnion('action', [
  z
    .object({
      action: z.literal('accept'),
      version: z.number().int().positive(),
      note: z.string().trim().max(500).default(''),
    })
    .strict(),
  z
    .object({
      action: z.literal('decline'),
      version: z.number().int().positive(),
      note: z.string().trim().min(5, 'Explique o motivo em poucas palavras.').max(500),
    })
    .strict(),
  z
    .object({
      action: z.literal('assign'),
      version: z.number().int().positive(),
      professional_id: z.uuid(),
      note: z.string().trim().max(500).default(''),
    })
    .strict(),
  z
    .object({
      action: z.literal('resolve'),
      version: z.number().int().positive(),
      note: z.string().trim().min(5, 'Registre o que foi combinado com a família.').max(500),
    })
    .strict(),
]);
export async function actOnReferral(ctx: Context, id: string, input: unknown) {
  permit(ctx, [...receptionRoles, 'CLINICIAN']);
  const d = actionSchema.parse(input);
  z.uuid().parse(id);
  return transaction(async (c) => {
    const {
      rows: [item],
    } = await c.query(
      "SELECT i.*,p.metadata->>'user_id' AS professional_user_id FROM referral_items i LEFT JOIN professionals p ON p.id=i.professional_id AND p.tenant_id=i.tenant_id WHERE i.tenant_id=$1 AND i.id=$2 FOR UPDATE OF i",
      [ctx.tenantId, id],
    );
    const mine = !!item && item.professional_user_id === ctx.userId;
    if (!item || (ctx.role === 'CLINICIAN' ? !mine : !ctx.unitIds.includes(item.unit_id)))
      throw new ApiError(404, 'Encaminhamento não encontrado.');
    if (item.version !== d.version)
      throw new ApiError(409, 'Este encaminhamento mudou. Atualize a lista.');
    if (item.state !== 'PENDING') throw new ApiError(409, 'Este encaminhamento já foi concluído.');
    let professionalId: string | null = item.professional_id,
      route = item.route,
      state = 'PENDING';
    if (d.action === 'accept') {
      if (item.route !== 'PROFESSIONAL')
        throw new ApiError(422, 'Atribua um profissional antes de aceitar.');
      state = 'ACCEPTED';
    } else if (d.action === 'decline') {
      if (item.route !== 'PROFESSIONAL')
        throw new ApiError(422, 'Este item já está com a coordenação clínica.');
      professionalId = null;
      route = 'COORDINATION';
    } else if (d.action === 'assign') {
      if (ctx.role === 'CLINICIAN')
        throw new ApiError(403, 'Somente a recepção ou a gestão redistribuem encaminhamentos.');
      const {
        rows: [p],
      } = await c.query(
        'SELECT id,name FROM professionals WHERE tenant_id=$1 AND unit_id=$2 AND id=$3 AND active=true',
        [ctx.tenantId, item.unit_id, d.professional_id],
      );
      if (!p) throw new ApiError(422, 'Profissional inativo ou de outra unidade.');
      professionalId = p.id;
      route = 'PROFESSIONAL';
    } else {
      if (!managers.includes(ctx.role))
        throw new ApiError(
          403,
          'Somente a coordenação clínica (gestão) encerra itens sem profissional.',
        );
      if (item.route !== 'COORDINATION')
        throw new ApiError(422, 'Itens com profissional são concluídos pelo aceite.');
      state = 'RESOLVED';
    }
    const entry = {
      at: new Date().toISOString(),
      action: d.action.toUpperCase(),
      by: ctx.name,
      note: d.note,
      ...(d.action === 'assign' ? { professional_id: professionalId } : {}),
      ...(d.action === 'decline' ? { professional_id: item.professional_id } : {}),
    };
    const {
      rows: [row],
    } = await c.query(
      "UPDATE referral_items SET professional_id=$3,route=$4,state=$5,history=history||$6::jsonb,decided_by=CASE WHEN $5<>'PENDING' THEN $7::uuid ELSE decided_by END,decided_at=CASE WHEN $5<>'PENDING' THEN now() ELSE decided_at END,version=version+1,updated_at=now() WHERE tenant_id=$1 AND id=$2 RETURNING id,state,route,professional_id,version",
      [ctx.tenantId, id, professionalId, route, state, JSON.stringify([entry]), ctx.userId],
    );
    await audit(c, ctx, 'referral.' + d.action, 'referral_items', id, item.unit_id, {
      professionalId,
      note: d.note || undefined,
    });
    return row;
  });
}
