DO $$
DECLARE abertas text;
BEGIN
  SELECT string_agg(p.oid::regprocedure::text, ', ') INTO abertas
    FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace
     AND p.prosecdef
     AND (has_function_privilege('anon', p.oid, 'EXECUTE')
          OR EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                      WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE'));
  IF abertas IS NOT NULL THEN
    RAISE EXCEPTION 'funções SECURITY DEFINER executáveis por anon/PUBLIC: %', abertas;
  END IF;
END $$;

DO $$
DECLARE
  permitidas text[] := ARRAY[
    'get_agent_stats(uuid)',
    'is_admin()',
    'is_gestor()',
    'is_global_admin()',
    'record_stage_history(uuid,uuid,uuid,uuid)',
    'record_stage_history(uuid,uuid,uuid,uuid,text)'
  ];
  sobrando text;
  faltando text;
BEGIN
  CREATE TEMP TABLE executaveis ON COMMIT DROP AS
    SELECT replace(p.oid::regprocedure::text, ' ', '') AS assinatura
      FROM pg_proc p
     WHERE p.pronamespace = 'public'::regnamespace
       AND p.prosecdef
       AND has_function_privilege('authenticated', p.oid, 'EXECUTE');
  SELECT string_agg(assinatura, ', ') INTO sobrando
    FROM executaveis WHERE assinatura <> ALL (permitidas);
  SELECT string_agg(a, ', ') INTO faltando
    FROM unnest(permitidas) a WHERE a NOT IN (SELECT assinatura FROM executaveis);
  IF sobrando IS NOT NULL THEN
    RAISE EXCEPTION 'SECURITY DEFINER executáveis por authenticated fora da lista: %', sobrando;
  END IF;
  IF faltando IS NOT NULL THEN
    RAISE EXCEPTION 'SECURITY DEFINER da lista sem EXECUTE para authenticated (o app chama): %', faltando;
  END IF;
END $$;

DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY['public.fn_guard_lead_unit_change()', 'public.fn_guard_unit_tipo()',
                           'public.fn_guard_profile_privileges()'] LOOP
    IF has_function_privilege('authenticated', f, 'EXECUTE') OR has_function_privilege('anon', f, 'EXECUTE') THEN
      RAISE EXCEPTION 'função de trigger % executável por authenticated/anon', f;
    END IF;
  END LOOP;
END $$;

DO $$
DECLARE papel text;
BEGIN
  FOREACH papel IN ARRAY ARRAY['postgres', 'supabase_admin'] LOOP
    EXECUTE format('SET LOCAL ROLE %I', papel);
    CREATE FUNCTION public.zz_teste_privilegio() RETURNS int LANGUAGE sql AS 'SELECT 1';
    RESET ROLE;
    IF has_function_privilege('anon', 'public.zz_teste_privilegio()', 'EXECUTE')
       OR NOT has_function_privilege('authenticated', 'public.zz_teste_privilegio()', 'EXECUTE')
       OR NOT has_function_privilege('service_role', 'public.zz_teste_privilegio()', 'EXECUTE') THEN
      RAISE EXCEPTION 'função nova criada por % com privilégios padrão errados', papel;
    END IF;
    DROP FUNCTION public.zz_teste_privilegio();
  END LOOP;
END $$;
