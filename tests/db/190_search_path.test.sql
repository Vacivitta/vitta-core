-- SECURITY DEFINER do public com search_path fixo (migração 142)

-- 1. Nenhuma SECURITY DEFINER do public sem search_path fixo
DO $$
DECLARE sem_search_path text;
BEGIN
  SELECT string_agg(p.oid::regprocedure::text, ', ' ORDER BY p.oid::regprocedure::text)
    INTO sem_search_path
    FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace
     AND p.prosecdef
     AND NOT EXISTS (SELECT 1 FROM unnest(p.proconfig) c WHERE c LIKE 'search_path=%');
  IF sem_search_path IS NOT NULL THEN
    RAISE EXCEPTION 'SECURITY DEFINER do public sem search_path fixo: %', sem_search_path;
  END IF;
END $$;

-- 2. is_global_admin() chamada de dentro de uma função com search_path '' (a 141
-- chama as regras de acesso assim): antes da 142 dava 42P01 em profiles
INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('00000000-0000-4000-8190-000000000001', 'admin190@teste.invalid', '{"full_name": "Admin 190"}'),
  ('00000000-0000-4000-8190-000000000002', 'atendente190@teste.invalid', '{"full_name": "Atendente 190"}');
UPDATE public.profiles SET perfil = 'admin' WHERE id = '00000000-0000-4000-8190-000000000001';

CREATE FUNCTION pg_temp.global_admin_sem_search_path(usuario uuid) RETURNS text
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  PERFORM pg_catalog.set_config('request.jwt.claims',
    pg_catalog.json_build_object('sub', usuario, 'role', 'authenticated')::text, true);
  RETURN public.is_global_admin()::text;
EXCEPTION WHEN OTHERS THEN
  RETURN 'erro ' || SQLSTATE || ': ' || SQLERRM;
END $$;

DO $$
DECLARE r text;
BEGIN
  r := pg_temp.global_admin_sem_search_path('00000000-0000-4000-8190-000000000001');
  IF r IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION 'is_global_admin() com search_path '''' para um admin: esperado true, veio %', r;
  END IF;
  r := pg_temp.global_admin_sem_search_path('00000000-0000-4000-8190-000000000002');
  IF r IS DISTINCT FROM 'false' THEN
    RAISE EXCEPTION 'is_global_admin() com search_path '''' para um atendente: esperado false, veio %', r;
  END IF;
END $$;

-- 3. Uma tabela profiles em pg_temp (o schema temporário de quem chama, procurado
-- antes dos outros quando não está no search_path) não engana is_global_admin()
CREATE TEMP TABLE profiles (id uuid, perfil text);
INSERT INTO pg_temp.profiles VALUES ('00000000-0000-4000-8190-000000000002', 'admin');

DO $$
DECLARE r text;
BEGIN
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', '00000000-0000-4000-8190-000000000002', 'role', 'authenticated')::text, true);
  r := public.is_global_admin()::text;
  IF r IS DISTINCT FROM 'false' THEN
    RAISE EXCEPTION 'is_global_admin() leu pg_temp.profiles: atendente virou admin (veio %)', r;
  END IF;
END $$;

DROP TABLE pg_temp.profiles;
