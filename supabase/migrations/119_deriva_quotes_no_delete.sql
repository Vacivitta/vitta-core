-- 119_deriva_quotes_no_delete.sql
-- Deriva: remove o trigger quotes_no_delete (010), que não existe em produção.
--
-- A 010 cria quotes_no_delete / prevent_quote_delete(), que barra qualquer DELETE
-- de orçamento. Em produção ele foi removido fora das migrações (leitura do Infra,
-- F0-D de 30/10/2026), e quem controla o DELETE é a policy gestores_quotes_delete
-- (116). Sem esta migração, um banco montado do zero (testes de tests/db) se
-- comporta diferente da produção.
--
-- Em produção é um no-op: registrar a versão depois de aplicar. Aplicar como
-- supabase_admin, com --single-transaction. Sem BEGIN/COMMIT. Idempotente.

SET LOCAL lock_timeout = '5s';

DO $$
BEGIN
  IF current_setting('lock_timeout') <> '5s' THEN
    RAISE EXCEPTION '119: rode com --single-transaction (lock_timeout atual: %)', current_setting('lock_timeout');
  END IF;
  IF current_user <> 'supabase_admin' THEN
    RAISE EXCEPTION '119: rodar como supabase_admin (atual: %)', current_user;
  END IF;
END $$;

DROP TRIGGER IF EXISTS quotes_no_delete ON public.quotes;
DROP FUNCTION IF EXISTS public.prevent_quote_delete();
