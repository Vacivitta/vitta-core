# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## Commands

```bash
npm run dev      # dev server at http://localhost:3000
npm run build    # production build (runs tsc + Next.js compilation)
npm run lint     # eslint; old errors are frozen in eslint-suppressions.json, new ones fail
npm run typecheck # tsc --noEmit --skipLibCheck
npm run test:db  # builds the database from scratch in Docker and runs tests/db (Linux + Docker; see tests/db/README.md)
npm test         # node --test tests/*.test.mjs (no deps; Node strips the TS types of src/lib files it imports)
```

CI (`.github/workflows/ci.yml`) runs typecheck, lint, `npm test` and the database tests on every PR. Phone normalization has one rule in two places (`src/lib/telefone.ts` and SQL `normalizar_telefone`, migration 121), both checked against `tests/db/telefone_casos.json`: change the cases and both implementations together. Run the typecheck after every change that touches `src/types/database.ts` or any shared type, and add a case to `tests/db/` for any migration that changes RLS, privileges or guards.

## Architecture

### Stack
- **Next.js 16** (App Router) — server components fetch data and pass as props to a single `*Client.tsx` file per page. No mixing of server/client code in the same file.
- **Self-hosted Supabase on the VPS** (Coolify, service `supabase-vitta-core`, API at `https://api-vittadesk.app.vacivitta.com.br`) — PostgreSQL 15 + Auth + Realtime + Storage. Lean stack: no analytics, edge functions or supavisor. It is not supabase.com.
- **Production:** `https://vittadesk.com.br`, on the VPS since 2026-10-26. GitHub Actions builds the `ghcr.io/vacivitta/vitta-core` image on every push to `main` and Coolify deploys it. Details and history in `docs/migracao-vps/runbook.md`.
- **Tailwind CSS v4** — utility classes plus inline `style={}` for dynamic values
- **Meta Graph API v20.0** — WhatsApp Business messaging

### Multi-tenant model
Every resource in the database has a `unit_id` column (a clinic/franchise unit). Row-Level Security (RLS) on Supabase restricts reads to the user's own unit. API routes that need cross-unit access (webhooks, cron jobs, admin operations) use the **service-role client** from `src/lib/supabase/admin.ts`, which bypasses RLS. Never use the service-role client in browser code or in response to unauthenticated requests.

### Lead status (migration 126)
`leads.status` is the deal: `aberto | ganho | perdido`. Write it only through `marcarGanho`/`marcarPerdido`/`reabrir` (`src/lib/leads.ts`); `leads.arquivado` is a generated column (`status = 'perdido'`) and rejects writes. `is_converted` means "is a client" and never goes back. The trigger `fn_lead_status` derives the status from `funnel_stages.resultado` when a lead changes stage and fills `ganho_em`/`perdido_em`. Lost reasons live in `motivos_perda` (per funnel). Funnels, stages and lost reasons are editable only by gestor/admin (RLS). An inbound WhatsApp message reopens a `ganho`/`perdido` deal (`reaberturaPorMensagem`, `src/lib/status-lead.ts`).

### Supabase clients
| File | Usage |
|------|-------|
| `src/lib/supabase/server.ts` | Server components and API route handlers — uses `@supabase/ssr` with cookies |
| `src/lib/supabase/client.ts` | `'use client'` components — browser singleton |
| `src/lib/supabase/admin.ts` | Service-role client — bypasses RLS, server-only |

In API routes the pattern is: use `createServerClient()` to authenticate the calling user, then `adminClient()` (or the inline equivalent) to perform the actual DB operations with elevated privileges.

### Page pattern
Each page follows a consistent two-file pattern:
- `src/app/<route>/page.tsx` — **server component** only: auth check, DB fetches via `createClient()`, passes typed props to the client component. No UI here.
- `src/app/<route>/<Name>Client.tsx` — **`'use client'` component**: all state, Realtime subscriptions, event handlers, and JSX. Self-contained and large (hundreds to 1000+ lines is normal).

### Auth & roles
Roles are stored in `profiles.perfil`: `admin | gestor_vacivitta | gestor_unidade | atendente`. The `ProfileContext` (`src/context/ProfileContext.tsx`) makes `{ profile, perfil, isGestor, isAdmin }` available anywhere under `AppShell`. Server-side role checks are done by querying `profiles` after `supabase.auth.getUser()`.

Auth flow: email/password via `supabase.auth.signInWithPassword`. Password reset goes through `/auth/callback` (PKCE + token_hash) → `/auth/reset-password`. The callback detects `type=recovery` and redirects to `/auth/reset-password` instead of `/funil`.

### WhatsApp integration
Credentials live in the `wa_config` table (one row per unit). `src/lib/whatsapp/credentials.ts` → `getWaCredentials(unitId)` reads from DB first, falls back to env vars (`WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_ACCESS_TOKEN`, etc.). All outbound calls use Meta Graph API v20.0.

Key API routes under `src/app/api/whatsapp/`:
- `webhook/route.ts` — receives Meta events (messages + status updates), calls `runAutoAssign`
- `send/route.ts` — sends text or template messages
- `schedule/route.ts` — creates/lists/cancels scheduled messages (`wa_scheduled_messages` table)
- `process-scheduled/route.ts` — cron target; called every minute via pg_cron + pg_net; needs `Authorization: Bearer <CRON_SECRET>` header. All cron routes check it with `cronAutorizado()` (`src/lib/auth/cron.ts`), which rejects every call when `CRON_SECRET` is unset
- `process-campaigns/route.ts` — cron target (`process-wa-campaigns`, every minute, `CRON_SECRET`): starts due scheduled campaigns, resumes those paused by the daily limit at São Paulo midnight and sends one batch per `enviando` campaign via `src/lib/whatsapp/campanha.ts`. Recipients are claimed with `reservar_destinatarios_campanha` (migration 123), so the cron and the Disparar button never double-send; the daily limit is per unit (number), summing all its campaigns
- `meta-templates/route.ts` — CRUD for WhatsApp Business templates against Meta API

### WhatsApp template variables
Templates with `{{N}}` variables require:
1. `example.body_text` in the Meta API payload (required by Meta, array-of-arrays)
2. `variable_order JSONB` stored in `wa_message_templates` — maps position index → semantic name (`nome_cliente`, `nome_atendente`, `data`, `horario`)
3. At send time, `variable_order` is read to build the `components` parameter with resolved values

### Database migrations
Migrations live in `supabase/migrations/` as plain SQL files numbered sequentially (e.g., `057_*.sql`). Never edit a migration that has already been applied; create a new one.

- **There is no local database and no supabase.com SQL Editor.** Never run anything against production to test: write the migration, check syntax and logic by reading, and open a PR. The self-hosted Supabase Studio exists on the VPS (a Coolify service container that is normally stopped to save memory); it is not for applying migrations — ask Infra if you need it.
- **Applying in production requires explicit human approval** (with the file reviewed beforehand) and is done by Infra or the human, over SSH on the VPS, running `psql` inside the Postgres container of the `supabase-vitta-core` service in a single transaction (`--single-transaction`, `ON_ERROR_STOP=1`; no `BEGIN`/`COMMIT` inside the file). Afterwards, record the version and run `notify pgrst, 'reload schema'`. Procedure in the `supabase-vps` skill.
- **Run as `supabase_admin`** any migration that grants/revokes privileges or replaces a `SECURITY DEFINER` function: it owns those functions and granted their privileges, so a `REVOKE` run as `postgres` silently does nothing (that is why 085's revokes never took effect).
- **Version registry:** `supabase_migrations.schema_migrations`, created by `docs/migracao-vps/registro-migracoes.sql`. Migrations 001–089 are covered by a single baseline row (`089`); from 090 on, each applied migration inserts its own row (`version` = number only, e.g. `090`). **Insert the row as `supabase_admin`**: in production (Postgres 15.8) `postgres` is not a superuser and cannot write to the registry, on purpose (it can only read it, through `pg_read_all_data`).
- **Never use the Supabase CLI against production** (`db push`, `migration repair`, `db reset`): it does not see 001–089 in the registry and would try to apply them.
- **`SECURITY DEFINER` functions:** revoke `EXECUTE` from `PUBLIC` and `anon` explicitly (and from `authenticated` unless the browser calls it), and prove it after applying with `has_function_privilege(...)`, not by reading the migration. Only `is_global_admin`, `is_admin`, `is_gestor`, `record_stage_history` and `get_agent_stats` are executable by `authenticated` today (migrations 090, 113 and 118); `tests/db/020_privilegios.test.sql` checks this list.
- **After any database restore, re-apply migration 118 as `supabase_admin`** (not 090: its guard predates `is_gestor()` and aborts since 113) and check `has_function_privilege` — this step is **mandatory**: the restore reopens those functions to `anon` **and** `authenticated` (restore test of 2026-10-29). Migration 091 keeps `anon` closed after a restore, but `authenticated` still comes back on the 12 restricted functions, so it does not replace this step. 118 does not know `mesclar_leads` (121): after a restore also re-apply 121 (its own guard refuses calls whose JWT role is `anon`/`authenticated`, but the GRANT must be closed too) and then 126, 127 and 128, in this order. 126 replaces `mesclar_leads` and `execute_quote_automation` with the status-aware versions; 127 replaces `mesclar_leads` again (126's body plus `lead_tags`) and 128 once more (127's body plus `lead_anexos`). Each of them recreates the whole function, so the last one applied wins: always finish with the newest migration that recreates `mesclar_leads` (today 128). Stopping at 121, 126 or 127 brings back a `mesclar_leads` that loses the status or refuses every merge (its FK lock does not know `lead_tags`/`lead_anexos`).
- Before applying, confirm with Infra that today's backup exists and that restoring it has been tested (see the runbook); do not assume it. Destructive migrations (DROP, DELETE, ALTER that loses data) also need a fresh backup and specific approval.
- **Production queries are read-only**: SSH + `psql` with `set default_transaction_read_only = on`. Prefer counts and aggregates; never pull personal data (LGPD).
- After changing the schema, update `src/types/database.ts` and run the typecheck.
- RLS is on for every `public` table, scoped by `unit_id`; never disable it to test.

### Public routes
Routes without a logged-in user (e.g. the public quote link) use the service-role client on the server with their own checks (e.g. by `token_publico`). `src/proxy.ts` lets these paths through **without a session**: `/api/whatsapp*` (all of it), `/api/orcamento/respond` and `/api/orcamento/check-expiring`. Any new route under those paths must authenticate by itself (user session, `CRON_SECRET`, webhook signature or public token). Do not rely on the `anon` key reading tables or calling RPCs: helper functions such as `is_global_admin()` are no longer executable by `anon`, so those calls now fail instead of returning empty results.

### Types
`src/types/database.ts` is the single source of truth for all entity shapes. It exports both interfaces and utility types (`displayName`, `QUOTE_STATUS_LABELS`, etc.). Supabase query results are cast to these types at the server component layer before being passed to clients.

### AppShell & layout
`src/components/layout/AppShell.tsx` wraps every authenticated page with `ProfileProvider`, `AppSidebar`, and `TaskReminder`. Public paths (`/login`, `/orcamento/ver/`, `/termos`, `/privacidade`) skip this wrapper entirely.

### Key large client components
- `src/app/atendimento/AtendimentoClient.tsx` — the WhatsApp inbox: conversation list, chat panel, lead context sidebar, quick replies, templates, scheduling, notes. Uses Supabase Realtime for live updates.
- `src/components/leads/LeadModal.tsx` — full lead detail sheet (notes, tasks, contacts, quotes, stage history).
- `src/app/orcamento/OrcamentosClient.tsx` — quote builder with product selector, PDF generation, and public share link.
- `src/app/agenda/AgendaClient.tsx` — unified calendar for `lead_tasks` and `wa_scheduled_messages` using a discriminated union `AgendaItem = { kind: 'task' } | { kind: 'message' }`.
- `src/app/tarefas/TarefasClient.tsx` — standalone task list (all users see all tasks by default).

### Scheduled messages processing
`wa_scheduled_messages` stores pending messages with `scheduled_for`. The cron job (`pg_cron` calling `net.http_post`) fires `/api/whatsapp/process-scheduled` every minute. The route fetches due messages, resolves WhatsApp credentials per unit (cached in a `Map`), sends to Meta, and writes results back to `wa_messages`. Templates are sent with their stored `components` payload; text messages use the `content` field.
