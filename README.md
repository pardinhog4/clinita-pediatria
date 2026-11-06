# Integrar · plataforma clínica MVP

Aplicação Next.js 15 com App Router e API no próprio Next. React, TypeScript, Zustand, React Hook Form e Zod. PostgreSQL 17 local no Docker. A identidade e os fluxos do protótipo foram reescritos em componentes React; `reference/prototype` conserva a referência original. Não existe iframe, execução de HTML legado ou endpoint de snapshot.

## Rodar localmente

Requisitos: Node 22+, npm e Docker Desktop em execução.

```powershell
npm.cmd install
npm.cmd run setup:env
docker compose up -d postgres
npm.cmd run db:migrate
npm.cmd run clinica:criar
npm.cmd run dev
```

URL: **http://localhost:3005**. PostgreSQL fica em `127.0.0.1:5547`, com volume persistente. O script `setup:env` gera credenciais aleatórias e preserva um `.env` existente. Não versionar o `.env`.

**Primeiro acesso:** `npm.cmd run clinica:criar` pergunta o nome da clínica, a primeira unidade, o nome e o e-mail da direção e a senha (digitada sem aparecer). A direção entra direto com essa senha.

- Todo o resto é feito na plataforma: unidades, salas, horários, profissionais, convênios, pacientes, usuários e importação de planilhas.
- Sem perguntas, por exemplo num servidor: `npm.cmd run clinica:criar -- --nome "Clínica" --unidade "Matriz" --direcao "Nome" --email email@clinica.com.br`, com a senha em `CLINIC_ADMIN_PASSWORD`.
- Se já existir clínica, o comando recusa (use `--outra-clinica` para criar uma clínica separada).
- Alternativa pela tela: com o banco vazio, a entrada mostra "Fazer o cadastro inicial" (`/configuracao-inicial`). Em servidor público, ela exige `SETUP_TOKEN`.

Toda clínica nasce com os dados padrão: 6 filas por unidade, catálogo de competências, cenários da IA e agentes.

**Dados reais:** em **Configurações → Importar dados**, baixe o modelo `.xlsx` e importe nesta ordem: convênios, profissionais (depois de cadastrar as salas) e pacientes.

- "Conferir planilha" mostra os erros por linha sem gravar nada.
- "Importar" grava tudo ou nada.
- Registros que já existem são ignorados.

**Não existe mais acesso de demonstração no produto.** A clínica fictícia (`tests/fixtures/demo-clinic`) existe só no banco de testes.

Para executar a versão compilada:

```powershell
npm.cmd run build
npm.cmd run start
```

## Organização

Código formatado com Prettier (`npm run format`; `npm run format:check` na revisão).

Páginas (`src/app/(app)`): cada rota da área logada tem a própria pasta, com `page.tsx` (título da aba)
e o componente da página ao lado (`pacientes/patients-page.tsx`, `agenda/agenda-page.tsx`...).
O `layout.tsx` do grupo `(app)` monta o `AppShell` (menu, unidade, sessão, controle de acesso por perfil)
e entrega às páginas o contexto da sessão (`useWorkspaceContext`). O mapa de páginas, títulos e perfis
fica em `src/lib/navigation.ts`.

API (`src/app/api`): uma pasta por endpoint (`patients`, `patients/[id]`, `ledger/[id]/settle`,
`sandbox/[id]/messages`...). Todas usam `src/server/route.ts`, que autentica, valida a origem nas
gravações e padroniza respostas e erros. As regras de negócio ficam em `src/server`.

Componentes (Atomic Design):

- `src/components/atoms`: botões, entradas e indicadores.
- `src/components/molecules`: cabeçalho, tabela, indicadores e diálogo.
- `src/components/organisms`: formulários, calendário, prontuário, conversa, financeiro, `PageFrame`
  (cabeçalho padrão das páginas), `RecordsTable` (lista com busca e filtros) e `EditorHost`.
- `src/components/templates`: `AppShell` e o contexto da área logada.
- `src/hooks`: `useApi` (busca com recarga após gravações) e `useRecords` (lista paginada com filtros).
- `src/server`: permissões, consultas, regras e transações.
- `src/lib`: schemas Zod, sessão, cliente HTTP e pool do PostgreSQL.
- `src/stores`: Zustand guarda somente seleção de unidade/menu e notificações; tokens e prontuário não são persistidos no navegador.
- `migrations`: migrations SQL versionadas e executadas em transação.

## Funcionalidades

Cadastros base em Configurações: unidades, especialidades (com atendimento em grupo), catálogo de competências e filas de atendimento. Todos com criação, edição e desativação com motivo; nada é apagado. Cadastros e edição de pacientes, profissionais, salas/capacidade e convênios; agenda, recorrência atômica, busca de horários, presença, autorização manual, evolução e auditoria; prontuário com anamnese, plano, relatórios, avaliações e PDFs privados; configurações de agentes versionadas; conversas locais com mensagens e transferência; financeiro manual com comprovantes, baixa única, correção justificada e histórico; estoque com saldo transacional; repasse PJ a partir de sessões aprovadas, com vínculo único à conta a pagar.

O agendamento valida duração do convênio, especialidade solicitada, pedido válido, expediente, paciente, profissional, sala e capacidade. Bloqueios no PostgreSQL serializam reservas concorrentes; a série inteira é revertida se uma ocorrência conflita. Os valores e regras da carga inicial são sintéticos e precisam ser conferidos com a clínica.

## Sessão e segurança

O acesso é feito em **/login** com e-mail e senha (hash scrypt no PostgreSQL). Senhas erradas recebem a mesma mensagem genérica; 8 falhas em 15 minutos bloqueiam o e-mail temporariamente, e um login bem-sucedido zera o contador. Para definir ou redefinir a senha de um usuário: `npm.cmd run user:password -- email@clinica.com.br` (gera uma senha forte e revoga as sessões; com `--env-key=NOME` a senha é gravada no `.env` em vez de aparecer no terminal). Em **/perfil** cada usuário edita nome, telefone e cargo, troca a senha (as outras sessões são encerradas) e encerra dispositivos conectados.

Em **/usuarios** (Usuários e acessos), direção e gestão criam acessos, definem perfil e unidades, vinculam o cadastro do profissional, redefinem senhas e desativam contas. Cada criação ou redefinição gera uma senha provisória exibida uma única vez; com ela, a pessoa só acessa Meu perfil até criar a senha pessoal (bloqueio também no servidor). Regras: gestão não concede nem altera contas de direção; ninguém altera o próprio acesso por essa tela; a clínica mantém ao menos uma direção ativa; só se concedem unidades que o gestor administra; desativar exige motivo e encerra as sessões. Tudo é auditado.

**Senha e convites:**

- Usuários novos recebem convite por e-mail com um link (72 h) para definir a própria senha. A senha provisória continua como alternativa.
- "Esqueceu a senha?" envia um link de uso único (1 h).
- O e-mail usa SMTP genérico (`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM`). Sem SMTP, os e-mails ficam em simulação em Integrações → E-mail.
- O servidor de desenvolvimento e o de produção local escutam apenas em `127.0.0.1`.

- JWT HS256 com issuer/audience/type, access token de 15 min e refresh de 7 dias, segredos distintos.
- Cookies HttpOnly, SameSite Strict e Secure quando o domínio usa HTTPS. Tokens não vão para localStorage.
- Refresh rotacionado, armazenado como hash no banco; reutilização revoga a sessão. Permissões e vínculo ativo são consultados no servidor a cada requisição.
- CSRF com token e hash de sessão, verificação de Origin e validação de entradas com Zod; colunas/tabelas dinâmicas usam listas fechadas e valores usam parâmetros SQL.
- Rate limit persistido em PostgreSQL para leituras, gravações, início local e refresh; funciona entre instâncias da aplicação.
- Tenant, unidade e perfil são derivados da sessão. Formulários não escolhem tenant ou usuário. As associações clínicas são verificadas para o perfil profissional.
- Documentos PDF até 2 MB, leitura autenticada e auditada, sem diretório público. Documentos e comprovantes ficam no PostgreSQL neste MVP; há contrato para armazenamento privado externo futuro.
- Auditoria, registros clínicos, movimentações e eventos de pagamento possuem triggers de imutabilidade; correções são novos registros.
- Headers CSP, anti-framing, nosniff e política de referência. Respostas sensíveis usam `Cache-Control: no-store`.

Next fixado em 15.5.28, da [atualização oficial de segurança de outubro](https://nextjs.org/blog/nextjs-security-update-october-14-2026). PostCSS atualizado por override compatível; confira `npm audit` antes de cada publicação.

## Vercel (próxima publicação, não realizada)

Usar PostgreSQL gerenciado com TLS e connection pooling; o container local não roda dentro da Vercel. Configurar `DATABASE_URL`, `DATABASE_SSL=true`, dois segredos de tokens e `APP_ORIGIN` HTTPS. Definir `SETUP_TOKEN` antes do primeiro acesso, para que só quem instalou consiga fazer o cadastro inicial, e configurar o SMTP. Executar migrations em etapa única controlada do deploy; não executar seed em produção. O pool local é reutilizado e usa até cinco conexões por instância.

## Sandbox de IA e próximo incremento do WhatsApp

A central persiste conversas e mensagens. A aba Sandbox executa análise real de texto, imagem e PDF quando a chave e o worker estão configurados, com ferramentas e transferência humana. Não existe envio a números de WhatsApp externos, diagnóstico automático ou confirmação de convênio externo. Os contratos em `src/server/integrations/ports.ts` preparam canal, armazenamento de documentos e resultado estruturado da análise. Próximo passo: conectar um provedor de WhatsApp externo e implementar seu webhook assinado e idempotente. Não enviar prontuários a provedores sem a política de privacidade e acesso definida.

## Validação

```powershell
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
npm.cmd run test:e2e
npm.cmd audit
```

**Os testes nunca tocam o banco do dia a dia.**

- **`npm test`** recria o banco `TEST_DATABASE_URL` (precisa terminar em `_test`), aplica as migrações e roda os testes nele. O arquivo `tests/setup-db.ts` troca o banco antes de cada arquivo de teste.
- **`npm run test:e2e`** recria o mesmo banco com a clínica fictícia de teste e uma conta com senha por perfil (senha gerada na hora). Depois sobe um servidor próprio na porta 3006, com build separado em `.next-e2e`. O servidor de desenvolvimento na 3005 pode continuar aberto.
- **Cobertura:** JWT, CSRF, escopo, refresh/replay, concorrência, recorrência, baixa, histórico, IA, encaminhamentos, cenários e criação de clínica. No navegador: cadastros, prontuário, documentos, pagamento, agentes, conversa, agenda e celular.
- **Banco de testes à mão:** `npm.cmd run db:test-reset` (acrescente `-- --demo` para incluir a clínica fictícia de teste).
- **Limpeza do banco do dia a dia:** `npm.cmd run db:cleanup-tests` lista as clínicas deixadas por testes antigos e só apaga com `-- --apply`. Faça um backup antes.

## Limites operacionais a validar antes de uso clínico

Login/gestão de usuários e credenciais de provedores são próximos incrementos. O faturamento operacional TISS está ativo com lotes e retorno manual/CSV; XML homologado e assinatura qualificada dependem de parametrização externa. A leitura de anexos no Sandbox depende da configuração e validação da chave de IA. O repasse usa o valor por hora cadastrado e sessões auditadas; conferência documental PJ e fechamento por período estão implementados; regras trabalhistas/contratuais definitivas dependem da clínica. Baixas são integrais; pagamento parcial não foi habilitado. Uma sessão já vinculada a repasse exige revisão financeira antes de alterar sua auditoria. Backups, monitoramento, recuperação e consentimentos precisam ser configurados antes de dados reais. O isolamento está na API e nas chaves compostas; RLS e isolamento por banco são opções de endurecimento futuro.

## Sandbox e entrada por áreas

A página inicial apresenta seis áreas da clínica; o dashboard está em /inicio. Em WhatsApp → Sandbox, crie uma sessão para testar texto, imagens/PDFs e encaminhamento. Consulte [docs/SANDBOX.md](docs/SANDBOX.md) para configuração do .env, worker, permissões e validação real do provedor.

## Repasses PJ

A página apresenta total elegível, valor retido por pendências, espelhos conferidos pelo profissional e espelhos aprovados, calculados por unidade sobre sessões concluídas ainda não vinculadas a conta a pagar. Conferência e aprovação são registros manuais auditados; gerar a conta exige aprovação do espelho atual. Mudanças nas sessões ou no valor por hora invalidam a conferência anterior. O pagamento continua manual no Financeiro. Os badges distinguem conferência interna (cinza), confirmação do profissional (azul), aprovação (verde) e retenções (laranja).

## Paridade do protótipo

Consulte [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) para a comparação por área, rotas restauradas, dados preservados, validação e dependências de WhatsApp/operadoras/XML. Guias e tokens estão em /guias e Faturamento TISS em /auditoria.
