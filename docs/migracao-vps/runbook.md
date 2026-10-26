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
