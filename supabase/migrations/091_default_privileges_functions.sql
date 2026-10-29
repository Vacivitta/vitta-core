-- 091_default_privileges_functions.sql
-- Correção de raiz: função NOVA no schema public não nasce executável por PUBLIC/anon.
-- Preparada e testada pelo Infra em 29/10/2026 (DEFAULT-PRIVILEGES, fora do
-- repositório); versionada aqui sem BEGIN/COMMIT e com guardas.
--
-- APLICAR EM PRODUÇÃO É [H]: o Infra aplica, com aprovação do Pedro e backup do
-- dia confirmado, como supabase_admin:
--   psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 --single-transaction -f 091_...sql
-- e registra a versão '091' no registro de versões (como supabase_admin).
--
-- O que NÃO faz:
--   - não altera nenhuma função existente (default privileges só valem para objetos novos);
--   - não substitui reaplicar a 090 depois de um restore: o restore recria as funções
--     e, com esta migração, anon fica fechado, mas authenticated volta nas 12
--     funções restritas. Reaplicar a 090 depois de qualquer restore continua OBRIGATÓRIO;
--   - não mexe em tabelas nem sequences (quem protege as tabelas é o RLS).
--
-- authenticated e service_role continuam recebendo EXECUTE por padrão no public.
-- Se um dia o app precisar de RPC chamada SEM login, a migração dela faz
-- GRANT EXECUTE ... TO anon explícito.
--
-- Reversão exata: docs/migracao-vps/reversao-091.sql.
-- Idempotente: ALTER DEFAULT PRIVILEGES repetido não muda o estado.

SET LOCAL lock_timeout = '5s';

-- Guarda: transação única (SET LOCAL só vale dentro dela) e papel certo
-- (alterar defaults FOR ROLE supabase_admin exige supabase_admin)
DO $$
BEGIN
  IF current_setting('lock_timeout') <> '5s' THEN
    RAISE EXCEPTION '091: rode com --single-transaction (lock_timeout atual: %)', current_setting('lock_timeout');
  END IF;
  IF current_user <> 'supabase_admin' THEN
    RAISE EXCEPTION '091: rodar como supabase_admin (atual: %)', current_user;
  END IF;
END $$;

-- 1) anon fora do default do public, para os dois papéis que criam funções
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres       IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM anon;

-- 2) PUBLIC fora do default global. Sem isto o passo 1 não vale: anon herda de
--    PUBLIC, e o Postgres só permite remover PUBLIC no default global.
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres       REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

-- 3) Compensação OBRIGATÓRIA: devolve PUBLIC por schema em todos os schemas da
--    stack que não são o public, para extensões, upgrades e serviços (auth,
--    storage, realtime, cron, net, vault, graphql...) continuarem como antes.
--    Só nos schemas que existem: num banco montado do zero alguns não existem.
--    Na produção todos os 12 existem (leitura do Infra em 29/10/2026).
DO $$
DECLARE s text;
BEGIN
  FOREACH s IN ARRAY ARRAY['_realtime', 'auth', 'cron', 'extensions', 'graphql', 'graphql_public',
                           'net', 'pgbouncer', 'realtime', 'storage', 'supabase_functions', 'vault'] LOOP
    IF to_regnamespace(s) IS NOT NULL THEN
      EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA %I GRANT EXECUTE ON FUNCTIONS TO PUBLIC', s);
      EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA %I GRANT EXECUTE ON FUNCTIONS TO PUBLIC', s);
    ELSE
      RAISE NOTICE '091: schema % não existe neste banco; compensação ignorada', s;
    END IF;
  END LOOP;
END $$;

-- Guarda: uma função criada agora no public não pode ficar com anon/PUBLIC;
-- authenticated e service_role sim. Cria e apaga dentro da mesma transação.
DO $$
DECLARE a bool; u bool; sr bool; p bool;
BEGIN
  CREATE FUNCTION public.zz_teste_default_priv() RETURNS int LANGUAGE sql AS 'select 1';
  SELECT has_function_privilege('anon',          'public.zz_teste_default_priv()', 'EXECUTE'),
         has_function_privilege('authenticated', 'public.zz_teste_default_priv()', 'EXECUTE'),
         has_function_privilege('service_role',  'public.zz_teste_default_priv()', 'EXECUTE'),
         coalesce((SELECT bool_or(x.grantee = 0) FROM pg_proc pr, aclexplode(pr.proacl) x
                    WHERE pr.oid = 'public.zz_teste_default_priv()'::regprocedure), false)
    INTO a, u, sr, p;
  DROP FUNCTION public.zz_teste_default_priv();
  IF a OR p OR NOT u OR NOT sr THEN
    RAISE EXCEPTION '091: default privileges inesperados: anon=% public=% authenticated=% service_role=%', a, p, u, sr;
  END IF;
END $$;
