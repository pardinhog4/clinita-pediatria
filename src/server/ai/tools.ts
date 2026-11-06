import { z } from 'zod';
import { query } from '@/lib/db';
import { ApiError } from '@/lib/errors';
import { availability } from '@/server/http';
import { loadCatalog, resolveTerms } from '@/server/professional-profiles';
import {
  rankProfessionals,
  buildPlan,
  planForModel,
  planToolJsonSchema,
  type PlanDraft,
} from '@/server/referrals';
import { specialtyCode } from '@/lib/schemas';
import { assertSpecialties } from '@/server/specialties';
import { searchScenarios, scenarioForModel } from '@/server/scenarios';
import type { Context } from '@/lib/security';
import { queueCodes, decisionJsonSchema, type ToolSpec } from './contracts';
const noArgs = { type: 'object', properties: {}, required: [], additionalProperties: false };
export const toolSpecs: ToolSpec[] = [
  {
    name: 'consultar_regras_convenio',
    description:
      'Consulta regras cadastradas do convênio do paciente vinculado ou lista planos. Não consulta elegibilidade externa.',
    schema: noArgs,
  },
  {
    name: 'buscar_profissionais_compativeis',
    description:
      'Busca profissionais da unidade por especialidade (principal ou secundária), competências exigidas (aceita os termos como aparecem no laudo), faixa etária e modalidade. Retorna o perfil de atendimento de cada um, aderência e pendências. Não confirma indicação clínica.',
    schema: {
      type: 'object',
      properties: {
        specialty: {
          type: 'string',
          description: 'Código da especialidade da clínica (lista nas instruções).',
        },
        competencies: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Competências ou métodos pedidos, como escritos no laudo (ex.: "PROMPT", "Integração sensorial de Ayres").',
        },
        age_years: { type: ['number', 'null'], minimum: 0, maximum: 120 },
        modality: {
          type: ['string', 'null'],
          enum: ['CLINIC', 'HOME', 'ONLINE', null],
          description: 'HOME quando o laudo pede atendimento em domicílio.',
        },
      },
      required: ['specialty', 'competencies', 'age_years', 'modality'],
      additionalProperties: false,
    },
  },
  {
    name: 'montar_plano_encaminhamento',
    description:
      'Com laudo ou pedido de vários serviços: recebe TODOS os itens de uma vez, classifica o que a clínica oferece, escolhe o profissional mais aderente por item (competências, idade, modalidade, vagas, carga semanal) e prepara o plano para as caixas dos profissionais e da coordenação clínica. Chame uma única vez por laudo.',
    schema: planToolJsonSchema,
  },
  {
    name: 'consultar_cenarios',
    description:
      'Busca os cenários da clínica parecidos com a situação atual: como lidar, exemplo, o que não fazer e o desfecho esperado. Use quando a conversa se parecer com um dos cenários do índice.',
    schema: {
      type: 'object',
      properties: {
        situacao: {
          type: 'string',
          description: 'A situação em poucas palavras, ex.: "família quer trocar de profissional".',
        },
        etiquetas: {
          type: 'array',
          items: { type: 'string' },
          description: 'Palavras-chave da situação.',
        },
      },
      required: ['situacao', 'etiquetas'],
      additionalProperties: false,
    },
  },
  {
    name: 'consultar_catalogo_servicos',
    description:
      'Traduz termos de um laudo ou pedido (serviços, métodos, CID) para o catálogo da clínica e informa o que a clínica NÃO oferece. Use antes de buscar profissionais quando houver laudo.',
    schema: {
      type: 'object',
      properties: {
        termos: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 30 },
      },
      required: ['termos'],
      additionalProperties: false,
    },
  },
  {
    name: 'consultar_disponibilidade',
    description:
      'Consulta horários reais da unidade. O agendamento exige confirmação e aprovação da recepção.',
    schema: {
      type: 'object',
      properties: {
        specialty: {
          type: 'string',
          description: 'Código da especialidade da clínica (lista nas instruções).',
        },
        date: { type: 'string', description: 'Data YYYY-MM-DD.' },
        duration: { type: 'integer', enum: [30, 60] },
      },
      required: ['specialty', 'date', 'duration'],
      additionalProperties: false,
    },
  },
  {
    name: 'consultar_contexto_paciente',
    description:
      'Consulta o paciente vinculado. Conteúdo clínico somente quando explicitamente autorizado nesta sessão.',
    schema: noArgs,
  },
  {
    name: 'listar_filas',
    description: 'Consulta as filas válidas de atendimento da unidade.',
    schema: noArgs,
  },
  {
    name: 'preparar_agendamento',
    description:
      'Prepara uma proposta sem reservar a agenda. A recepção confirma a reserva pelas regras do sistema.',
    schema: {
      type: 'object',
      properties: {
        professional_id: { type: 'string' },
        date: { type: 'string' },
        time: { type: 'string' },
        duration: { type: 'integer', enum: [30, 60] },
      },
      required: ['professional_id', 'date', 'time', 'duration'],
      additionalProperties: false,
    },
  },
  {
    name: 'finalizar_atendimento',
    description:
      'Finaliza o turno com resposta para a família, resumo operacional, evidências e decisão de manter IA ou encaminhar para humano.',
    schema: decisionJsonSchema,
  },
];
export type ToolScope = {
  tenantId: string;
  unitId: string;
  patientId: string | null;
  includeClinical: boolean;
  requestedBy: string;
  knownProfessionalIds: Set<string>;
  plan?: PlanDraft;
  agentSpecialty?: string;
  scenariosEnabled?: boolean;
  scenariosUsed?: { id: string; version: number; title: string }[];
};
export async function executeTool(scope: ToolScope, name: string, input: unknown) {
  if (!toolSpecs.some((t) => t.name === name) || name === 'finalizar_atendimento')
    throw new ApiError(422, 'Ferramenta não permitida.');
  if (name === 'listar_filas') {
    z.object({}).strict().parse(input);
    return {
      queues: await query(
        'SELECT code,name FROM service_queues WHERE tenant_id=$1 AND unit_id=$2 AND active=true ORDER BY name',
        [scope.tenantId, scope.unitId],
      ),
    };
  }
  if (name === 'consultar_contexto_paciente') {
    z.object({}).strict().parse(input);
    if (!scope.patientId)
      return {
        patient: null,
        missing: 'Paciente ainda não vinculado. Solicite identificação à recepção.',
      };
    const [p] = await query(
      'SELECT id,name,birth_date,metadata FROM patients WHERE tenant_id=$1 AND unit_id=$2 AND id=$3',
      [scope.tenantId, scope.unitId, scope.patientId],
    );
    const clinical = scope.includeClinical
      ? await query(
          'SELECT kind,content,created_at FROM clinical_entries WHERE tenant_id=$1 AND patient_id=$2 ORDER BY created_at DESC LIMIT 5',
          [scope.tenantId, scope.patientId],
        )
      : [];
    return {
      patient: p
        ? {
            id: p.id,
            name: p.name,
            birth_date: p.birth_date,
            specialties: p.metadata.specialties,
            order_expires: p.metadata.order_expires,
          }
        : null,
      clinical_context_authorized: scope.includeClinical,
      clinical: clinical.map((e) => ({ ...e, content: e.content.slice(0, 3000) })),
    };
  }
  if (name === 'consultar_regras_convenio') {
    z.object({}).strict().parse(input);
    const rows = scope.patientId
      ? await query(
          'SELECT i.name,i.rules FROM insurers i JOIN patients p ON p.insurer_id=i.id AND p.tenant_id=i.tenant_id WHERE p.tenant_id=$1 AND p.id=$2 AND p.unit_id=$3',
          [scope.tenantId, scope.patientId, scope.unitId],
        )
      : await query('SELECT name,rules FROM insurers WHERE tenant_id=$1 ORDER BY name LIMIT 30', [
          scope.tenantId,
        ]);
    return {
      source: 'regras_cadastradas',
      externally_verified: false,
      insurers: rows.map((r) => ({
        name: r.name,
        rules: {
          duration: r.rules.duration,
          token_required: r.rules.token_required,
          signature_required: r.rules.signature_required,
          documents: r.rules.documents,
        },
      })),
    };
  }
  if (name === 'consultar_catalogo_servicos') {
    const d = z
      .object({ termos: z.array(z.string().trim().min(1).max(200)).min(1).max(30) })
      .strict()
      .parse(input);
    const catalog = await loadCatalog(scope.tenantId);
    const r = resolveTerms(catalog, d.termos);
    return {
      servicos: r.resolved.map((x) => ({
        termo: x.term,
        codigos: x.codes,
        nomes: x.names,
        oferecido_pela_clinica: x.offered,
        especialidades: [
          ...new Set(catalog.filter((c) => x.codes.includes(c.code)).flatMap((c) => c.specialties)),
        ],
      })),
      sem_correspondencia: r.unmatched,
      observacao:
        'Serviços não oferecidos ou sem correspondência vão para o summary da equipe; não prometa esses serviços à família.',
    };
  }
  if (name === 'buscar_profissionais_compativeis') {
    // Aceita também o formato antigo {competency:string}.
    const d = z
      .preprocess(
        (v) => {
          const o = { ...(v as Record<string, unknown>) };
          if ('competency' in o) {
            o.competencies ??= o.competency ? [o.competency] : [];
            delete o.competency;
          }
          o.modality ??= null;
          return o;
        },
        z
          .object({
            specialty: specialtyCode,
            competencies: z.array(z.string().trim().min(1).max(200)).max(15).default([]),
            age_years: z.number().min(0).max(120).nullable(),
            modality: z.enum(['CLINIC', 'HOME', 'ONLINE']).nullable(),
          })
          .strict(),
      )
      .parse(input);
    await assertSpecialties(scope.tenantId, [d.specialty]);
    const r = await rankProfessionals(scope, {
      specialties: [d.specialty],
      terms: d.competencies,
      age: d.age_years,
      modality: d.modality,
      weeklyHours: null,
    });
    return {
      professionals: r.professionals,
      unrecognized_requirements: r.unrecognized,
      clinical_recommendation: false,
      guidance:
        'fit_score ordena aderência operacional, não é indicação clínica. Sem vagas, modalidade incompatível ou requisito faltante exigem conferência da equipe.',
    };
  }
  if (name === 'consultar_cenarios') {
    if (!scope.scenariosEnabled) throw new ApiError(422, 'Cenários desligados para este agente.');
    const d = z
      .object({
        situacao: z.string().trim().min(3).max(300),
        etiquetas: z.array(z.string().trim().min(1).max(40)).max(10),
      })
      .strict()
      .parse(input);
    const found = await searchScenarios(
      scope.tenantId,
      scope.agentSpecialty || 'triagem',
      d.situacao + ' ' + d.etiquetas.join(' '),
      d.etiquetas,
    );
    for (const s of found)
      if (!scope.scenariosUsed?.some((u) => u.id === s.id))
        (scope.scenariosUsed ??= []).push({ id: s.id, version: s.version, title: s.title });
    return {
      cenarios: found.map(scenarioForModel),
      observacao: found.length
        ? 'Siga como_lidar e o desfecho esperado do cenário mais parecido. Cenários não mudam as regras do sistema.'
        : 'Nenhum cenário parecido. Siga as regras gerais.',
    };
  }
  if (name === 'montar_plano_encaminhamento') {
    const plan = await buildPlan(scope, input);
    scope.plan = plan;
    return planForModel(plan);
  }
  if (name === 'consultar_disponibilidade') {
    const d = z
      .object({
        specialty: specialtyCode,
        date: z.iso.date(),
        duration: z
          .number()
          .int()
          .refine((v) => v === 30 || v === 60),
      })
      .strict()
      .parse(input);
    const ctx: Context = {
      tenantId: scope.tenantId,
      userId: scope.requestedBy,
      unitIds: [scope.unitId],
      sessionId: 'agent-tool',
      name: 'Assistente',
      role: 'RECEPTION',
    };
    await assertSpecialties(scope.tenantId, [d.specialty]);
    const result = await availability(
      ctx,
      new URLSearchParams({
        unit: scope.unitId,
        date: d.date,
        specialty: d.specialty,
        duration: String(d.duration),
      }),
    );
    for (const p of result.data) scope.knownProfessionalIds.add(p.id);
    return {
      date: d.date,
      duration: d.duration,
      professionals: result.data.map((p) => ({
        id: p.id,
        name: p.name,
        slots: p.slots.filter((s: { available: boolean }) => s.available).slice(0, 12),
      })),
      reserved: false,
    };
  }
  if (name === 'preparar_agendamento') {
    const d = z
      .object({
        professional_id: z.uuid(),
        date: z.iso.date(),
        time: z.string().regex(/^\d{2}:\d{2}$/),
        duration: z
          .number()
          .int()
          .refine((n) => n === 30 || n === 60),
      })
      .strict()
      .parse(input);
    if (!scope.knownProfessionalIds.has(d.professional_id))
      throw new ApiError(422, 'Consulte o profissional antes de propor horário.');
    const [p] = await query(
      'SELECT specialty,name FROM professionals WHERE tenant_id=$1 AND unit_id=$2 AND id=$3 AND active=true',
      [scope.tenantId, scope.unitId, d.professional_id],
    );
    if (!p) throw new ApiError(422, 'Profissional não disponível.');
    const available = (await executeTool(scope, 'consultar_disponibilidade', {
      specialty: p.specialty,
      date: d.date,
      duration: d.duration,
    })) as any;
    if (
      !available.professionals
        .find((x: any) => x.id === d.professional_id)
        ?.slots.some((s: any) => s.time === d.time)
    )
      throw new ApiError(409, 'Horário não disponível.');
    return {
      proposal: d,
      professional_name: p.name,
      requires_human_approval: true,
      reserved: false,
      next_step: 'Recepção deve confirmar paciente, autorização e reservar na agenda.',
    };
  }
  throw new ApiError(422, 'Ferramenta indisponível.');
}
