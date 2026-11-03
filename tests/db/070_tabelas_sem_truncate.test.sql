DO $$
DECLARE abertas text;
BEGIN
  SELECT string_agg(format('%s (%s)', c.oid::regclass, p.privilegio), ', ') INTO abertas
    FROM pg_class c
   CROSS JOIN (VALUES ('anon'), ('authenticated')) AS r(papel)
   CROSS JOIN (VALUES ('TRUNCATE'), ('TRIGGER'), ('REFERENCES')) AS p(privilegio)
   WHERE c.relnamespace = 'public'::regnamespace
     AND c.relkind IN ('r', 'p')
     AND has_table_privilege(r.papel, c.oid, p.privilegio);
  IF abertas IS NOT NULL THEN
    RAISE EXCEPTION 'tabelas do public com privilégio além de CRUD para anon/authenticated: %', abertas;
  END IF;
END $$;

SET LOCAL ROLE postgres;
CREATE TABLE public.vct_tabela_nova_postgres (id int);
RESET ROLE;
CREATE TABLE public.vct_tabela_nova_admin (id int);

DO $$
BEGIN
  IF has_table_privilege('authenticated', 'public.vct_tabela_nova_postgres', 'TRUNCATE')
     OR has_table_privilege('anon', 'public.vct_tabela_nova_postgres', 'TRUNCATE') THEN
    RAISE EXCEPTION 'tabela nova criada por postgres nasce com TRUNCATE para anon/authenticated';
  END IF;
  IF has_table_privilege('authenticated', 'public.vct_tabela_nova_admin', 'TRUNCATE')
     OR has_table_privilege('anon', 'public.vct_tabela_nova_admin', 'TRUNCATE') THEN
    RAISE EXCEPTION 'tabela nova criada por supabase_admin nasce com TRUNCATE para anon/authenticated';
  END IF;
  IF NOT has_table_privilege('authenticated', 'public.vct_tabela_nova_postgres', 'SELECT') THEN
    RAISE EXCEPTION 'a 125 não deveria tirar SELECT de authenticated (o RLS é quem controla)';
  END IF;
END $$;
