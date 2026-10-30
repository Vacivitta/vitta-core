-- 090_function_execute_grants.sql
-- Privilégios de EXECUTE das funções SECURITY DEFINER do schema public.
--
-- JÁ APLICADA EM PRODUÇÃO em 28/10/2026 pelo Infra, com aprovação humana
-- (registro fora do repositório). Em produção: registrar a versão sem reaplicar.
--
-- Por quê: os REVOKE da 085 não tiveram efeito em produção. As funções pertencem
-- a supabase_admin, que também concedeu os grants; um REVOKE rodado como postgres
-- só remove o que postgres concedeu, e o Postgres só emite aviso. Com isso, a
-- chave anon (pública no navegador) executava estas funções por RPC, ignorando o RLS.
--
-- Como rodar: como supabase_admin (dono e grantor), com
--   psql --single-transaction -v ON_ERROR_STOP=1
-- Sem BEGIN/COMMIT neste arquivo, para não quebrar o --single-transaction.
-- Idempotente: REVOKE e GRANT repetidos não mudam o estado. A guarda no fim
-- aborta (e desfaz tudo) se algo continuar aberto, inclusive quando rodada pelo
-- papel errado e o REVOKE falhar em silêncio.
--
-- Quem chama cada função (motivo de manter ou tirar authenticated):
--   navegador / usuário logado: is_global_admin e is_admin (policies RLS e
--     src/lib/auth/access.ts), record_stage_history (LeadModal, src/lib/leads.ts),
--     get_agent_stats (dashboard/page.tsx)
--   só service_role: execute_quote_automation, create_quote_notification
--     (api/orcamento), increment_wa_unread (webhook do WhatsApp)
--   só triggers: as demais (o EXECUTE é checado ao criar o trigger, não ao disparar)
--
-- is_admin() e rls_auto_enable() existem em produção, mas só entram no
-- repositório pela 092 (deriva). Aqui elas são tratadas apenas se existirem,
-- para que um banco montado do zero pelas migrações não falhe.

SET LOCAL lock_timeout = '5s';

-- ── A) Todas: tirar de PUBLIC e anon ─────────────────────────────────────────
REVOKE EXECUTE ON FUNCTION
  public.create_quote_notification(uuid,uuid,text,text,text,uuid,uuid),
  public.execute_quote_automation(uuid,uuid,text,text),
  public.increment_wa_unread(uuid),
  public.get_agent_stats(uuid),
  public.record_stage_history(uuid,uuid,uuid,uuid),
  public.record_stage_history(uuid,uuid,uuid,uuid,text),
  public.is_global_admin(),
  public.fn_auto_link_creator_to_unit(),
  public.fn_guard_profile_privileges(),
  public.fn_notify_chat_interno_mentions(),
  public.fn_notify_note_mentions(),
  public.fn_notify_quote_expired(),
  public.fn_notify_wa_note_mentions(),
  public.handle_new_user(),
  public.log_responsible_change()
FROM PUBLIC, anon;

-- ── B) Sem uso pelo usuário logado: tirar de authenticated ───────────────────
REVOKE EXECUTE ON FUNCTION
  public.create_quote_notification(uuid,uuid,text,text,text,uuid,uuid),
  public.execute_quote_automation(uuid,uuid,text,text),
  public.increment_wa_unread(uuid),
  public.fn_auto_link_creator_to_unit(),
  public.fn_guard_profile_privileges(),
  public.fn_notify_chat_interno_mentions(),
  public.fn_notify_note_mentions(),
  public.fn_notify_quote_expired(),
  public.fn_notify_wa_note_mentions(),
  public.handle_new_user(),
  public.log_responsible_change()
FROM authenticated;

-- ── C) Usadas pelo usuário logado: manter authenticated (explícito) ──────────
GRANT EXECUTE ON FUNCTION
  public.get_agent_stats(uuid),
  public.record_stage_history(uuid,uuid,uuid,uuid),
  public.record_stage_history(uuid,uuid,uuid,uuid,text),
  public.is_global_admin()
TO authenticated;

-- ── D) service_role mantém todas (explícito) ─────────────────────────────────
GRANT EXECUTE ON FUNCTION
  public.create_quote_notification(uuid,uuid,text,text,text,uuid,uuid),
  public.execute_quote_automation(uuid,uuid,text,text),
  public.increment_wa_unread(uuid),
  public.get_agent_stats(uuid),
  public.record_stage_history(uuid,uuid,uuid,uuid),
  public.record_stage_history(uuid,uuid,uuid,uuid,text),
  public.is_global_admin(),
  public.fn_auto_link_creator_to_unit(),
  public.fn_guard_profile_privileges(),
  public.fn_notify_chat_interno_mentions(),
  public.fn_notify_note_mentions(),
  public.fn_notify_quote_expired(),
  public.fn_notify_wa_note_mentions(),
  public.handle_new_user(),
  public.log_responsible_change()
TO service_role;

-- ── E) Funções que só existem em produção até a 092 ──────────────────────────
DO $$
BEGIN
  IF to_regprocedure('public.is_admin()') IS NOT NULL THEN
    REVOKE EXECUTE ON FUNCTION public.is_admin() FROM PUBLIC, anon;
    GRANT  EXECUTE ON FUNCTION public.is_admin() TO authenticated, service_role;
  END IF;

  IF to_regprocedure('public.rls_auto_enable()') IS NOT NULL THEN
    REVOKE EXECUTE ON FUNCTION public.rls_auto_enable() FROM PUBLIC, anon, authenticated;
    GRANT  EXECUTE ON FUNCTION public.rls_auto_enable() TO service_role;
  END IF;
END $$;

-- ── Guarda ───────────────────────────────────────────────────────────────────
-- Aborta se alguma função SECURITY DEFINER do public:
--   1. ficou executável por anon ou PUBLIC; ou
--   2. é executável por authenticated sem estar entre as 5 assinaturas permitidas.
DO $$
DECLARE
  permitidas oid[] := array_remove(ARRAY[
    to_regprocedure('public.get_agent_stats(uuid)'),
    to_regprocedure('public.record_stage_history(uuid,uuid,uuid,uuid)'),
    to_regprocedure('public.record_stage_history(uuid,uuid,uuid,uuid,text)'),
    to_regprocedure('public.is_global_admin()'),
    to_regprocedure('public.is_admin()')
  ]::oid[], NULL);
  abertas_anon int;
  abertas_auth int;
BEGIN
  SELECT count(*) INTO abertas_anon
    FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace
     AND p.prosecdef
     AND (has_function_privilege('anon', p.oid, 'EXECUTE')
          OR EXISTS (SELECT 1 FROM aclexplode(p.proacl) a WHERE a.grantee = 0));

  SELECT count(*) INTO abertas_auth
    FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace
     AND p.prosecdef
     AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
     AND NOT (p.oid = ANY (permitidas));

  IF abertas_anon > 0 THEN
    RAISE EXCEPTION '090: % função(ões) SECURITY DEFINER ainda executável(is) por anon/PUBLIC (rodou como supabase_admin?)', abertas_anon;
  END IF;
  IF abertas_auth > 0 THEN
    RAISE EXCEPTION '090: % função(ões) SECURITY DEFINER executável(is) por authenticated fora das permitidas (rodou como supabase_admin?)', abertas_auth;
  END IF;
END $$;
