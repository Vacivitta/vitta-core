-- 125_revoga_truncate_trigger.sql
-- Tira TRUNCATE, TRIGGER e REFERENCES de anon e authenticated nas tabelas do public.
--
-- Por quê: os privilégios padrão do Supabase dão ALL em tabela nova a anon e
-- authenticated. Em 03/11/2026 as 45 tabelas do public estavam com TRUNCATE para
-- os dois papéis (leitura em produção). TRUNCATE ignora o RLS: quem conseguisse
-- executar SQL como esses papéis apagaria uma tabela inteira de todas as unidades.
-- Hoje o risco é baixo (a porta do Postgres não é publicada e o PostgREST não
-- executa TRUNCATE), mas a proteção não pode depender disso. TRIGGER (criar
-- trigger em tabela alheia) e REFERENCES também não têm uso pelo app.
--
-- O que faz:
--   1. REVOKE nas tabelas existentes do public;
--   2. ALTER DEFAULT PRIVILEGES para que tabelas novas (criadas por postgres ou
--      supabase_admin) já nasçam sem esses privilégios.
-- SELECT/INSERT/UPDATE/DELETE não mudam: quem controla é o RLS.
--
-- Aplicar em produção é [H]: como supabase_admin, com --single-transaction,
-- backup do dia; depois registrar a versão '125'. Sem BEGIN/COMMIT. Idempotente.
--
-- Reversão (só com aprovação): GRANT TRUNCATE, TRIGGER, REFERENCES ON ALL TABLES
-- IN SCHEMA public TO anon, authenticated; e os ALTER DEFAULT PRIVILEGES com GRANT.

SET LOCAL lock_timeout = '5s';

DO $$
BEGIN
  IF current_setting('lock_timeout') <> '5s' THEN
    RAISE EXCEPTION '125: rode com --single-transaction (lock_timeout atual: %)', current_setting('lock_timeout');
  END IF;
  IF current_user <> 'supabase_admin' THEN
    RAISE EXCEPTION '125: rodar como supabase_admin (atual: %)', current_user;
  END IF;
END $$;

REVOKE TRUNCATE, TRIGGER, REFERENCES ON ALL TABLES IN SCHEMA public FROM anon, authenticated;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres       IN SCHEMA public REVOKE TRUNCATE, TRIGGER, REFERENCES ON TABLES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public REVOKE TRUNCATE, TRIGGER, REFERENCES ON TABLES FROM anon, authenticated;

DO $$
DECLARE abertas text;
BEGIN
  SELECT string_agg(c.oid::regclass::text, ', ') INTO abertas
    FROM pg_class c
   WHERE c.relnamespace = 'public'::regnamespace
     AND c.relkind IN ('r', 'p')
     AND (has_table_privilege('anon', c.oid, 'TRUNCATE')
          OR has_table_privilege('authenticated', c.oid, 'TRUNCATE')
          OR has_table_privilege('anon', c.oid, 'TRIGGER')
          OR has_table_privilege('authenticated', c.oid, 'TRIGGER'));
  IF abertas IS NOT NULL THEN
    RAISE EXCEPTION '125: tabelas ainda com TRUNCATE/TRIGGER para anon/authenticated: %', abertas;
  END IF;
END $$;
