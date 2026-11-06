# Migração do vitta-core para a VPS (Coolify)

> Status: **migrado em 26/10/2026, 08h31–08h51**. Produção em https://vittadesk.com.br (VPS/Coolify).
> Vercel congelada (página de manutenção + repasse do webhook) e jobs do pg_cron da origem pausados.
> Decisão: opção 1 do diagnóstico de out/2026 — VPS atual (2 vCPU / 8 GB), build fora da VPS,
> Supabase próprio enxuto. Se a VPS ficar no limite, usar este documento como argumento para o upgrade.

## Arquitetura no destino

| Peça | Onde | Observação |
|---|---|---|
| App Next.js | Coolify, imagem `ghcr.io/vacivitta/vitta-core` | Build no GitHub Actions (`.github/workflows/docker-image.yml`); a VPS só baixa a imagem |
| Supabase | Coolify, projeto `vitta-core` (`p0jxdegikezc9buim8pu870l`), serviço `supabase-vitta-core` (`myrjepecxmbz7ji3melnzfia`) | Só: db, kong, auth, rest, **realtime**, storage + minio, meta, studio. Removidos do compose: analytics, vector, edge-functions, supavisor, imgproxy |
| Banco | Postgres **15.8** (imagem padrão do Coolify, igual a Gestão e VittaMaster) | A origem é 17: o dump usa `pg_dump` 17 com `--no-owner --no-privileges` e o script remove `SET transaction_timeout`. Testar no ensaio |
| Domínio do app | `vittadesk.com.br` (na troca) / `vittadesk.app.vacivitta.com.br` (teste) | DNS do `vittadesk.com.br` hoje é da **Vercel** (ns1/ns2.vercel-dns.com) |
| Domínio do Supabase | `api-vittadesk.app.vacivitta.com.br` | Coberto pelo wildcard `*.app.vacivitta.com.br` |

Orçamento de memória do vitta-core: ~1,0–1,3 GB (Supabase enxuto) + ~0,3–0,5 GB (app). Studio pode ficar parado quando não estiver em uso.

## Etapas

### 1. Preparar o repositório — feito
- `next.config.ts` com `output: 'standalone'`, `Dockerfile`, `.dockerignore`.
- Workflow do GitHub: só roda quando a variável `VPS_SUPABASE_URL` existir.
- Webhook do WhatsApp já responde na hora e processa em `after()` (funciona em `next start`).

### 2. Subir o Supabase do vitta-core na VPS (vazio) — feito em 23/10/2026
- Serviço criado pela API do Coolify a partir do template Supabase; compose enxuto enviado via
  `PATCH /services/{uuid}` (`docker_compose_raw`): sem analytics, vector, edge-functions, supavisor e imgproxy;
  storage sem transformação de imagem; cadastro público e por telefone desligados (usuários só via API de admin).
- Domínio do Kong: `https://api-vittadesk.app.vacivitta.com.br` (HTTPS ok).
- Auth: `GOTRUE_SITE_URL=https://vittadesk.com.br`, `API_EXTERNAL_URL` = domínio da API,
  `ADDITIONAL_REDIRECT_URLS` = `https://vittadesk.com.br/**,https://vittadesk.app.vacivitta.com.br/**`.
- Consumo medido: ~1,14 GB (10 containers); VPS com ~3,4 GB livres depois de subir.
- Chaves (anon, service role, JWT) geradas pelo Coolify: ver no painel do serviço → Environment Variables
  (`SERVICE_SUPABASEANON_KEY`, `SERVICE_SUPABASESERVICE_KEY`, `SERVICE_PASSWORD_JWT`). Não copiar para o chat.
- **Pendente:** SMTP para os e-mails de autenticação (`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`,
  `SMTP_ADMIN_EMAIL`, `SMTP_SENDER_NAME`).
- O Studio (~170 MB) pode ser parado quando não estiver em uso.

### 3. Ensaio com cópia dos dados — feito em 23/10/2026

Resultado:
- App de teste: `https://vittadesk.app.vacivitta.com.br` (Coolify app `vitta-core-ensaio`, `oicsvqqwkb9mwvxfww7ce8lj`,
  imagem `ghcr.io/vacivitta/vitta-core:latest`, ~55 MB de RAM). Login ~0,1 s; orçamento público ~0,3 s.
- Contagens iguais à origem (leads 2.854, conversas 3.900, mensagens 28 mil, orçamentos 272, 10 usuários, 65 policies,
  views com security_invoker, Realtime nas 7 tabelas).
- Storage: 2.900 arquivos / 279 MB (cópia leva ~35 min; a 2ª execução copia só o delta). 4.759 links reescritos.
- **No ensaio o WhatsApp fica desativado**: `wa_config.access_token = 'ENSAIO-DESATIVADO'`, `is_active = false`,
  e nenhum job do pg_cron foi criado (só a parte de links do `05-pos-migracao.sql` foi aplicada).
  O app de teste tem `CRON_SECRET` e `WHATSAPP_APP_SECRET` próprios.

Problemas encontrados e já corrigidos nos scripts:
- pg_dump 17.6+ gera `\restrict`/`\unrestrict`, que o psql 15 não entende → removidos no dump.
- `CREATE SCHEMA public` no dump → removido.
- `storage.buckets` da origem tem colunas que o storage da VPS não tem → buckets exportados como INSERT com colunas comuns.
- Links de arquivos também em colunas JSON (`quote_templates.paginas_imagens`) → `05-pos-migracao.sql` trata json/jsonb.
- Connection string: a senha não pode ficar entre colchetes (o `[YOUR-PASSWORD]` do painel inclui os colchetes).
- O endpoint de deploy do Coolify 4.4 é POST (workflow ajustado).
- Credenciais usadas no ensaio ficam em `/root/vitta-migracao/.origem*` (modo 600) e foram apagadas ao final.

Roteiro original do ensaio:
1. Na VPS: `export SRC_DB_URL=...` (connection string do Supabase de origem, *session pooler*) e
   `bash scripts/migracao-vps/01-dump-origem.sh`.
2. `bash scripts/migracao-vps/02-restaurar-destino.sh /root/vitta-migracao/<pasta> <container-supabase-db>`.
3. `node scripts/migracao-vps/04-copiar-storage.mjs` com `SRC_*`/`DST_*` (~3 mil arquivos, ~250 MB).
4. `05-pos-migracao.sql` com `app_url` = domínio de **teste** (no ensaio, os jobs devem chamar o app de teste).
5. App no Coolify (Docker image `ghcr.io/vacivitta/vitta-core:latest`, porta 3000, domínio de teste) com as variáveis:
   `NEXT_PUBLIC_*` (também como Variables no GitHub), `SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET`,
   `WHATSAPP_APP_SECRET`, `WHATSAPP_*` (fallback), `NEXT_PUBLIC_APP_URL`.
6. Testar no domínio de teste: login, funil (ordem, 1.380+ leads), atendimento (mensagens, áudio, mídia),
   orçamento + link público + PDF, dashboard, agenda, chat interno, realtime (abrir duas abas).
   **Não** apontar o webhook da Meta para o teste — o ensaio não recebe mensagens novas.
7. Medir memória com tudo rodando.

### 4. Backups (antes da troca)
- Coolify → banco do Supabase do vitta-core → Scheduled backups para um S3 externo (diário, reter 14 dias).
- Testar uma restauração do backup num banco descartável.

### 4.1 Backups — feito em 23/10/2026
- `/root/backups/vitta-core/backup.sh` (cron `/etc/cron.d/backup-vitta-core`, todo dia 06:30): pg_dump + Storage,
  enviados ao R2 (`vacivitta-backups/vitta-core/`), 14 dias diários + 8 semanas semanais; local 7 dias.
- Chaves do R2 em `/root/backups/r2.env` (modo 600). Restauração testada: contagens idênticas.
- Gestão e VittaMaster continuam só com backup local (decisão: R2 só para o vitta-core).

### 5. Preparar a troca — agendada para **segunda 26/10/2026, 9h** (equipe não será avisada; usuário presente — não fazer a troca sem ele)
Até domingo 25/10 (usuário):
- Coolify → app `vitta-core-ensaio` → Environment Variables: colar os valores **reais** da Vercel de
  `WHATSAPP_APP_SECRET` (sem ele o webhook rejeita toda mensagem da Meta), `WHATSAPP_VERIFY_TOKEN`,
  `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_WABA_ID`, `WHATSAPP_APP_ID`.
- Corrigir a variável de usuário `SUPABASE_ORIGEM_DB_URL` no Windows (senha sem colchetes, session pooler).

Segunda 8h–9h (Claude):
- Variável `VPS_APP_URL` do GitHub e `NEXT_PUBLIC_APP_URL` do app → `https://vittadesk.com.br`; novo build.
- Adicionar `https://vittadesk.com.br` aos domínios do app no Coolify (mantendo o de teste).
- Connection string da origem: já corrigida e testada em 23/10 (/root/vitta-migracao/.origem, modo 600).

### 6. Troca (janela de ~30 min)
1. Pausar os jobs do pg_cron na origem (para não processar agendadas em dobro).
2. Dump final + restauração num Supabase de destino limpo (ou recriar o do ensaio) — etapas 3.1 a 3.3.
3. `05-pos-migracao.sql` com `app_url = https://vittadesk.com.br`.
4. App de produção no Coolify com domínio `vittadesk.com.br`.
5. Vercel: remover `vittadesk.com.br` do projeto e criar registro A → `200.141.17.224` no DNS da Vercel
   (ou mover o DNS para outro provedor).
6. Mensagens que chegarem à Vercel entre o dump e a propagação do DNS ficam só na origem:
   copiar o delta (`created_at > horário do dump`) de `wa_messages`, `wa_conversations`, `leads`,
   `lead_stage_history`, `wa_message_costs` e rodar de novo o `04-copiar-storage.mjs` (é idempotente).
7. O webhook da Meta não muda (continua `https://vittadesk.com.br/api/whatsapp/webhook`).

### 6.1 Como foi a troca (26/10/2026)
- 08:30 push do congelamento (`src/lib/migracao.ts`): na Vercel, telas em manutenção e webhook repassado à VPS.
- 08:31 jobs da origem pausados com `cron.alter_job(..., active := false)` (UPDATE direto em cron.job dá permissão negada).
- 08:32–08:33 dump (49 s) + `06-recarregar-dados.sh` (estrutura idêntica à do ensaio) + delta do storage + `05-pos-migracao.sql`.
  Contagens iguais à origem (2.882 leads, 28.252 mensagens, 3.926 conversas, 272 orçamentos, 10 usuários).
- 08:38 DNS trocado (A → 200.141.17.224). O 1º pedido de certificado falhou (DNS ainda na Vercel); um redeploy resolveu.
- O DNS da Hostinger (153.92.2.6, usado pela VPS) segurou o IP antigo por mais tempo: os jobs do pg_cron passaram a chamar
  `https://vittadesk.app.vacivitta.com.br` (mesmo app, sem depender do DNS da Vercel).
- `CRON_SECRET` trocado depois da troca (app + jobs).
- GitHub Actions: o passo de deploy pode estourar o tempo se a VPS estiver ocupada; nesse caso, deploy manual pela API.

### 7. Depois da troca
- Acompanhar 48 h: webhook, realtime, jobs (`SELECT * FROM cron.job_run_details ORDER BY start_time DESC`).
- Manter o Supabase gerenciado em pausa (não apagar) por 2 semanas como contingência.
- Desligar o projeto na Vercel.

## Rollback
Até o passo 6.5, basta não trocar o DNS. Depois: reapontar o DNS para a Vercel e reativar os jobs na origem;
copiar para a origem o delta gerado na VPS.

## Pendências
- Nenhuma. Tudo pronto para a troca de 26/10.

Resolvidas: `WHATSAPP_APP_ID`/`WHATSAPP_APP_SECRET` no Coolify (validados na Meta em 23/10), connection string da origem (testada 23/10), backup no R2 (etapa 4.1), SMTP do Auth via Brevo, token do Coolify só de deploy no GitHub Actions.

## Registro de migrações e restauração (desde 28–29/10/2026)
- **Registro de versões:** `supabase_migrations.schema_migrations` não existia na VPS. É criado uma vez por `docs/migracao-vps/registro-migracoes.sql` (Infra, com aprovação, como `supabase_admin`), com uma linha de base `089` para 001–089. Não registrar 001–089 uma a uma: a 085 foi aplicada só em parte e algumas migrações antigas não rodam num banco do zero.
- **Cada migração nova** (090 em diante): aplicar com `--single-transaction`, registrar a versão **como `supabase_admin`** (`INSERT ... (version, name) VALUES ('0NN', '<nome>') ON CONFLICT DO NOTHING`) e rodar `notify pgrst, 'reload schema'`. No Postgres 15.8 da produção, `postgres` não é superusuário e não grava no registro, de propósito (só lê, por ser membro de `pg_read_all_data`).
- **Nunca usar a CLI do Supabase contra a produção** (`db push`, `migration repair`, `db reset`): ela tentaria aplicar 001–089.
- **Papel:** migração com GRANT/REVOKE ou que substitui função `SECURITY DEFINER` roda como `supabase_admin`. Como `postgres`, o REVOKE não tem efeito e só gera aviso.
- **Depois de qualquer restauração do backup (OBRIGATÓRIO): ordem pós-restore.** O restore recria as funções com o privilégio padrão (EXECUTE para `authenticated`; `anon` fechado pela 091) e sem os REVOKE das migrações; o teste de restauração de 29/10 mostrou isso nas 12 funções restritas da 118. Reaplicar, como `supabase_admin`, cada uma com `--single-transaction` (registrar versão não precisa: já estão no registro), **nesta ordem exata: 113, 115, 121, 123, 124, 126, 127, 128, 129, 130, 131, 132, 133, 134, 135, 137, 138, 141, 118** — a mesma do CLAUDE.md, e o `tests/db/run.sh` simula o restore, aplica essa ordem e confere que privilégios e definições de toda função e view do `public` voltam ao estado de antes. Por quê:
  - **118 por último**: a guarda dela aborta se alguma `SECURITY DEFINER` estiver aberta para `authenticated` fora da lista dela, e depois do restore estão abertas as de 121–133 (`mesclar_leads`, `registrar_erro_app`, funções de `lead_tags`, `lead_anexos` e de tags por tipo). A 090 não serve mais (a guarda dela é anterior à `is_gestor()`).
  - **113 e 115** fecham de novo as funções de trigger `fn_guard_lead_unit_change` e `fn_guard_unit_tipo`; **123** e **124** fecham `reservar_destinatarios_campanha` e `registrar_erro_app`.
  - **121 → 126 → 127 → 128 → 129**: cada uma recria `mesclar_leads` inteira a partir da anterior; a 129 tem de ser a última delas (parar antes traz uma versão que perde o status, recusa toda mesclagem ou perde os campos do lead removido).
  - **126 → 131 → 132 → 134**: 126 recria `leads_kanban`/`leads_arquivados` e `execute_quote_automation` com as regras antigas; 131 traz de volta a versão da automação que leva o perdido à etapa de perda; 132 recria as duas views com a regra do arquivamento (a 131 depois dela aborta: reaplicar a 132 de novo); 134 acrescenta `campos` à `leads_kanban` e só roda sobre a forma da 132. A 126 reaplicada não mexe em arquivamentos (`arquivado` é gerada).
  - **130** depois da 129 (depende dela), **133** depois da 132 e antes da 118, **135** depois da 132 (fecha as funções de trigger dela e o `anon` de `criar_campanha`), **137** em qualquer ponto antes da 118 (fecha o `authenticated` de `reservar_mensagens_agendadas` e `reservar_disparo_por_tempo`), **138** em qualquer ponto antes da 118 (fecha `fn_quote_expirado_automacao`), **141** em qualquer ponto antes da 118 (fecha as funções de trigger `fn_valida_fuso` e `fn_horario_mesma_unidade`).
  Conferir depois com `has_function_privilege`: `anon` = `false` em todas as funções `SECURITY DEFINER` e `authenticated` = `true` só em `is_global_admin`, `is_admin`, `is_gestor`, `get_agent_stats` e nas duas `record_stage_history`. Migração nova que crie função com REVOKE, recrie função ou view destas entra nesta ordem (e no `ordem_pos_restore` do `tests/db/run.sh`, que confere que este texto e o CLAUDE.md trazem a mesma sequência).

## Campanhas de WhatsApp: migração 123 e job `process-wa-campaigns` (passo manual, [H])
Desde a 123 as campanhas andam sozinhas: o botão Disparar só marca a campanha como `enviando` e o job
`process-wa-campaigns` (a cada minuto) inicia as agendadas, retoma as pausadas por limite diário à meia-noite
de São Paulo e envia um lote por campanha. Sem o job, campanha agendada nunca dispara e as demais param depois
do primeiro lote. Ordem:

1. Aplicar `123_campanhas_agendamento.sql` como `supabase_admin`, com `--single-transaction`; registrar a versão
   `123` e rodar `notify pgrst, 'reload schema'`. Conferir:
   `SELECT has_function_privilege('authenticated', 'public.reservar_destinatarios_campanha(uuid,int)', 'EXECUTE');` → `false`.
   Depois de um restore, reaplicar a 123 também (é idempotente e fecha o EXECUTE de novo).
2. Deploy do app com a rota `/api/whatsapp/process-campaigns` (antes disso o job receberia 404).
3. Campanhas `agendada` criadas antes desta versão têm `scheduled_at` 3 h adiantado (a tela gravava o horário
   digitado sem fuso e o banco lia como UTC). Assim que o job existir, elas disparam nesse horário adiantado, ou
   na hora, se ele já passou. Listar (só leitura) e decidir com o responsável antes do passo 4:
   ```sql
   SELECT id, nome, total_recipients,
          scheduled_at AT TIME ZONE 'America/Sao_Paulo' AS como_esta_sp,
          (scheduled_at + interval '3 hours') AT TIME ZONE 'America/Sao_Paulo' AS provavel_horario_digitado
     FROM public.wa_campaigns WHERE status = 'agendada' ORDER BY scheduled_at;
   ```
   Opções (com aprovação): corrigir as escolhidas com
   `UPDATE public.wa_campaigns SET scheduled_at = scheduled_at + interval '3 hours' WHERE id IN (...) AND status = 'agendada';`
   ou voltar para rascunho (`SET status = 'rascunho'`) para alguém disparar à mão.
4. Criar o job copiando URL e cabeçalho do job de agendadas, sem digitar o segredo:
   ```sql
   SELECT cron.schedule('process-wa-campaigns', '* * * * *',
          replace(command, '/api/whatsapp/process-scheduled', '/api/whatsapp/process-campaigns'))
     FROM cron.job WHERE jobname = 'process-wa-scheduled-messages';
   ```
   Equivalente com os valores explícitos (`<app_url>` e `<cron_secret>` como no `05-pos-migracao.sql`):
   ```sql
   SELECT cron.schedule('process-wa-campaigns', '* * * * *',
     $c$SELECT net.http_post(url := '<app_url>/api/whatsapp/process-campaigns',
        headers := jsonb_build_object('Authorization', 'Bearer <cron_secret>', 'Content-Type', 'application/json'),
        body := '{}'::jsonb)$c$);
   ```
5. Conferir: `SELECT jobname, schedule, active FROM cron.job;` e, depois de 2 min,
   `SELECT status, return_message, start_time FROM cron.job_run_details WHERE jobid = (SELECT jobid FROM cron.job WHERE jobname = 'process-wa-campaigns') ORDER BY start_time DESC LIMIT 3;`
   e `SELECT status_code, created FROM net._http_response ORDER BY created DESC LIMIT 5;` (200; 401 = segredo errado).

Reversão: `SELECT cron.unschedule('process-wa-campaigns');` (as campanhas em `enviando` param onde estão).

## Anexos do lead: migração 128 e bucket privado `lead-anexos` ([H])
Primeiro bucket privado do projeto: guarda carteira de vacinação, pedido médico, contrato e proposta (dado de saúde,
LGPD). Não tem policy em `storage.objects`: só o servidor (service_role) lê e grava, e o navegador recebe uma URL
assinada de 5 minutos pela rota `GET /api/leads/[id]/anexos/[anexoId]`, depois de a rota conferir o acesso ao lead.

1. Antes (só leitura): `\d storage.buckets` precisa ter `public`, `file_size_limit` e `allowed_mime_types`; e
   `SELECT policyname, qual, with_check FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects';`
   não pode ter policy sem filtro de `bucket_id` (policies se somam e alcançariam o bucket novo). A guarda da 128
   aborta nos dois casos.
2. Aplicar `128_lead_anexos.sql` como `supabase_admin`, com `--single-transaction`, **depois da 126 e da 127** (a guarda
   recusa rodar sem elas); registrar a versão `128` e rodar
   `notify pgrst, 'reload schema'`. Conferir: `SELECT public, file_size_limit FROM storage.buckets WHERE id = 'lead-anexos';`
   → `f`, `20971520`; `SELECT has_function_privilege('authenticated', 'public.mesclar_leads(uuid,uuid,uuid)', 'EXECUTE');` → `false`.
   Depois de um restore, seguir a ordem pós-restore (seção de migrações acima): fecha de novo o EXECUTE e deixa
   vigente a `mesclar_leads` completa.
3. Deploy do app. A ordem importa pouco: sem a 128 a aba Anexos mostra erro ao carregar; sem o deploy ninguém usa o bucket.
   A 126, a 127 e a 128 recriam `mesclar_leads` inteira, cada uma partindo do corpo da anterior; a última aplicada é a
   que vale. Reaplicar a 126 ou a 127 depois da 128 traz de volta uma versão sem `lead_anexos` (toda mesclagem aborta
   com "chave estrangeira para leads sem tratamento"): nesse caso, reaplicar em seguida a 128 e a 129.

O que muda na operação:
- **Backup:** o `backup.sh` não está no repositório; pela etapa 4.1 ele copia "pg_dump + Storage". O storage do
  Supabase da VPS grava os objetos de todos os buckets no mesmo volume do MinIO, com o id do bucket no caminho, então
  copiar o volume inteiro inclui o bucket novo sem mudar o script (privado ou público não muda nada para o backup).
  Não deu para confirmar pela leitura do script: o Infra confere uma vez, depois do primeiro anexo, que o arquivo do
  dia tem `lead-anexos`
  (a cópia de dados de saúde para o R2 fica sob as mesmas chaves e retenção dos demais dados). Num restore, a tabela
  `lead_anexos` (pg_dump) e os objetos (volume) precisam vir do **mesmo** dia; um anexo sem objeto abre com
  "Arquivo indisponível".
- **Copiar storage entre ambientes** (`04-copiar-storage.mjs`): cria o bucket no destino com o `public` da origem, então o
  bucket continua privado.
- **Apagar lead:** a rota `api/leads/delete` apaga os arquivos antes do lead. Lead apagado por fora da rota (SQL,
  Studio, PostgREST direto) deixa os arquivos no bucket: o `ON DELETE CASCADE` leva só as linhas. Para achar sobras
  (só leitura): objetos de `lead-anexos` cujo `name` não está em `public.lead_anexos.caminho`.
- **Transferir lead:** `lead_anexos.unit_id` acompanha o lead no mesmo `UPDATE` (trigger); a rota `api/leads/transfer`
  move os arquivos para `<unidade nova>/<lead>/`. Se mover falhar, o anexo continua com o caminho antigo (válido) e o
  log diz quantos ficaram. Depois de mesclar leads, os anexos do lead removido continuam no prefixo dele; `caminho` é
  a fonte da verdade, não o prefixo.
- **Tamanho do corpo:** `next.config.ts` sobe `experimental.proxyClientMaxBodySize` para 21 MB. Com o `src/proxy.ts`,
  o Next entrega à rota só os primeiros 10 MB do corpo (padrão), sem erro. Se houver limite de corpo no proxy da VPS
  (Traefik do Coolify não tem por padrão) ou no Kong/storage (`FILE_SIZE_LIMIT`, padrão 50 MB), ele precisa ser ≥ 21 MB.

Reversão: ver o fim da `128_lead_anexos.sql` (os objetos do bucket precisam ser apagados pela API do storage antes).

## Campos personalizados do lead: migração 129 ([H])
Cria `campos_lead` (definição por unidade, com funil opcional; escrita só gestor/admin) e `leads.campos` (jsonb validado
por trigger: chave de campo ativo da unidade e do funil do lead, valor do tipo certo, senão erro 23514).

1. Aplicar `129_campos_personalizados.sql` como `supabase_admin`, com `--single-transaction`, **depois da 126, 127 e 128**
   (a guarda recusa rodar sem elas); registrar a versão `129` e rodar `notify pgrst, 'reload schema'`. O `ADD COLUMN` com
   default constante não reescreve `leads`. Conferir: `SELECT has_function_privilege('authenticated', 'public.mesclar_leads(uuid,uuid,uuid)', 'EXECUTE');`
   → `false`; `SELECT pg_get_userbyid(proowner) FROM pg_proc WHERE oid = 'public.mesclar_leads(uuid,uuid,uuid)'::regprocedure;`
   → `supabase_admin` (o trigger não valida o que o dono junta na mesclagem; a guarda final da 129 confere).
2. Deploy do app. Sem a 129 a seção Informações da ficha mostra erro ao carregar; sem o deploy ninguém usa os campos.
3. A 129 recria `mesclar_leads` a partir do corpo da 128 (mais a fusão de `campos`). Depois de um restore, seguir a
   ordem pós-restore (seção de migrações acima). Reaplicar uma anterior depois da 129 traz de volta uma versão que perde os
   campos do lead removido: nesse caso, reaplicar a 129 em seguida.

Reversão: ver o cabeçalho da `129_campos_personalizados.sql` (perde os valores gravados).

## Campos obrigatórios por etapa: migração 130 ([H])
Cria `funnel_stages.campos_obrigatorios` (o gestor escolhe, por etapa, campos fixos `lead:*` e campos personalizados
exigidos para entrar) e o trigger `fn_lead_obrigatorios`, que barra só quem grava como `authenticated` (pessoa no app)
com o SQLSTATE `VC001`. Automações, webhook, importação pelo servidor e transferência (service_role) movem sem exigir.

1. Aplicar `130_obrigatorios_etapa.sql` como `supabase_admin`, com `--single-transaction`, **depois da 129** (a guarda
   recusa rodar sem ela) e **antes do deploy** (a tela de funis lê a coluna nova); registrar a versão `130` e rodar
   `notify pgrst, 'reload schema'`. O `ADD COLUMN` com default constante não reescreve `funnel_stages`. Conferir:
   `SELECT count(*) FROM funnel_stages WHERE campos_obrigatorios <> '{}';` → `0` (ninguém exige nada até o gestor configurar);
   `SELECT has_function_privilege('authenticated', 'public.fn_lead_obrigatorios()', 'EXECUTE');` → `false`.
2. Deploy do app.
3. A 130 não recria `mesclar_leads` (a mesclagem não muda etapa). Depois de um restore, reaplicá-la depois da 129 só
   fecha de novo o EXECUTE das funções dela (idempotente).

Reversão: ver o cabeçalho da `130_obrigatorios_etapa.sql` (perde a configuração das etapas).

## Perdido na etapa de perda: migração 131 ([H])
Corrige o "perdido some do funil" da 126: `leads_kanban` volta a mostrar os perdidos que estão na etapa de perda do funil
(`funnel_stages.resultado = 'perdido'`), e os perdidos fora dela vão para ela quando o funil tem uma. Funil sem etapa de
perda continua como antes (o lead fica só no painel Perdidos). O app novo (`marcarPerdido`) passa a mover para a etapa de
perda no mesmo update do status e grava o histórico com `movido_via = 'perdido'`.

1. Aplicar `131_perdido_na_etapa.sql` como `supabase_admin`, com `--single-transaction`, **depois da 130** (a guarda recusa
   rodar sem ela); registrar a versão `131` e rodar `notify pgrst, 'reload schema'`. Os NOTICEs dizem quantos perdidos
   foram movidos e quantos ficaram no quadro e só no painel. `status`, `perdido_em` e o motivo não mudam (a migração
   aborta se mudarem). Conferir: `SELECT has_table_privilege('anon', 'public.leads_kanban', 'SELECT');` → `false`.
2. Ordem com o deploy: tanto faz, mas o melhor é **deploy primeiro, 131 depois**. Com a 131 antes do deploy, o app antigo
   ainda marca perdido sem mudar a etapa, e esses leads somem do quadro até o deploy; reaplicar a 131 depois do deploy
   (idempotente) os leva para a etapa de perda. Com o deploy antes da 131, quem é marcado perdido já vai para a etapa de
   perda, mas só aparece no quadro depois da 131 (até lá, só no painel Perdidos, como hoje).
3. A 131 também recria `execute_quote_automation` (corpo da 126): o ramo `archive` move o lead para a etapa de perda
   e grava o histórico (`movido_via = 'perdido'`). Conferir: `SELECT has_function_privilege('authenticated',
   'public.execute_quote_automation(uuid,uuid,text,text)', 'EXECUTE');` → `false`. Não recria `mesclar_leads`. Depois
   de um restore, reaplicá-la **depois da 126** (a 126 recria `leads_kanban` escondendo todos os perdidos e a
   automação sem mover a etapa) e antes da 132; a 118 reaplicada depois dela passa.

Reversão: ver o cabeçalho da `131_perdido_na_etapa.sql`.

## Arquivar separado de Perdido: migração 132 ([H])
Arquivar volta a ser uma ação própria: tira o lead do quadro (spam, engano, fornecedor, funcionário, duplicado...) com
motivo, sem mudar o negócio. `leads.arquivado` continua coluna gerada, agora por `arquivado_em IS NOT NULL`
(arquivar = gravar `arquivado_em` + `arquivado_motivo`); `leads_kanban` esconde só os arquivados e `leads_arquivados`
lista só eles (painel Arquivados do funil). Os antigos arquivados (perdidos antes da 126 que a 131 levou para a etapa de
perda, ou que continuam fora de uma etapa de perda) voltam a ser arquivados, com o motivo da perda; status, motivo e
etapa não mudam.

1. Aplicar `132_arquivar.sql` como `supabase_admin`, com `--single-transaction`, **depois da 131** (a guarda recusa
   rodar sem ela); registrar a versão `132` e rodar `notify pgrst, 'reload schema'`. O NOTICE diz quantos voltaram a
   ser arquivados (esperado: 34 levados pela 131, mais os antigos arquivados de funis sem etapa de perda, se houver).
   Reescreve `leads` (DROP/ADD COLUMN STORED, como a 126), rápido. Conferir:
   `SELECT has_table_privilege('anon', 'public.leads_arquivados', 'SELECT');` → `false`;
   `SELECT has_function_privilege('authenticated', 'public.fn_lead_arquivado()', 'EXECUTE');` → `false`.
2. Ordem com o deploy: **132 primeiro, deploy logo depois**. O app novo grava/lê `arquivado_em` e `arquivado_motivo`
   (sem a 132: arquivar dá erro, a exportação falha e `.eq('arquivado', false)` ainda tira todos os perdidos do
   dashboard). O app de hoje não grava `arquivado` nem as colunas novas e continua funcionando com a 132; até o deploy,
   o painel "Perdidos" dele mostra os arquivados e mensagem recebida reabre o negócio mas não desarquiva.
3. Não recria `mesclar_leads` nem `execute_quote_automation` (o ramo `archive` da automação de orçamento continua
   PERDENDO o lead). Na mesclagem o lead mantido conserva o próprio arquivamento. Depois de um restore, reaplicá-la
   **depois da 126 e da 131** (as duas recriam `leads_kanban`; a 126 também `leads_arquivados`) e antes da 134: ordem
   pós-restore na seção de migrações acima. A 131 reaplicada depois da 132 aborta (a view tem mais colunas): reaplicar a 132 de novo. A 126
   reaplicada depois da 132 não mexe nos arquivamentos (`arquivado` continua gerada, a parte de dados dela é pulada).
   Reaplicar a 132 não rearquiva quem foi desarquivado.

Reversão: ver o cabeçalho da `132_arquivar.sql` (perde os arquivamentos).

## Tags de cliente e de conversa: migração 133 ([H])
Cada tag passa a ter um tipo (`wa_tags.tipo`): **cliente** (`lead`, aplicada na ficha) ou **conversa** (aplicada no
Atendimento). A ficha só oferece tags de cliente, a conversa só as de conversa, e o banco recusa (23514) aplicar tag do
tipo errado ou trocar o tipo de uma tag já aplicada. Tags existentes viram de conversa; a usada em lead e em conversa
ganha uma cópia de cliente (mesmo nome e cor) com as aplicações dos leads; a usada só em leads vira de cliente.

1. Aplicar `133_tags_por_tipo.sql` como `supabase_admin`, com `--single-transaction`, **depois da 132** (a guarda
   recusa rodar sem ela); registrar a versão `133` e rodar `notify pgrst, 'reload schema'`. O NOTICE diz quantas
   tags ficaram de conversa, quantas cópias de cliente foram criadas, quantas aplicações em leads foram repontadas e
   quantas tags passaram a ser de cliente (em 04/11: 17 tags e 39 aplicações em leads, todas da 127; as 39 em conversas
   não mudam). Conferir: `SELECT has_function_privilege('authenticated', 'public.tag_aplicada_tipo()', 'EXECUTE');` e o
   mesmo para `public.wa_tags_troca_tipo()` → `false`.
2. Ordem com o deploy: **133 primeiro, deploy logo depois**. O app novo lê e grava `wa_tags.tipo` (sem a 133 as telas
   de tag dão erro). O app de hoje continua criando tags (o padrão da coluna é `conversa`), mas até o deploy mostra as
   duas listas juntas (as cópias de cliente aparecem como nomes repetidos) e aplicar tag do tipo errado dá erro.
3. Depois de um restore, reaplicar a 133 **antes da 118** (a guarda da 118 recusa as funções de trigger dela abertas
   para `authenticated`). Reaplicar não refaz as cópias. Reaplicar a 127 ou a 092 não mexe nos triggers da 133.

Reversão: ver o cabeçalho da `133_tags_por_tipo.sql`.

## Campos personalizados no kanban: migração 134 ([H])
`leads_kanban` passa a trazer `leads.campos` (última coluna), para o filtro do funil por campo personalizado (seleção,
múltipla e sim/não). Só a definição da view muda (a da 132 + `l.campos`); não mexe em dados.

1. Aplicar `134_kanban_campos.sql` como `supabase_admin`, com `--single-transaction`, **depois da 132** (a guarda
   recusa rodar sem `arquivado_em` na view); registrar a versão `134` e rodar `notify pgrst, 'reload schema'`.
   Conferir: `SELECT has_table_privilege('anon', 'public.leads_kanban', 'SELECT');` → `false`.
2. Ordem com o deploy: tanto faz, o melhor é **134 primeiro**. O app lê `leads_kanban` com `select('*')`: sem a 134 o
   filtro por campo aparece, mas não encontra nenhum lead; o app de hoje ignora a coluna nova.
3. Depois de um restore, reaplicá-la **depois da 132** (a 132 faz DROP + CREATE da view e tira `campos`): ordem
   pós-restore na seção de migrações acima. A 132 reaplicada depois da 134 passa, mas tira a coluna: reaplicar a 134 em seguida.

Reversão: ver o cabeçalho da `134_kanban_campos.sql`.

## Pendências das fases 1 e 2: migração 135 ([H])
Protege no banco o que o app já fazia e fecha duas brechas:
- Etapa ou funil com algum lead (aberto, perdido ou arquivado) não exclui mais (`leads.stage_id` e `leads.funnel_id`
  `ON DELETE RESTRICT`, erro 23503). Excluir etapa vazia mantém o histórico de quem passou por ela
  (`lead_stage_history.para_stage_id` aceita NULL, `ON DELETE SET NULL`; gravar movimento continua exigindo destino).
  Funil vazio exclui como antes (etapas em cascata); os campos personalizados dele ficam na unidade, desativados, em
  vez de serem apagados.
- Etapa ou funil usado como filtro de automação por tempo (`wa_timed_automations.filter_stage_id`/`filter_funnel_id`,
  antes `SET NULL`) também não exclui (`ON DELETE RESTRICT`, 23503): com `SET NULL` a automação perdia o filtro e
  passava a valer para todos os leads da unidade. O app novo diz qual automação usa; o de hoje mostra o erro do banco.
- `criar_campanha` (SECURITY INVOKER, sob RLS) cria campanha e destinatários de uma vez; o app novo chama pela rota
  `/api/whatsapp/campaign-create`.
- `sales_goals`: `UNIQUE NULLS NOT DISTINCT (unit_id, user_id, month)`; a meta do mês da unidade não duplica mais.

1. Aplicar `135_pendencias.sql` como `supabase_admin`, com `--single-transaction`, **depois da 132**; registrar a versão
   `135` e rodar `notify pgrst, 'reload schema'`. Aborta se houver metas repetidas em `sales_goals` (a mensagem diz
   quantos grupos; apagar as repetidas, com aprovação, e aplicar de novo). Conferir:
   `SELECT has_function_privilege('anon', 'public.criar_campanha(uuid,text,uuid,timestamptz,integer,jsonb)', 'EXECUTE');`
   → `false`.
2. Ordem com o deploy: **135 primeiro, deploy depois**. O app novo cria campanha por `criar_campanha` (sem a 135, criar
   campanha dá erro). O app de hoje funciona com a 135: não exclui etapa nem funil com leads e cria campanha pelas
   tabelas.
3. Não recria função SECURITY DEFINER: a 118 reaplicada depois passa. Depois de um restore, reaplicar a 135 (idempotente,
   na ordem pós-restore) fecha de novo o EXECUTE das funções de trigger dela e o de `anon` em `criar_campanha`.

Reversão: ver o cabeçalho da `135_pendencias.sql` (volta a apagar histórico ao excluir etapa).

## Notificações por pessoa: migração 136 ([H])
A notificação pessoal (menção, orçamento aceito, recusado, vencendo, vencido) passa a ser lida só por quem a recebe; o
aviso da unidade continua para quem está nela e para o admin da marca. A leitura passa a ser por pessoa
(`notification_reads`), e o app deixa de alterar `notifications`.

1. Aplicar `136_notificacoes_por_pessoa.sql` como `supabase_admin`, com `--single-transaction`; registrar a versão
   `136` e rodar `notify pgrst, 'reload schema'`. Converte o que já estava lido (pessoal: leitura do destinatário;
   aviso da unidade: leitura de quem está na unidade). Conferir:
   `SELECT count(*) FROM public.notification_reads;` → igual a
   `SELECT count(*) FILTER (WHERE user_id IS NOT NULL) + (SELECT count(*) FROM public.notifications n JOIN public.user_units u USING (unit_id) WHERE n.lida AND n.user_id IS NULL) FROM public.notifications WHERE lida;`.
2. Ordem com o deploy: **136 primeiro, deploy depois**. O sino novo lê e grava `notification_reads`. Entre a 136 e o
   deploy, o sino de hoje continua listando, já sem as notificações de colegas, mas não consegue marcar como lida (o
   PATCH em `notifications` dá 403 e o sino ignora o erro).
3. Não cria função: fora da ordem pós-restore.

Reversão: ver o cabeçalho da `136_notificacoes_por_pessoa.sql`.

## Envio sem duplicata: migração 137 ([H])
`process-scheduled` e `process-timed-automations` passam a reservar o que vão enviar antes de chamar a Meta:
- `reservar_mensagens_agendadas(limite)`: reserva agendadas vencidas com `FOR UPDATE SKIP LOCKED`
  (`wa_scheduled_messages.reservado_em`); reserva com mais de 10 min sem envio volta a ser pega. O status fica
  `pending` até o envio.
- `reservar_disparo_por_tempo(automação, lead, conversa)`: grava a linha de `wa_timed_automation_log` antes da ação,
  com `UNIQUE (automation_id, alvo_chave)`; devolve NULL se o alvo já foi disparado. O app apaga a linha quando o
  disparo não se consuma.

1. Aplicar `137_reserva_envios.sql` como `supabase_admin`, com `--single-transaction`; registrar a versão `137` e
   rodar `notify pgrst, 'reload schema'`. Aborta se `wa_timed_automation_log` tiver dois disparos para o mesmo alvo
   (em 05/11/2026 o log estava vazio). Conferir:
   `SELECT has_function_privilege('authenticated', 'public.reservar_mensagens_agendadas(int)', 'EXECUTE');` → `false`.
2. Ordem com o deploy: **137 primeiro, deploy depois**. O app novo chama as duas funções (sem a 137, agendadas e
   automações por tempo param com erro). O app de hoje funciona com a 137: ignora `reservado_em` e grava o log sem
   `alvo_chave` (NULL não colide no UNIQUE).
3. Depois de um restore, reaplicar a 137 (idempotente, na ordem pós-restore) fecha de novo o EXECUTE das duas funções.

Reversão: ver o cabeçalho da `137_reserva_envios.sql`.

## Orçamento expirado dispara automação: migração 138 ([H])
Trigger `trg_quote_expirado_automacao` em `quotes`: na passagem para `expirado` (cron `check-expiring`, página
`/orcamento` ou qualquer outro caminho), se a unidade tem regra ativa de expirado em `quote_automations`, chama
`execute_quote_automation` e grava a execução em `automation_runs` (gatilho `quote_expirado`). Falha da automação é
registrada e não desfaz a expiração. Os orçamentos que já estão expirados não disparam.

1. Aplicar `138_orcamento_expirado_automacao.sql` como `supabase_admin`, com `--single-transaction`; registrar a
   versão `138` e rodar `notify pgrst, 'reload schema'`. Conferir:
   `SELECT has_function_privilege('authenticated', 'public.fn_quote_expirado_automacao()', 'EXECUTE');` → `false`.
2. Não depende de deploy: o app de hoje já dispara a regra ao expirar. O app desta versão só mostra as execuções de
   orçamento com nome na tela de Automações.
3. Depois de um restore, reaplicar a 138 (idempotente, na ordem pós-restore) fecha de novo o EXECUTE da função.

Reversão: ver o cabeçalho da `138_orcamento_expirado_automacao.sql`.

## Cor da unidade: migração 139 ([H])
`units.cor` (#RRGGBB) para a caixa de entrada e o sino de quem atende várias unidades. Preenche as unidades sem cor
com a paleta do app (`src/lib/unidades.ts`), na ordem de criação.

1. Aplicar `139_cor_da_unidade.sql` como `supabase_admin`, com `--single-transaction`; registrar a versão `139` e rodar
   `notify pgrst, 'reload schema'`. Conferir: `SELECT count(*) FROM public.units WHERE cor IS NULL;` → `0`.
2. Pode ir antes ou depois do deploy: o app desta versão usa a paleta pela posição quando a unidade não tem cor, e o de
   hoje ignora a coluna.
3. Não cria função: fora da ordem pós-restore.

Reversão: ver o cabeçalho da `139_cor_da_unidade.sql`.

## Regras pelas unidades vinculadas: migração 140 ([H])
As 13 tabelas que liberavam só a unidade ativa (`profiles.unit_id`) passam a liberar as unidades vinculadas
(`user_units`) e o admin da marca: `internal_channels`, `internal_channel_messages`, `sales_goals`, `unit_payment_fees`,
`wa_automations`, `wa_campaigns`, `wa_campaign_recipients`, `wa_message_costs`, `wa_message_templates`, `wa_queues`,
`wa_queue_agents`, `wa_quick_replies` e `wa_template_folders`.

1. Ordem com o deploy: **deploy do app desta versão primeiro, 140 depois**. O app desta versão filtra explicitamente
   pela unidade ativa as telas que contavam com a regra (modelos e respostas rápidas no Atendimento e no LeadModal,
   lista e Realtime de campanhas). Aplicar a 140 com o app anterior faz essas telas misturarem unidades.
2. Aplicar `140_rls_unidades_vinculadas.sql` como `supabase_admin`, com `--single-transaction`; registrar a versão
   `140` e rodar `notify pgrst, 'reload schema'`. A própria migração falha se sobrar regra com `profiles.unit_id`.
   Conferir: `SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND qual ~ 'profiles.unit_id';` → `0`.
3. Não cria função: fora da ordem pós-restore.

Reversão: ver o cabeçalho da `140_rls_unidades_vinculadas.sql`.

## Horário de atendimento: migração 141 ([H])
`units.fuso` (padrão São Paulo, só o admin da marca altera), `horarios_atendimento` (da unidade e exceções por fila
ou funil), `horario_faixas` e `feriados` (nacionais com `unit_id` NULL, só o admin da marca altera), mais
`dentro_do_horario` e `proxima_abertura`. Ninguém consome ainda: os fluxos (3·3) vão usar.

1. Aplicar `141_horario_atendimento.sql` como `supabase_admin`, com `--single-transaction`; registrar a versão `141`
   e rodar `notify pgrst, 'reload schema'`. Conferir:
   `SELECT public.dentro_do_horario(id, now()) FROM public.units LIMIT 1;` → `true` (sem horário configurado, aberta).
2. Ordem com o deploy: **141 primeiro, deploy depois** (a tela nova lê as tabelas). O app de hoje ignora a 141.
3. Funil com exceção de horário não exclui (23503, `ON DELETE RESTRICT`, como os outros vínculos a funis da 135).
4. Depois de um restore, reaplicar a 141 (idempotente, na ordem pós-restore) fecha de novo o EXECUTE das funções de
   trigger dela.

Reversão: ver o cabeçalho da `141_horario_atendimento.sql`.

## Erros do servidor no log do container
`src/instrumentation.ts` (`onRequestError`) grava cada erro não tratado em `app_errors` (migração 124), com telefone,
e-mail, token e UUID mascarados, e é ali que se investiga. O Next 16 continua imprimindo o erro cru no stdout do
container (`docker logs`/Coolify), com a mensagem inteira, que pode trazer dados pessoais: quem imprime é o próprio Next
(`RouteModule.onRequestError` faz `console.error(err)`, ou `logError` do servidor, logo antes de chamar o nosso
`onRequestError`). Não há opção suportada para desligar isso no modo standalone que a imagem usa (`node server.js`):
`logging` do `next.config` só vale para o modo dev, e a opção `quiet` (que esconde esses erros) é do servidor
customizado (`next({ quiet: true })`), que a documentação do Next diz não funcionar junto com o standalone; trocar seria
mudar a imagem e o deploy, fora do escopo. Também não trocamos o `console.error` global (não suportado, e esconderia os
nossos logs). Por isso: o log do container é dado sensível (acesso só do Infra, retenção curta), e os logs que o próprio
app escreve usam `resumoErro` (`src/lib/log-seguro.ts`), que não imprime o objeto do erro.
