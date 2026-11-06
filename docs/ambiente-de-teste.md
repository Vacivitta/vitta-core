# Ambiente de teste

Um Supabase descartável na VPS (Postgres, GoTrue, PostgREST e Realtime, nas mesmas
versões da produção), com dados fictícios, para usar o VittaDesk logado sem tocar
na produção. O app roda no seu computador (`npm run dev:teste`, porta 3001) e fala
com esse Supabase por um túnel SSH.

## Como fica isolado

- Projeto Docker `ci-ambiente-teste` na VPS, com containers `ci-ambiente-teste-*`
  e volume próprio. Não usa nenhum container, volume ou segredo da produção.
- Banco, auth, API e Realtime ficam numa rede interna sem saída para a internet.
  Só o gateway (nginx, no papel do Kong) publica, e só em `127.0.0.1:54321` da
  VPS. De fora, só se chega pelo túnel SSH.
- Os segredos (senha do banco, JWT, chaves anon e service_role, `CRON_SECRET`,
  senha dos usuários) são gerados na VPS em `~/ci-ambiente-teste/.env` e baixados
  para `.env.ambiente-teste.local`, que o git ignora (`.env*`).
- Dados só fictícios: e-mails `@teste.invalid` e telefones `55119000000xx`.
- Ocupa cerca de 360 MB de memória na VPS (medido em repouso, sem uso): db 160,
  realtime 170, rest 18, auth 10, gateway 3.

## Usar

Precisa de `bash` e de acesso SSH à VPS pelo alias `vps` (outro host:
`AMBIENTE_TESTE_SSH=<alias>`).

```bash
bash scripts/ambiente-teste/subir.sh
```

```bash
npm run dev:teste
```

Depois, abra http://localhost:3001 e entre com um dos usuários abaixo. A senha
(a mesma para todos) está em `AMBIENTE_TESTE_SENHA`, no `.env.ambiente-teste.local`.

| Usuário | Perfil | Unidades |
|---|---|---|
| `multi@teste.invalid` | atendente | Itu (teste) e Salto (teste) |
| `itu@teste.invalid` | atendente | Itu (teste) |
| `gestor@teste.invalid` | gestor_unidade | Itu (teste) |
| `admin@teste.invalid` | admin (marca) | nenhum vínculo |

A semente (`scripts/ambiente-teste/semente.sql`) traz:
- 3 unidades (Itu, Salto, Comercial);
- um funil por unidade;
- 6 leads com conversa e mensagens;
- uma conexão por unidade (número exibido, sem token);
- filas, modelos e respostas rápidas por unidade;
- 3 notificações: a menção de Ana em Salto, a menção de Bia em Itu (que Ana não
  pode ver) e o aviso da unidade Itu.

`npm run dev:teste` abre o túnel (ou reaproveita um aberto) e roda `next dev` com
as chaves do ambiente. As variáveis do processo valem antes de qualquer `.env.local`,
então um `.env.local` da produção não é usado. No app do Claude Code, a configuração
`ambiente-teste` do `.claude/launch.json` faz o mesmo.

## Comandos

```bash
bash scripts/ambiente-teste/subir.sh estado
```

```bash
bash scripts/ambiente-teste/subir.sh resetar
```

```bash
bash scripts/ambiente-teste/subir.sh derrubar
```

- `subir`: sobe o que falta. Aplica as migrações só num banco vazio e a semente só se
  ela ainda não existe. É idempotente.
- `resetar`: apaga o volume e os segredos e sobe de novo. A senha muda; o
  `.env.ambiente-teste.local` é regravado.
- `derrubar`: para os containers e mantém os dados.

## Testar uma pilha de PRs

As migrações vêm da worktree indicada em `AMBIENTE_TESTE_ORIGEM`; o padrão é esta.
Para testar uma branch com migrações novas, resete o ambiente a partir dela e rode
o app de lá:

```bash
AMBIENTE_TESTE_ORIGEM=../minha-branch bash scripts/ambiente-teste/subir.sh resetar
```

```bash
cd ../minha-branch && node <esta-worktree>/scripts/ambiente-teste/dev.mjs
```

O `.env.ambiente-teste.local` é gravado na worktree de origem.

## O que não funciona aqui

- **Storage** (anexos do lead, mídia de mensagens, imagem de modelo): o serviço de
  storage não sobe. O prelúdio dos testes de banco cria só as tabelas mínimas.
- **WhatsApp**: as conexões não têm token nem WABA, então enviar falha antes de chamar a Meta e
  `/api/whatsapp/meta-templates` responde 503 (aparece no console do Atendimento).
  Mensagens recebidas não chegam; para simular, insira em `wa_messages`.
- **Crons** (`process-scheduled`, `process-campaigns`, `process-timed-automations`,
  `check-expiring`): os jobs que chamam o app não são criados. Chame a rota com
  `Authorization: Bearer <CRON_SECRET>` se precisar.
- **E-mail**: o GoTrue confirma e-mails sozinho e não manda nada; a recuperação de
  senha não chega.

## Arquivos

| Arquivo | Onde roda | O que faz |
|---|---|---|
| `scripts/ambiente-teste/subir.sh` | seu computador | copia o ambiente e as migrações para a VPS, roda o comando lá e baixa as chaves |
| `scripts/ambiente-teste/remoto.sh` | VPS | gera os segredos, sobe os serviços na ordem certa, migra e semeia |
| `scripts/ambiente-teste/compose.yml` | VPS | serviços, redes e limites de memória |
| `scripts/ambiente-teste/nginx.conf` | VPS | caminhos do supabase-js e o CORS do auth, no papel do Kong |
| `scripts/ambiente-teste/semente.sql` | VPS | dados fictícios |
| `scripts/ambiente-teste/dev.mjs` | seu computador | túnel SSH e `next dev` na porta 3001 |

As migrações são aplicadas como no `tests/db/run.sh` e como o Infra aplica em
produção: prelúdio, 001–089 como `postgres`, 090 em diante como `supabase_admin`,
cada uma com `--single-transaction`, e depois o registro de versões.
