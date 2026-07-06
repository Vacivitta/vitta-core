# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## Commands

```bash
npm run dev      # dev server at http://localhost:3000
npm run build    # production build (runs tsc + Next.js compilation)
npm run lint     # eslint across the project
npx tsc --noEmit --skipLibCheck   # type-check only, no output files
```

There are no automated tests. TypeScript (`npx tsc --noEmit`) is the primary correctness gate — run it after every change that touches `src/types/database.ts` or any shared type.

## Architecture

### Stack
- **Next.js 16** (App Router) — server components fetch data and pass as props to a single `*Client.tsx` file per page. No mixing of server/client code in the same file.
- **Supabase** (project `kewupumnkvglodidwuqz`, region us-east-2) — PostgreSQL + Auth + Realtime + Storage
- **Tailwind CSS v4** — utility classes plus inline `style={}` for dynamic values
- **Meta Graph API v20.0** — WhatsApp Business messaging

### Multi-tenant model
Every resource in the database has a `unit_id` column (a clinic/franchise unit). Row-Level Security (RLS) on Supabase restricts reads to the user's own unit. API routes that need cross-unit access (webhooks, cron jobs, admin operations) use the **service-role client** from `src/lib/supabase/admin.ts`, which bypasses RLS. Never use the service-role client in browser code or in response to unauthenticated requests.

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
- `process-scheduled/route.ts` — cron target; called every minute via pg_cron + pg_net; needs `Authorization: Bearer <CRON_SECRET>` header
- `meta-templates/route.ts` — CRUD for WhatsApp Business templates against Meta API

### WhatsApp template variables
Templates with `{{N}}` variables require:
1. `example.body_text` in the Meta API payload (required by Meta, array-of-arrays)
2. `variable_order JSONB` stored in `wa_message_templates` — maps position index → semantic name (`nome_cliente`, `nome_atendente`, `data`, `horario`)
3. At send time, `variable_order` is read to build the `components` parameter with resolved values

### Database migrations
Migrations live in `supabase/migrations/` as plain SQL files numbered sequentially (e.g., `057_*.sql`). Apply via the Supabase SQL Editor or `supabase db push`. There is no local Supabase instance — all development is against the hosted project.

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
