SET LOCAL lock_timeout = '5s';

DO $$
BEGIN
  IF current_setting('lock_timeout') <> '5s' THEN
    RAISE EXCEPTION '118: rode com --single-transaction (lock_timeout atual: %)', current_setting('lock_timeout');
  END IF;
  IF current_user <> 'supabase_admin' THEN
    RAISE EXCEPTION '118: rodar como supabase_admin (atual: %)', current_user;
  END IF;
  IF to_regprocedure('public.is_gestor()') IS NULL THEN
    RAISE EXCEPTION '118: depende da 113 (is_gestor)';
  END IF;
END $$;

REVOKE EXECUTE ON FUNCTION
  public.create_quote_notification(uuid,uuid,text,text,text,uuid,uuid),
  public.execute_quote_automation(uuid,uuid,text,text),
  public.increment_wa_unread(uuid),
  public.get_agent_stats(uuid),
  public.record_stage_history(uuid,uuid,uuid,uuid),
  public.record_stage_history(uuid,uuid,uuid,uuid,text),
  public.is_global_admin(),
  public.is_gestor(),
  public.fn_auto_link_creator_to_unit(),
  public.fn_guard_profile_privileges(),
  public.fn_notify_chat_interno_mentions(),
  public.fn_notify_note_mentions(),
  public.fn_notify_quote_expired(),
  public.fn_notify_wa_note_mentions(),
  public.handle_new_user(),
  public.log_responsible_change()
FROM PUBLIC, anon;

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

GRANT EXECUTE ON FUNCTION
  public.get_agent_stats(uuid),
  public.record_stage_history(uuid,uuid,uuid,uuid),
  public.record_stage_history(uuid,uuid,uuid,uuid,text),
  public.is_global_admin(),
  public.is_gestor()
TO authenticated;

GRANT EXECUTE ON FUNCTION
  public.create_quote_notification(uuid,uuid,text,text,text,uuid,uuid),
  public.execute_quote_automation(uuid,uuid,text,text),
  public.increment_wa_unread(uuid),
  public.get_agent_stats(uuid),
  public.record_stage_history(uuid,uuid,uuid,uuid),
  public.record_stage_history(uuid,uuid,uuid,uuid,text),
  public.is_global_admin(),
  public.is_gestor(),
  public.fn_auto_link_creator_to_unit(),
  public.fn_guard_profile_privileges(),
  public.fn_notify_chat_interno_mentions(),
  public.fn_notify_note_mentions(),
  public.fn_notify_quote_expired(),
  public.fn_notify_wa_note_mentions(),
  public.handle_new_user(),
  public.log_responsible_change()
TO service_role;

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

DO $$
DECLARE
  permitidas oid[] := array_remove(ARRAY[
    to_regprocedure('public.get_agent_stats(uuid)'),
    to_regprocedure('public.record_stage_history(uuid,uuid,uuid,uuid)'),
    to_regprocedure('public.record_stage_history(uuid,uuid,uuid,uuid,text)'),
    to_regprocedure('public.is_global_admin()'),
    to_regprocedure('public.is_admin()'),
    to_regprocedure('public.is_gestor()')
  ]::oid[], NULL);
  abertas_anon text;
  abertas_auth text;
BEGIN
  SELECT string_agg(p.oid::regprocedure::text, ', ') INTO abertas_anon
    FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace
     AND p.prosecdef
     AND (has_function_privilege('anon', p.oid, 'EXECUTE')
          OR EXISTS (SELECT 1 FROM aclexplode(p.proacl) a WHERE a.grantee = 0));

  SELECT string_agg(p.oid::regprocedure::text, ', ') INTO abertas_auth
    FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace
     AND p.prosecdef
     AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
     AND NOT (p.oid = ANY (permitidas));

  IF abertas_anon IS NOT NULL THEN
    RAISE EXCEPTION '118: executáveis por anon/PUBLIC: %', abertas_anon;
  END IF;
  IF abertas_auth IS NOT NULL THEN
    RAISE EXCEPTION '118: executáveis por authenticated fora das permitidas: %', abertas_auth;
  END IF;
END $$;
