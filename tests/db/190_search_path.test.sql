-- SECURITY DEFINER do public com search_path fixo (migração 142). Cada checagem
-- anota a falha em pg_temp.falhas e o fim do arquivo levanta todas juntas.
CREATE TEMP TABLE falhas (checagem text);

-- 1. Nenhuma SECURITY DEFINER do public sem search_path fixo
INSERT INTO pg_temp.falhas
SELECT 'SECURITY DEFINER do public sem search_path fixo: '
       || string_agg(p.oid::regprocedure::text, ', ' ORDER BY p.oid::regprocedure::text)
  FROM pg_proc p
 WHERE p.pronamespace = 'public'::regnamespace
   AND p.prosecdef
   AND NOT EXISTS (SELECT 1 FROM unnest(p.proconfig) c WHERE c LIKE 'search_path=%')
HAVING count(*) > 0;

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

INSERT INTO pg_temp.falhas
SELECT format('is_global_admin() com search_path '''' para %s: esperado %s, veio %s', quem, esperado, veio)
  FROM (VALUES ('um admin', '00000000-0000-4000-8190-000000000001'::uuid, 'true'),
               ('um atendente', '00000000-0000-4000-8190-000000000002'::uuid, 'false')) AS c(quem, usuario, esperado)
 CROSS JOIN LATERAL (SELECT pg_temp.global_admin_sem_search_path(c.usuario) AS veio) r
 WHERE r.veio IS DISTINCT FROM c.esperado;

-- 3. Uma tabela profiles em pg_temp (o schema temporário de quem chama, procurado
-- antes dos outros quando não está no search_path) não engana is_global_admin()
CREATE TEMP TABLE profiles (id uuid, perfil text);
INSERT INTO pg_temp.profiles VALUES ('00000000-0000-4000-8190-000000000002', 'admin');

SELECT set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-4000-8190-000000000002', 'role', 'authenticated')::text, true);
INSERT INTO pg_temp.falhas
SELECT 'is_global_admin() leu pg_temp.profiles: atendente virou admin'
 WHERE public.is_global_admin();

DROP TABLE pg_temp.profiles;

DO $$
DECLARE lista text;
BEGIN
  SELECT string_agg(checagem, E'\n') INTO lista FROM pg_temp.falhas;
  IF lista IS NOT NULL THEN
    RAISE EXCEPTION E'%', lista;
  END IF;
END $$;
