// Dados padrão de uma clínica nova: catálogo de competências, cenários da IA e agentes.
// Extraídos da configuração vigente em 04/11/2026 (migrações 012, 016 e 017). Usados por provisionTenant.
export const defaultCatalog = [
  {
    code: 'aba',
    name: 'Análise do Comportamento Aplicada (ABA)',
    description: 'Intervenção comportamental com planejamento por objetivos e registro de dados.',
    synonyms: [
      'ABA',
      'análise do comportamento',
      'analise comportamental aplicada',
      'intervenção comportamental',
    ],
    specialties: ['aba', 'psico', 'psped'],
    offered: true,
  },
  {
    code: 'aprend',
    name: 'Transtornos de aprendizagem',
    description: 'Dislexia, discalculia e dificuldades escolares.',
    synonyms: [
      'aprendizagem',
      'transtornos de aprendizagem',
      'dislexia',
      'discalculia',
      'dificuldade escolar',
      'educação especial',
      'educação inclusiva',
      'F81',
    ],
    specialties: ['psped', 'fono', 'psico'],
    offered: true,
  },
  {
    code: 'at_domicilio',
    name: 'Acompanhante terapêutico em domicílio',
    description: 'Aplicação de programa terapêutico na casa da família por assistente terapêutico.',
    synonyms: [
      'assistente terapêutico',
      'acompanhante terapêutico',
      'AT',
      'domicílio',
      'em domicílio',
      'home care',
    ],
    specialties: ['aba'],
    offered: true,
  },
  {
    code: 'bandagem',
    name: 'Bandagem elástica terapêutica',
    description: 'Uso de bandagem para facilitação muscular e postural.',
    synonyms: ['bandagem', 'kinesio', 'taping'],
    specialties: ['fisio'],
    offered: true,
  },
  {
    code: 'caa',
    name: 'Comunicação Aumentativa e Alternativa (CAA)',
    description: 'Recursos e pranchas de comunicação para quem não fala ou fala pouco.',
    synonyms: [
      'CAA',
      'comunicação alternativa',
      'comunicação aumentativa',
      'comunicação aumentativa e alternativa',
      'prancha de comunicação',
      'não verbal',
    ],
    specialties: ['fono', 'aba', 'to'],
    offered: true,
  },
  {
    code: 'cfon',
    name: 'Consciência fonológica e alfabetização',
    description: 'Habilidades fonológicas que sustentam leitura e escrita.',
    synonyms: ['consciência fonológica', 'alfabetização', 'leitura e escrita'],
    specialties: ['fono', 'psped'],
    offered: true,
  },
  {
    code: 'denver',
    name: 'Modelo Denver de Intervenção Precoce (ESDM)',
    description:
      'Intervenção naturalística para crianças pequenas, centrada em brincadeira e rotina.',
    synonyms: ['Denver', 'ESDM', 'Early Start Denver Model', 'intervenção precoce'],
    specialties: ['aba', 'psico', 'to', 'fono'],
    offered: true,
  },
  {
    code: 'down',
    name: 'Síndrome de Down',
    description: 'Experiência com desenvolvimento global na síndrome de Down.',
    synonyms: ['síndrome de Down', 'trissomia 21', 'Q90'],
    specialties: ['fono', 'fisio', 'to', 'psped'],
    offered: true,
  },
  {
    code: 'equoterapia',
    name: 'Equoterapia',
    description: 'Terapia com cavalos. A clínica não oferece este serviço.',
    synonyms: ['equoterapia', 'terapia com cavalos', 'hipoterapia'],
    specialties: [],
    offered: false,
  },
  {
    code: 'is',
    name: 'Integração sensorial de Ayres',
    description: 'Intervenção para processamento e modulação sensorial (certificação Ayres).',
    synonyms: [
      'integração sensorial',
      'integracao sensorial',
      'Ayres',
      'processamento sensorial',
      'IS',
      'disfunção sensorial',
    ],
    specialties: ['to'],
    offered: true,
  },
  {
    code: 'jasper',
    name: 'JASPER · atenção compartilhada',
    description: 'Intervenção em atenção compartilhada, brincar simbólico e regulação.',
    synonyms: ['JASPER', 'atenção compartilhada', 'brincar simbólico'],
    specialties: ['psico', 'aba'],
    offered: true,
  },
  {
    code: 'linguagem',
    name: 'Atraso e transtorno de linguagem',
    description: 'Desenvolvimento da linguagem oral, compreensão e expressão.',
    synonyms: [
      'atraso de fala',
      'atraso de linguagem',
      'transtorno de linguagem',
      'não adquiriu a fala',
      'F80',
      'F80.8',
      'desenvolvimento da linguagem',
    ],
    specialties: ['fono'],
    offered: true,
  },
  {
    code: 'mof',
    name: 'Motricidade orofacial',
    description:
      'Reabilitação da musculatura da face e da boca: sucção, mastigação, deglutição e fala.',
    synonyms: [
      'motricidade orofacial',
      'motora oral',
      'reabilitação motora oral',
      'miofuncional',
      'deglutição',
    ],
    specialties: ['fono'],
    offered: true,
  },
  {
    code: 'neurologia',
    name: 'Consulta com neurologista pediátrico',
    description: 'Acompanhamento médico. Não faz parte das terapias da clínica.',
    synonyms: ['neurologista', 'neuropediatra', 'neurologia pediátrica'],
    specialties: [],
    offered: false,
  },
  {
    code: 'neuroped',
    name: 'Fisioterapia neuropediátrica',
    description: 'Atendimento motor de crianças com alterações neurológicas e hipotonia.',
    synonyms: [
      'fisioterapia motora',
      'fisioterapia infantil',
      'neuropediátrica',
      'hipotonia',
      'atraso motor',
      'fisioterapia neurológica',
    ],
    specialties: ['fisio'],
    offered: true,
  },
  {
    code: 'pecs',
    name: 'PECS · comunicação por troca de figuras',
    description: 'Sistema de comunicação por troca de figuras para não verbais.',
    synonyms: ['PECS', 'troca de figuras'],
    specialties: ['aba', 'fono'],
    offered: true,
  },
  {
    code: 'prompt',
    name: 'Método PROMPT',
    description: 'Abordagem tátil-cinestésica para produção da fala (apraxia, atraso de fala).',
    synonyms: ['PROMPT', 'apraxia de fala', 'apraxia', 'produção de fala'],
    specialties: ['fono'],
    offered: true,
  },
  {
    code: 'psicomot',
    name: 'Psicomotricidade',
    description:
      'Desenvolvimento motor global, esquema corporal e coordenação por meio do movimento.',
    synonyms: ['psicomotricidade', 'psicomotricista', 'coordenação motora'],
    specialties: ['to', 'fisio', 'psped'],
    offered: true,
  },
  {
    code: 'supervisao',
    name: 'Supervisão clínica',
    description: 'Supervisão de casos e de assistentes terapêuticos.',
    synonyms: ['supervisão', 'supervisor', 'supervisão fonoaudiológica', 'supervisão Denver'],
    specialties: ['fono', 'aba', 'psico', 'to'],
    offered: true,
  },
  {
    code: 'talim',
    name: 'Terapia alimentar',
    description: 'Ampliação de repertório alimentar e manejo de seletividade.',
    synonyms: [
      'terapia alimentar',
      'seletividade alimentar',
      'alimentação',
      'introdução alimentar',
      'textura dos alimentos',
    ],
    specialties: ['fono', 'to', 'nutri'],
    offered: true,
  },
  {
    code: 'tcc',
    name: 'Terapia Cognitivo-Comportamental (TCC)',
    description: 'Psicoterapia estruturada para emoções, ansiedade e comportamento.',
    synonyms: ['TCC', 'cognitivo-comportamental', 'terapia cognitiva'],
    specialties: ['psico'],
    offered: true,
  },
  {
    code: 'tdah',
    name: 'TDAH',
    description: 'Experiência com atenção, impulsividade e funções executivas.',
    synonyms: ['TDAH', 'déficit de atenção', 'hiperatividade', 'F90'],
    specialties: ['psico', 'psped', 'to'],
    offered: true,
  },
  {
    code: 'tea',
    name: 'Transtorno do Espectro Autista',
    description: 'Experiência clínica com crianças e adolescentes no espectro autista.',
    synonyms: ['autismo', 'espectro autista', 'TEA', 'F84', 'F84.0', 'transtorno do espectro'],
    specialties: ['fono', 'psico', 'to', 'aba', 'psped', 'fisio', 'nutri'],
    offered: true,
  },
  {
    code: 'therasuit',
    name: 'Método TheraSuit',
    description: 'Protocolo intensivo de fisioterapia com vestimenta terapêutica.',
    synonyms: ['TheraSuit', 'Pediasuit', 'protocolo intensivo'],
    specialties: ['fisio'],
    offered: true,
  },
  {
    code: 'tod',
    name: 'Transtorno Opositor Desafiador',
    description: 'Manejo de comportamento opositor e orientação parental.',
    synonyms: ['TOD', 'opositor', 'desafiador', 'comportamento desafiador'],
    specialties: ['psico', 'aba'],
    offered: true,
  },
  {
    code: 'vbmapp',
    name: 'Avaliação VB-MAPP',
    description: 'Avaliação de marcos de linguagem e comportamento verbal.',
    synonyms: ['VB-MAPP', 'VBMAPP', 'comportamento verbal'],
    specialties: ['aba', 'fono'],
    offered: true,
  },
];
export const defaultScenarios = [
  {
    title: 'Desmarcar ou remarcar sessão',
    situation:
      'A família pede para desmarcar, cancelar ou mudar o horário de uma sessão já agendada.',
    guidance:
      '1) Agradeça o aviso. 2) Diga que a agenda vai registrar e confirmar com a família (e propor novo horário, se for remarcação). 3) Encaminhe já para a fila agenda com motivo OPERATIONAL_ACTION, registrando no resumo o dia e a terapia citados. 4) Não peça nome nem detalhes: a recepção localiza pelo contato.',
    example:
      'Família: Preciso desmarcar a sessão de quinta.\\nIA: Tudo bem, vou passar para a nossa agenda registrar o cancelamento e te confirmar.',
    avoid: 'Não diga que a sessão já foi cancelada ou remarcada: isso exige a equipe.',
    test_message: 'Preciso desmarcar a sessão de quinta-feira da minha filha.',
    expected_action: 'HANDOFF',
    expected_destination: 'agenda',
    tags: ['desmarcar', 'cancelar sessão', 'remarcar', 'falta', 'reagendar'],
    agent_specialties: [],
  },
  {
    title: 'Dúvida clínica ou sobre a terapia',
    situation:
      'A família pergunta sobre sintomas, evolução, efeitos da terapia, se deve parar, aumentar ou mudar algo no tratamento.',
    guidance:
      '1) Acolha a preocupação. 2) Diga que essa orientação precisa ser dada por um profissional da clínica. 3) Encaminhe para a fila clinica com motivo CLINICAL_REVIEW.',
    example:
      'Família: Meu filho está chorando muito depois da terapia, é normal?\\nIA: Entendo sua preocupação. Vou passar para a coordenação clínica, que vai te orientar com segurança.',
    avoid: 'Não dê opinião clínica, não diga que é normal e não recomende parar ou continuar.',
    test_message:
      'Meu filho começou a ter crises de choro depois da terapia, é normal? Devo parar?',
    expected_action: 'HANDOFF',
    expected_destination: 'clinica',
    tags: ['dúvida clínica', 'sintoma', 'evolução', 'terapia', 'parar tratamento'],
    agent_specialties: [],
  },
  {
    title: 'Família manda só uma saudação',
    situation:
      'A primeira mensagem é apenas "oi", "bom dia" ou uma apresentação, sem dizer o que precisa.',
    guidance:
      '1) Cumprimente de volta pelo período do dia. 2) Pergunte em uma frase como pode ajudar. 3) Não consulte paciente, convênio nem profissionais ainda.',
    example: 'Família: Oi, bom dia!\\nIA: Bom dia! Aqui é da Integrar. Como posso ajudar?',
    avoid:
      'Não cite nomes de pacientes vinculados. Não ofereça lista de serviços sem a família pedir.',
    test_message: 'Oi, bom dia!',
    expected_action: 'ASK_USER',
    expected_destination: 'AI',
    tags: ['saudação', 'oi', 'bom dia', 'início'],
    agent_specialties: [],
  },
  {
    title: 'Família pede para falar com uma pessoa',
    situation:
      'A família pede expressamente um atendente humano, uma pessoa ou alguém da recepção.',
    guidance:
      '1) Respeite o pedido sem insistir. 2) Avise em uma frase que vai chamar a equipe. 3) Encaminhe para a recepção com motivo USER_REQUEST e um resumo do que já foi dito.',
    example:
      'Família: Quero falar com uma pessoa.\\nIA: Claro! Vou chamar alguém da nossa equipe para continuar com você.',
    avoid: 'Não tente resolver antes de transferir. Não pergunte o motivo do pedido.',
    test_message: 'Quero falar com uma pessoa, por favor.',
    expected_action: 'HANDOFF',
    expected_destination: 'recepcao',
    tags: ['atendente', 'humano', 'pessoa', 'recepção'],
    agent_specialties: [],
  },
  {
    title: 'Pedido médico ou laudo sem idade informada',
    situation:
      'A família conta que tem pedido médico ou laudo para terapias, mas ainda não disse a idade da criança nem o convênio.',
    guidance:
      '1) Agradeça e diga que vai organizar o atendimento. 2) Pergunte idade e convênio (ou particular) numa única mensagem. 3) Se houver documento anexado, leia antes de perguntar. 4) Só monte o plano quando souber a idade.',
    example:
      'Família: Tenho um pedido de fono e TO para meu filho.\\nIA: Que bom que nos procurou! Para organizar, me diga a idade dele e se o atendimento será pelo convênio ou particular?',
    avoid:
      'Não busque profissionais nem cite nomes antes de saber a idade. Não faça mais de duas perguntas.',
    test_message:
      'Tenho um pedido médico de fono e terapia ocupacional para meu filho. Vocês atendem?',
    expected_action: 'ASK_USER',
    expected_destination: 'AI',
    tags: ['laudo', 'pedido médico', 'encaminhamento', 'idade', 'terapias'],
    agent_specialties: [],
  },
  {
    title: 'Pergunta se a clínica aceita um convênio',
    situation: 'A família quer saber se a clínica atende pelo convênio dela.',
    guidance:
      '1) Consulte as regras de convênio cadastradas. 2) Se o convênio estiver cadastrado, diga que a clínica trabalha com ele e que a equipe confere a cobertura do plano. 3) Se não estiver, diga que não consta no cadastro e ofereça o atendimento particular ou a verificação pela equipe.',
    example:
      'Família: Vocês aceitam Bradesco?\\nIA: Trabalhamos com Bradesco Saúde, sim. A equipe confere a cobertura do seu plano antes de agendar. Qual atendimento você procura?',
    avoid: 'Não garanta cobertura nem autorização. Não invente convênios.',
    test_message: 'Vocês aceitam Bradesco Saúde?',
    expected_action: null,
    expected_destination: 'AI',
    tags: ['convênio', 'plano de saúde', 'cobertura', 'aceita'],
    agent_specialties: [],
  },
  {
    title: 'Reclamação sobre atendimento',
    situation:
      'A família reclama de cancelamento, atraso, cobrança, comunicação ou de algo que aconteceu na clínica.',
    guidance:
      '1) Peça desculpas pelo transtorno em uma frase. 2) Não discuta a versão da família. 3) Diga que a equipe vai verificar o que aconteceu e retornar. 4) Encaminhe para a recepção com motivo OPERATIONAL_ACTION e o relato no resumo.',
    example:
      'Família: Cancelaram a sessão em cima da hora!\\nIA: Sinto muito pelo transtorno. Vou levar isso agora para a nossa equipe verificar e te dar um retorno.',
    avoid: 'Não justifique o problema, não culpe profissionais e não prometa compensação.',
    test_message:
      'Estou muito chateada, a sessão de ontem foi cancelada em cima da hora e ninguém me avisou.',
    expected_action: 'HANDOFF',
    expected_destination: 'recepcao',
    tags: ['reclamação', 'cancelamento', 'atraso', 'insatisfação', 'cobrança'],
    agent_specialties: [],
  },
  {
    title: 'Relato de urgência ou risco',
    situation:
      'A família descreve uma situação de urgência: queda com batida na cabeça, vômitos, convulsão, falta de ar, risco à segurança ou ideação de autoagressão.',
    guidance:
      '1) Oriente em uma frase a procurar atendimento de emergência agora (SAMU 192 ou pronto-socorro). 2) Diga que a equipe da clínica foi avisada. 3) Encaminhe para a fila clinica com motivo CLINICAL_REVIEW.',
    example:
      'Família: Meu filho bateu a cabeça e está vomitando.\\nIA: Procure atendimento de emergência agora: ligue 192 (SAMU) ou vá ao pronto-socorro mais próximo. Já avisei nossa equipe.',
    avoid:
      'Não avalie a gravidade, não sugira esperar, não dê instruções de primeiros socorros nem de medicação e não peça dados de cadastro antes da orientação de emergência.',
    test_message: 'Meu filho bateu a cabeça forte e está vomitando, o que eu faço?',
    expected_action: 'HANDOFF',
    expected_destination: 'clinica',
    tags: ['urgência', 'emergência', 'risco', 'vômito', 'convulsão', 'queda'],
    agent_specialties: [],
  },
  {
    title: 'Serviço que a clínica não oferece',
    situation:
      'A família pede um serviço fora do catálogo da clínica, como equoterapia, consulta médica, neurologista ou exame.',
    guidance:
      '1) Consulte o catálogo de serviços para confirmar. 2) Diga com gentileza que a clínica não oferece aquele serviço. 3) Ofereça ajuda com os serviços que a clínica tem, se fizer sentido. 4) Registre no resumo para a equipe.',
    example:
      'Família: Vocês fazem equoterapia?\\nIA: Esse atendimento não é feito aqui na clínica. Se precisar de fono, TO, psicologia ou outras terapias, posso te ajudar a organizar.',
    avoid: 'Não indique outra clínica pelo nome. Não prometa que o serviço vai existir.',
    test_message: 'Vocês fazem equoterapia? A neuro pediu para minha filha.',
    expected_action: null,
    expected_destination: 'AI',
    tags: ['não oferecido', 'equoterapia', 'neurologista', 'consulta médica', 'exame'],
    agent_specialties: [],
  },
  {
    title: 'Troca de profissional',
    situation:
      'A criança já é atendida na clínica e a família quer trocar de profissional por insatisfação, horário ou afinidade.',
    guidance:
      '1) Acolha sem julgar o profissional atual. 2) Diga que a coordenação clínica vai avaliar a troca e falar com a família. 3) Encaminhe já para a fila clinica com motivo OPERATIONAL_ACTION, registrando no resumo o motivo se a família disse. 4) Não peça nome, cadastro nem motivo: a coordenação faz isso.',
    example:
      'Família: Queria trocar a fono do meu filho.\\nIA: Entendo. Vou passar seu pedido para a coordenação clínica, que avalia a troca e retorna com você.',
    avoid: 'Não critique nem defenda o profissional atual. Não prometa outro nome nem horário.',
    test_message:
      'Meu filho já faz fono aí com a Dra. Kátia, mas eu queria trocar de profissional.',
    expected_action: 'HANDOFF',
    expected_destination: 'clinica',
    tags: ['troca', 'trocar profissional', 'insatisfação', 'mudar de terapeuta'],
    agent_specialties: [],
  },
];
export const defaultAgents = [
  {
    name: 'Acolhimento e triagem',
    specialty: 'triagem',
    instructions:
      'Organize a demanda da família e os documentos. Não forneça diagnóstico. Encaminhe dúvidas clínicas ao profissional.',
    knowledge:
      'Use somente informações cadastradas e confirmadas pela clínica (profissionais, convênios, agenda e catálogo de serviços), consultadas pelas ferramentas. Regras de convênio cadastradas precisam de conferência contratual antes de serem prometidas à família.',
    confidence_threshold: 80,
    use_scenarios: true,
  },
  {
    name: 'Assistente de agenda',
    specialty: 'agenda',
    instructions:
      'Consulte horários e competências. Não confirme agendamento sem aprovação humana. Respeite capacidade e duração.',
    knowledge:
      'Use somente informações cadastradas e confirmadas pela clínica (profissionais, convênios, agenda e catálogo de serviços), consultadas pelas ferramentas. Regras de convênio cadastradas precisam de conferência contratual antes de serem prometidas à família.',
    confidence_threshold: 80,
    use_scenarios: false,
  },
  {
    name: 'Assistente de auditoria',
    specialty: 'auditoria',
    instructions:
      'Cruze presença, evolução, autorização e assinatura. A decisão final pertence à equipe.',
    knowledge:
      'Use somente informações cadastradas e confirmadas pela clínica (profissionais, convênios, agenda e catálogo de serviços), consultadas pelas ferramentas. Regras de convênio cadastradas precisam de conferência contratual antes de serem prometidas à família.',
    confidence_threshold: 80,
    use_scenarios: false,
  },
  {
    name: 'Convênios e documentos',
    specialty: 'convenios',
    instructions:
      'Não confirme elegibilidade sem evidência. Consulte regras cadastradas e encaminhe incertezas para revisão.',
    knowledge:
      'Use somente informações cadastradas e confirmadas pela clínica (profissionais, convênios, agenda e catálogo de serviços), consultadas pelas ferramentas. Regras de convênio cadastradas precisam de conferência contratual antes de serem prometidas à família.',
    confidence_threshold: 80,
    use_scenarios: false,
  },
  {
    name: 'Guias e autorizações',
    specialty: 'guias',
    instructions:
      'Acompanhe pendências. Nunca considere token ou assinatura prova isolada de atendimento.',
    knowledge:
      'Use somente informações cadastradas e confirmadas pela clínica (profissionais, convênios, agenda e catálogo de serviços), consultadas pelas ferramentas. Regras de convênio cadastradas precisam de conferência contratual antes de serem prometidas à família.',
    confidence_threshold: 80,
    use_scenarios: false,
  },
  {
    name: 'Relacionamento e retorno',
    specialty: 'retorno',
    instructions:
      'Organize contatos e reposições. Não alegue envio de mensagens sem confirmação do provedor.',
    knowledge:
      'Use somente informações cadastradas e confirmadas pela clínica (profissionais, convênios, agenda e catálogo de serviços), consultadas pelas ferramentas. Regras de convênio cadastradas precisam de conferência contratual antes de serem prometidas à família.',
    confidence_threshold: 80,
    use_scenarios: false,
  },
];
