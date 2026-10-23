-- 089_performance.sql
-- Correções de desempenho apontadas no diagnóstico de out/2026.

-- ── 1. RLS: avaliar auth.uid()/is_global_admin() uma vez por consulta ─────────
-- Chamadas diretas nas policies são reavaliadas para CADA linha (lint
-- auth_rls_initplan, 58 policies). Envolvendo em (SELECT ...) o Postgres calcula
-- uma vez e reaproveita — mesma regra, sem mudar quem vê o quê.
-- O lookbehind evita envolver de novo o que já está como "SELECT auth.uid()".
DO $$
DECLARE
  p        record;
  new_qual text;
  new_chk  text;
  pattern  text := '(?<!SELECT )\m(auth\.uid|auth\.role|auth\.jwt|is_global_admin|is_admin)\(\)';
  stmt     text;
  total    int := 0;
BEGIN
  FOR p IN SELECT tablename, policyname, qual, with_check FROM pg_policies WHERE schemaname = 'public' LOOP
    new_qual := regexp_replace(p.qual,       pattern, '(SELECT \1())', 'g');
    new_chk  := regexp_replace(p.with_check, pattern, '(SELECT \1())', 'g');
    IF new_qual IS DISTINCT FROM p.qual OR new_chk IS DISTINCT FROM p.with_check THEN
      stmt := format('ALTER POLICY %I ON public.%I', p.policyname, p.tablename);
      IF new_qual IS NOT NULL THEN stmt := stmt || ' USING (' || new_qual || ')'; END IF;
      IF new_chk  IS NOT NULL THEN stmt := stmt || ' WITH CHECK (' || new_chk || ')'; END IF;
      EXECUTE stmt;
      total := total + 1;
    END IF;
  END LOOP;
  RAISE NOTICE 'policies reescritas: %', total;
END $$;

-- ── 2. Histórico do pg_cron ──────────────────────────────────────────────────
-- cron.job_run_details nunca era limpo (≈168 mil linhas, 77 MB — 40% do banco) e
-- recebe 4 escritas por execução, a cada minuto. Mantém só 3 dias.
DELETE FROM cron.job_run_details WHERE start_time < now() - interval '3 days';

SELECT cron.schedule(
  'purge-cron-history',
  '30 6 * * *',
  $cmd$DELETE FROM cron.job_run_details WHERE start_time < now() - interval '3 days'$cmd$
);

-- ── 3. Busca de mensagens no funil ───────────────────────────────────────────
-- ilike '%texto%' em wa_messages.content percorria a tabela inteira (~1 s por busca).
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;
CREATE INDEX IF NOT EXISTS idx_wa_messages_content_trgm
  ON public.wa_messages USING gin (content extensions.gin_trgm_ops);

-- ── 4. Índice duplicado ──────────────────────────────────────────────────────
-- idx_quotes_token é idêntico a quotes_token_publico_key (que garante a unicidade).
DROP INDEX IF EXISTS public.idx_quotes_token;
