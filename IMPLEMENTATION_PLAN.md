# Paridade do protótipo Integrar — auditoria de 28/10/2026

Referência verificada: `Documents/cliente-mvp/integrar-prototipo/prototipo/v001/bundle.html`, idêntica ao original em `Documents/clientes/clinica-integrar.gestao-pacientes`. Também consultados mapa dor → regra → tela, 21 especificações OpenSpec, camadas `web/demo.js` e `web/manual-finance.js` e `Documents/dec.txt`. O financeiro continua manual, conforme decisão do usuário; credenciais, números de WhatsApp e retornos de operadoras não serão simulados como integração real.

## Diagnóstico antes desta revisão

| Área do protótipo      | Projeto real antes da revisão                   | Diferença identificada                                                                                                                     |
| ---------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Entrada por seis áreas | Restaurada                                      | Dashboards específicos por área ainda simplificados                                                                                        |
| Navegação              | Itens principais, agentes e integrações         | Guias e tokens renomeado indevidamente; Faturamento TISS substituído por auditoria genérica; faltam contadores                             |
| Início                 | Indicadores gerais e financeiro                 | Ocupação, faltas, faturamento em risco, evoluções e alertas de créditos/contestação ausentes                                               |
| WhatsApp               | Central, transferência, Sandbox multimodal real | Filtros por fila/canal/prioridade, espera, templates e visão da fila humana incompletos                                                    |
| Agenda                 | Lista, semana/mês e recorrência                 | Dia panorâmico, filtros combinados, remarcar, ausências do profissional, faltas/reposições, lista de espera e encaixe justificado ausentes |
| Buscar horários        | Especialidade/data/duração                      | Idade, competência, quantidade do pedido, dias preferidos e grade sequenciada incompletos                                                  |
| Pacientes              | Cadastro, histórico, prontuário e PDF           | Filtros, equipe, pedido quantitativo, coparticipação, créditos, avaliação em andamento e gráficos ausentes                                 |
| Profissionais          | Cadastro e competências em texto                | Faixa etária não editável, certificados, documentos PJ, horários e transferência de carteira ausentes                                      |
| Guias e tokens         | Conferência de autorização e guia na sessão     | KPIs, quatro abas, regras de quantidade/validade de token, pedidos, monitor, tablet/link, créditos e contestação ausentes                  |
| Faturamento TISS       | Aprovar/devolver sessão                         | Filas, seleção, lote por operadora, lote enviado, retorno/glosa e exportação de conferência ausentes                                       |
| Repasses PJ            | Quatro KPIs restaurados e conferência/aprovação | CNPJ, composição por período, envio/contestação do espelho, ajustes e histórico de fechamento incompletos                                  |
| Financeiro/estoque     | Implementação superior ao placeholder original  | Preservar baixa manual, comprovantes, correção, CSV e movimentações                                                                        |
| Configurações          | Convênios/salas/modelos                         | Regras completas dos planos, tipos de questões, automações, canais, templates e histórico de regras incompletos                            |
| Log                    | Registro imutável e busca                       | Filtros por usuário/data/recurso, detalhe antes/depois e justificativas incompletos                                                        |

## Critérios de entrega

- Reconstituir menus e experiência visual com KPIs, contadores, badges, filtros, estados vazios e ações persistidas.
- Impedir presença, token, assinatura, crédito ou contestação de isoladamente liberar faturamento ou repasse.
- Modelar autorização, créditos, contestação, lotes, retorno, glosas, notificações internas e configurações no PostgreSQL, com escopo tenant/unidade e auditoria.
- Preservar todos os dados existentes e testar operações concorrentes/duplicadas e fronteiras de permissão.
- Exibir integrações sem credenciais como não conectadas; pedidos de WhatsApp são rascunhos/filas locais até haver transporte externo.
- TISS: não reutilizar o XML ilustrativo 4.01 do protótipo como arquivo homologado. O módulo operacional deve existir, com lotes, conferência e retorno manual; XML para envio depende dos dados cadastrais, versão e validação XSD oficial aplicável.
- Manter login desabilitado no ambiente local, sem transformar o seletor de área em permissão de produção.
- Validar os fluxos no navegador em desktop/celular e deixar servidor/worker ativos ao terminar.

## Validação e rastreabilidade

Atualizar este documento conforme cada lacuna for resolvida. Os totais devem vir do banco; não copiar os números fictícios apresentados nos screenshots antigos. Os testes usam tenants isolados e documentos fictícios.

## Resultado da restauração

| Área              | Implementação entregue nesta revisão                                                                                                                                                                      | Caminho                              |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| Navegação         | Guias e tokens, Faturamento TISS, contadores, grupos recolhíveis, menu por perfil                                                                                                                         | Menu lateral                         |
| Entrada e perfis  | Seis áreas, sessões com permissões reais e seletor local de demonstração, bloqueado na Vercel                                                                                                             | / e seletor lateral                  |
| Dashboards        | Gestão, recepção, profissional, auditoria e financeiro; ocupação sem duplicar ABA, faltas, risco, pendências e alertas                                                                                    | /inicio                              |
| Atendimento       | Filtros de família/prioridade/etapa, espera, fila humana com histórico e origem Sandbox, controle humano e propostas                                                                                      | /atendimento                         |
| Propostas         | Propostas da IA ou da recepção, aceite explícito da família, conferência da identidade e aprovação atômica; horário não reservado antes da aprovação                                                      | /atendimento#propostas               |
| Agenda            | Lista/dia/semana/mês, filtros, expediente, remarcação, exceção justificada, limites do pedido, faltas e créditos, ausências profissionais e lista de espera                                               | /agenda                              |
| Busca             | Cadastro como origem, idade, competência, certificação, horários reais, dias/turno, quantitativo semanal e grade sequenciada atômica                                                                      | /buscar-horarios                     |
| Pacientes         | Filtros, quantitativos/preferências, responsáveis, profissionais fixos, equipe, gráficos de presença, créditos, avaliação em etapas, progresso e coparticipação por mês                                   | /pacientes                           |
| Profissionais     | Faixa etária, dias, assistentes, certificados/PDF, conferência PJ, resumo para operadora, carteira e transferência com revogação do acesso anterior                                                       | /profissionais                       |
| Guias e tokens    | KPIs, pendentes/conferidas/créditos/contestadas/solicitações, quantidade e validade dos tokens, pedidos manuais, tablet e link de uso único                                                               | /guias                               |
| Contestação       | Bloqueio de faturamento/repasse, motivo e decisão autorizada com auditoria                                                                                                                                | Sessão e Guias                       |
| TISS operacional  | Seis filas, provas C/A/E, lote por operadora, unicidade, composição, CSV, protocolo externo manual, demonstrativo/CSV e glosas                                                                            | /auditoria                           |
| Repasses PJ       | Quatro KPIs coloridos, período 21→20, tabela contratual 30/60 min, composição, retenções, ajustes, disponibilização/conferência/contestação/aprovação, bloqueio PJ, relação CSV e histórico de pagamentos | /repasses                            |
| Financeiro        | Conta a pagar após aprovação, pagamento fora da plataforma, comprovantes, baixa/correção auditadas e estoque preservados                                                                                  | /financeiro                          |
| Configurações     | Regras completas de planos com motivo e versão, salas, editor de modelos clínicos, automações, canais e templates                                                                                         | /configuracoes                       |
| Automações locais | Lembrete/token por antecedência, alerta de faltas seguidas, fila de revisão após recusa, indicação de vaga e pausa das respostas de IA; contatos externos são rascunhos                                   | Configurações e Guias → Solicitações |
| Auditoria         | Filtros de data/recurso/ação, autor, detalhes antes/depois e justificativas                                                                                                                               | /auditoria-log                       |
| Visual            | Cores semânticas, badges de etapas, provas, contadores, tabelas com rolagem e versões móveis                                                                                                              | Todas as áreas                       |

## Dependências e limites explicitados na interface

- Transporte WhatsApp: ainda sem número, provedor ou webhook conectado. O Sandbox usa IA real; as mensagens operacionais, lembretes, solicitações de token e ofertas são registros e rascunhos locais. A confirmação manual de envio exige referência.
- Operadoras: elegibilidade/carência e validação de token são conferências manuais. O monitor não inventa consulta, resultado ou horário de verificação. Integração periódica depende do acesso contratado de cada operadora.
- XML TISS e XML de demonstrativos: não homologados. Os lotes e retornos operacionais são persistidos; a exportação de conferência e importação genérica usam CSV. XML de envio exige cadastro do prestador, códigos e versão/XSD aplicável, com homologação da operadora. O XML ilustrativo 4.01 do protótipo não foi reapresentado como válido.
- Assinatura: evidência eletrônica local com consentimento e link privado, não assinatura qualificada nem biometria homologada. Pacientes que exigem biometria são bloqueados no link e dependem da conferência presencial.
- Antecipações: sessões reais seguem presença/autorização/evolução na data efetiva. Não existe pagamento fictício antecipado nem desconto automático baseado em números do HTML; diferenças contratuais de antecipações são registradas como ajustes justificados no espelho.
- Login individual de produção permanece fora desta etapa por decisão do usuário. O seletor local muda as permissões no servidor e não é habilitado na Vercel.
- Instrumentos licenciados e regras contratuais definitivas dependem da clínica. Modelos criados pela clínica e PDFs privados já funcionam.

## Dados e migrações

Migrações 006–009 acrescentam evidências operacionais, solicitações, assinatura, créditos, faltas, lista de espera, lotes/retornos, avaliações, transferência, fechamento e propostas. O script scripts/restore-reference.ts importa somente chaves ausentes do cenário sintético original, com execução única auditada. Não substitui as edições feitas no MVP nem copia totais de screenshots para os KPIs.

## Validação

Testes de integração e navegador usam tenants separados. Incluem autorização, concorrência, duplicação, assinatura desenhada no iframe, glosa sem baixa automática, propostas sem reserva prematura, permissões reais de cada perfil e mobile. Capturas ficam em artifacts/. Não há integração bancária ou envio externo de mensagens nesses testes.

Validação final em 28/10/2026: typecheck e build aprovados; 41 testes de servidor e 6 testes Playwright aprovados. A bateria inclui rate contratual específico de 30 minutos, transferência de carteira, bloqueios por perfil e viewport de 390 px.
