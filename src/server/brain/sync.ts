import { query } from '@/lib/db';
import { clinicRules, familyStyle } from '@/server/ai/clinic-prompt';
import { tenantSpecialties } from '@/server/specialties';
import { brain, brainConfig } from './client';

// Leva a configuração da clínica para o brain-desk: persona com as regras da clínica, filas,
// agentes, cenários publicados, o servidor de ferramentas e o webhook. Rode depois de mudar
// agentes/cenários (npm run brain:sync) ou quando o brain for instalado.

export async function syncTenantToBrain(tenantId: string) {
  const cfg = brainConfig();
  const [tenant] = await query('SELECT name FROM tenants WHERE id=$1', [tenantId]);
  const specialties = (await tenantSpecialties(tenantId)).filter((s) => s.active);
  const persona = [
    `Você é um assistente administrativo da clínica ${tenant.name}. Responda em português com acolhimento e objetividade.`,
    ...clinicRules({ switchTool: 'acionar_agente', finalTool: 'finalizar_atendimento' }),
    `ESPECIALIDADES DA CLÍNICA (use somente estes códigos nas ferramentas): ${specialties.map((s) => s.code + '=' + s.name).join('; ')}.`,
    familyStyle,
    `Filas humanas da clínica: recepcao (recepção e dúvidas gerais), agenda (propostas de horário e planos de encaminhamento), convenios (documentos e convênios), clinica (coordenação clínica: dúvidas clínicas, trocas de profissional), auditoria, financeiro. Na decisão use o código da fila em destination; o motivo CLINICAL_REVIEW da clínica corresponde a SPECIALIST_REVIEW aqui.`,
  ].join('\n\n');
  await brain('atualizar_configuracao', {
    nome: tenant.name,
    persona,
    estilo: {
      max_perguntas: 2,
      max_caracteres: 900,
      termos_proibidos: ['PROMPT'],
      transferir_sem_pergunta: true,
    },
    politica_dados: { anexos_para_ia: true },
  });

  const queues = await query(
    'SELECT DISTINCT ON (code) code,name FROM service_queues WHERE tenant_id=$1 AND active=true ORDER BY code,sort_order',
    [tenantId],
  );
  for (const q of queues) await brain('salvar_fila', { codigo: q.code, nome: q.name });
  await brain('atualizar_configuracao', {
    fila_padrao: queues.some((q) => q.code === 'recepcao') ? 'recepcao' : (queues[0]?.code ?? null),
  });
  await brain('salvar_fila', {
    codigo: 'atendimento',
    nome: 'Atendimento humano',
    ativa: false,
  }).catch(() => undefined);

  const agents = await query(
    "SELECT name,specialty,instructions,knowledge,enabled,confidence_threshold,use_scenarios FROM agents WHERE tenant_id=$1 AND archived_at IS NULL ORDER BY (specialty='triagem') DESC,name",
    [tenantId],
  );
  for (const a of agents)
    await brain('salvar_agente', {
      codigo: a.specialty,
      nome: a.name,
      descricao: `Agente ${a.specialty} da clínica.`,
      instrucoes: a.instructions,
      conhecimento: a.knowledge,
      ativo: a.enabled,
      padrao: a.specialty === 'triagem',
      limite_confianca: a.confidence_threshold,
      usar_cenarios: a.use_scenarios,
    });
  if (!agents.some((a) => a.specialty === 'triagem'))
    await brain('salvar_agente', {
      codigo: 'triagem',
      nome: 'Acolhimento e triagem',
      instrucoes: 'Sem uso: a clínica não tem agente de triagem.',
      ativo: false,
    }).catch(() => undefined);

  const scenarios = await query(
    "SELECT id,title,situation,guidance,example,avoid,tags,agent_specialties,test_message,expected_action,expected_destination,status FROM ai_scenarios WHERE tenant_id=$1 AND status<>'ARCHIVED'",
    [tenantId],
  );
  for (const s of scenarios)
    await brain('salvar_cenario', {
      referencia_externa: s.id,
      titulo: s.title,
      situacao: s.situation,
      como_lidar: s.guidance,
      exemplo: s.example,
      evitar: s.avoid,
      tags: s.tags,
      agentes: s.agent_specialties,
      mensagem_teste: s.test_message,
      acao_esperada: s.expected_action,
      destino_esperado: s.expected_destination === 'AI' ? 'ai' : s.expected_destination,
      status: s.status,
    });

  const origin = (process.env.APP_ORIGIN || 'http://localhost:3005').replace(/\/$/, '');
  await brain('salvar_servidor_ferramentas', {
    nome: 'integrar',
    url: origin + '/api/brain/mcp',
    segredo: cfg.toolsSecret,
  });
  await brain('salvar_webhook', { url: origin + '/api/brain/eventos', segredo: cfg.webhookSecret });
  const test = await brain('testar_servidor_ferramentas', { nome: 'integrar' }).catch(
    (e: Error) => ({ ok: false, erro: e.message }),
  );
  return {
    filas: queues.length,
    agentes: agents.length,
    cenarios: scenarios.length,
    ferramentas: test,
  };
}
