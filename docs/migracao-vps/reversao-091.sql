-- reversao-091.sql — desfaz a 091 (volta os default privileges ao estado de 29/10/2026).
-- Preparada pelo Infra (DEFAULT-PRIVILEGES). Só com aprovação humana, como supabase_admin:
--   psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 --single-transaction -f reversao-091.sql
-- Sem BEGIN/COMMIT. Depois, remover a linha '091' do registro de versões.

DO $$
DECLARE s text;
BEGIN
  FOREACH s IN ARRAY ARRAY['_realtime', 'auth', 'cron', 'extensions', 'graphql', 'graphql_public',
                           'net', 'pgbouncer', 'realtime', 'storage', 'supabase_functions', 'vault'] LOOP
    IF to_regnamespace(s) IS NOT NULL THEN
      EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA %I REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC', s);
      EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA %I REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC', s);
    END IF;
  END LOOP;
END $$;

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin GRANT EXECUTE ON FUNCTIONS TO PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres       GRANT EXECUTE ON FUNCTIONS TO PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres       IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon;
