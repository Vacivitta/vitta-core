-- 120_automation_runs.sql
-- Tabela automation_runs: rastro de cada execução de automação (evento e tempo).
--
-- Por quê: as automações por evento (wa_automations) não deixavam log nenhum, e
-- as por tempo (wa_timed_automations) só gravavam o sucesso em
-- wa_timed_automation_log. Falhas (Meta recusando o modelo, erro de banco) sumiam
-- e se repetiam a cada hora. Cadência e IA dependem desse histórico.
--
-- O que faz:
--   1. Cria public.automation_runs. automation_id não tem FK porque aponta para
--      duas tabelas (wa_automations ou wa_timed_automations, conforme origem).
--      Sem dados pessoais: motivo e detalhe guardam só códigos, ids e o resumo
--      do erro (src/lib/log-seguro.ts).
--   2. RLS: SELECT para admin global ou gestor (is_gestor(), da 113) vinculado à
--      unidade em user_units. Ninguém do navegador grava: só o service_role
--      (rotas do servidor), que ignora RLS.
--   3. Retenção: job pg_cron purge-automation-runs apaga linhas com mais de 90
--      dias, todo dia às 06:45 UTC.
--   wa_timed_automation_log continua sendo a trava de "dispara uma vez".
--
-- Depende da 113 (is_gestor). Aplicar em produção é [H]: o Infra aplica, com
-- aprovação e backup do dia, como supabase_admin, com --single-transaction;
-- depois registra a versão '120' e roda notify pgrst, 'reload schema'.
-- Sem BEGIN/COMMIT. Idempotente. Reversão no fim do arquivo (comentada).

SET LOCAL lock_timeout = '5s';

DO $$
BEGIN
  IF current_setting('lock_timeout') <> '5s' THEN
    RAISE EXCEPTION '120: rode com --single-transaction (lock_timeout atual: %)', current_setting('lock_timeout');
  END IF;
  IF current_user <> 'supabase_admin' THEN
    RAISE EXCEPTION '120: rodar como supabase_admin (atual: %)', current_user;
  END IF;
  IF to_regprocedure('public.is_gestor()') IS NULL THEN
    RAISE EXCEPTION '120: depende da 113 (função is_gestor() não existe)';
  END IF;
  IF to_regnamespace('cron') IS NULL THEN
    RAISE EXCEPTION '120: pg_cron não instalado (schema cron não existe)';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.automation_runs (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id         uuid        NOT NULL REFERENCES public.units (id) ON DELETE CASCADE,
  origem          text        NOT NULL CHECK (origem IN ('evento', 'tempo')),
  automation_id   uuid        NOT NULL,
  gatilho         text        NOT NULL,
  acao            text        NOT NULL,
  lead_id         uuid        REFERENCES public.leads (id) ON DELETE SET NULL,
  conversation_id uuid        REFERENCES public.wa_conversations (id) ON DELETE SET NULL,
  resultado       text        NOT NULL CHECK (resultado IN ('etapa_movida', 'modelo_enviado', 'pulado', 'falhou')),
  motivo          text,
  detalhe         jsonb,
  criado_em       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_automation_runs_unit_criado
  ON public.automation_runs (unit_id, criado_em DESC);
CREATE INDEX IF NOT EXISTS idx_automation_runs_automation_criado
  ON public.automation_runs (automation_id, criado_em DESC);

ALTER TABLE public.automation_runs ENABLE ROW LEVEL SECURITY;

-- Os privilégios padrão do Supabase dão ALL a anon e authenticated em tabela nova
REVOKE ALL ON public.automation_runs FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.automation_runs TO authenticated;
GRANT ALL    ON public.automation_runs TO service_role;

DROP POLICY IF EXISTS "gestores_automation_runs_select" ON public.automation_runs;
CREATE POLICY "gestores_automation_runs_select" ON public.automation_runs AS PERMISSIVE FOR SELECT TO authenticated
  USING (
    (SELECT is_global_admin())
    OR ((SELECT is_gestor())
        AND unit_id IN (SELECT unit_id FROM user_units WHERE user_id = (SELECT auth.uid())))
  );

SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'purge-automation-runs';
SELECT cron.schedule(
  'purge-automation-runs',
  '45 6 * * *',
  $cmd$DELETE FROM public.automation_runs WHERE criado_em < now() - interval '90 days'$cmd$
);

DO $$
DECLARE outras text;
BEGIN
  SELECT string_agg(policyname, ', ') INTO outras
    FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'automation_runs'
     AND policyname <> 'gestores_automation_runs_select';
  IF outras IS NOT NULL THEN
    RAISE EXCEPTION '120: policies inesperadas em automation_runs: %', outras;
  END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.automation_runs'::regclass) THEN
    RAISE EXCEPTION '120: RLS desligado em automation_runs';
  END IF;
  IF has_table_privilege('anon', 'public.automation_runs', 'SELECT')
     OR has_table_privilege('authenticated', 'public.automation_runs', 'INSERT,UPDATE,DELETE,TRUNCATE') THEN
    RAISE EXCEPTION '120: privilégios inesperados em automation_runs para anon/authenticated';
  END IF;
  IF (SELECT count(*) FROM cron.job WHERE jobname = 'purge-automation-runs') <> 1 THEN
    RAISE EXCEPTION '120: job purge-automation-runs deveria existir uma vez';
  END IF;
END $$;

-- ── Reversão (só com aprovação; como supabase_admin, --single-transaction) ────
-- Apaga o histórico de execuções:
-- SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'purge-automation-runs';
-- DROP TABLE IF EXISTS public.automation_runs;
