-- 124_app_errors.sql
-- Erros do servidor guardados no próprio banco, para o admin ver numa tela.
--
-- Por quê: hoje os erros do servidor só vão para o console (console.error com
-- resumoErro) e ninguém os vê. O Pedro decidiu não usar serviço externo: por LGPD,
-- nenhum dado sai da VPS. O app (src/lib/erros/registrar.ts, chamado pelo
-- onRequestError de src/instrumentation.ts) grava aqui pelo client service-role.
--
-- Como funciona:
--   app_errors          uma linha por erro distinto (assinatura = hash de origem,
--                       rota, tipo e mensagem sem números); repetições só
--                       incrementam ocorrencias e ultimo_em.
--   registrar_erro_app  upsert por assinatura; reabre (resolvido_em = null) se o
--                       erro voltar. Só service_role executa.
--   RLS                 admin global (is_global_admin) lê e marca como resolvido;
--                       os demais não veem nada. authenticated só pode atualizar
--                       resolvido_em/resolvido_por (grant por coluna).
--   purge-app-errors    job diário do pg_cron: apaga resolvidos há mais de 30 dias
--                       e os não vistos há mais de 90.
--
-- Aplicar em produção é [H]: o Infra aplica, com aprovação, como supabase_admin
-- (dono das funções SECURITY DEFINER), com --single-transaction; depois registra a
-- versão 124 e roda notify pgrst, 'reload schema'. Sem BEGIN/COMMIT. Idempotente.
-- Conferir depois: has_function_privilege('authenticated',
-- 'public.registrar_erro_app(text,text,text,text,text,text,text,text,integer)',
-- 'EXECUTE') = false. Reaplicar a 118 depois desta continua passando.
-- Reversão: DROP TABLE public.app_errors; DROP FUNCTION public.registrar_erro_app;
-- SELECT cron.unschedule('purge-app-errors').

SET LOCAL lock_timeout = '5s';

DO $$
BEGIN
  IF current_setting('lock_timeout') <> '5s' THEN
    RAISE EXCEPTION '124: rode com --single-transaction (lock_timeout atual: %)', current_setting('lock_timeout');
  END IF;
  IF current_user <> 'supabase_admin' THEN
    RAISE EXCEPTION '124: rodar como supabase_admin (atual: %)', current_user;
  END IF;
  IF to_regprocedure('public.is_global_admin()') IS NULL THEN
    RAISE EXCEPTION '124: depende da 067 (is_global_admin)';
  END IF;
  IF to_regnamespace('cron') IS NULL THEN
    RAISE EXCEPTION '124: depende do pg_cron (schema cron ausente)';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.app_errors (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  assinatura    text        NOT NULL UNIQUE,
  origem        text        NOT NULL CHECK (origem IN ('rota', 'renderizacao', 'acao', 'cron', 'webhook', 'outro')),
  rota          text,
  metodo        text,
  tipo          text        NOT NULL,
  mensagem      text        NOT NULL,
  stack         text,
  digest        text,
  ocorrencias   integer     NOT NULL DEFAULT 1 CHECK (ocorrencias > 0),
  primeiro_em   timestamptz NOT NULL DEFAULT now(),
  ultimo_em     timestamptz NOT NULL DEFAULT now(),
  resolvido_em  timestamptz,
  resolvido_por uuid        REFERENCES auth.users (id) ON DELETE SET NULL
);

ALTER TABLE public.app_errors OWNER TO postgres;

CREATE INDEX IF NOT EXISTS idx_app_errors_ultimo_em ON public.app_errors (ultimo_em DESC);

ALTER TABLE public.app_errors ENABLE ROW LEVEL SECURITY;

-- Os privilégios padrão do public dão ALL (inclusive TRUNCATE, que ignora RLS) a
-- anon e authenticated; aqui só leitura e a marcação de resolvido.
REVOKE ALL ON public.app_errors FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.app_errors TO authenticated;
GRANT UPDATE (resolvido_em, resolvido_por) ON public.app_errors TO authenticated;
GRANT ALL ON public.app_errors TO service_role;

DROP POLICY IF EXISTS app_errors_select_admin ON public.app_errors;
CREATE POLICY app_errors_select_admin ON public.app_errors
  FOR SELECT TO authenticated
  USING (public.is_global_admin());

DROP POLICY IF EXISTS app_errors_update_admin ON public.app_errors;
CREATE POLICY app_errors_update_admin ON public.app_errors
  FOR UPDATE TO authenticated
  USING (public.is_global_admin())
  WITH CHECK (public.is_global_admin() AND (resolvido_por IS NULL OR resolvido_por = auth.uid()));

CREATE OR REPLACE FUNCTION public.registrar_erro_app(
  p_assinatura text,
  p_origem     text,
  p_rota       text,
  p_metodo     text,
  p_tipo       text,
  p_mensagem   text,
  p_stack      text,
  p_digest     text,
  p_quantidade integer DEFAULT 1
) RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  INSERT INTO public.app_errors AS e
    (assinatura, origem, rota, metodo, tipo, mensagem, stack, digest, ocorrencias)
  VALUES
    (left(p_assinatura, 128), p_origem, left(p_rota, 300), left(p_metodo, 16), left(p_tipo, 200),
     left(p_mensagem, 1000), left(p_stack, 4096), left(p_digest, 100), greatest(coalesce(p_quantidade, 1), 1))
  ON CONFLICT (assinatura) DO UPDATE SET
    ocorrencias   = e.ocorrencias + EXCLUDED.ocorrencias,
    ultimo_em     = now(),
    mensagem      = EXCLUDED.mensagem,
    metodo        = coalesce(EXCLUDED.metodo, e.metodo),
    stack         = coalesce(EXCLUDED.stack, e.stack),
    digest        = coalesce(EXCLUDED.digest, e.digest),
    resolvido_em  = NULL,
    resolvido_por = NULL;
$$;

REVOKE EXECUTE ON FUNCTION public.registrar_erro_app(text,text,text,text,text,text,text,text,integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.registrar_erro_app(text,text,text,text,text,text,text,text,integer)
  TO service_role;

DO $$
BEGIN
  PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'purge-app-errors';
  PERFORM cron.schedule(
    'purge-app-errors',
    '45 6 * * *',
    $cmd$DELETE FROM public.app_errors
          WHERE resolvido_em < now() - interval '30 days'
             OR ultimo_em    < now() - interval '90 days'$cmd$
  );
END $$;

DO $$
DECLARE
  f constant text := 'public.registrar_erro_app(text,text,text,text,text,text,text,text,integer)';
BEGIN
  IF has_function_privilege('anon', f, 'EXECUTE') OR has_function_privilege('authenticated', f, 'EXECUTE')
     OR NOT has_function_privilege('service_role', f, 'EXECUTE') THEN
    RAISE EXCEPTION '124: registrar_erro_app deveria ser executável só por service_role';
  END IF;
  IF has_table_privilege('anon', 'public.app_errors', 'SELECT')
     OR has_table_privilege('authenticated', 'public.app_errors', 'INSERT,DELETE,TRUNCATE') THEN
    RAISE EXCEPTION '124: app_errors com privilégios além de SELECT/UPDATE parcial para authenticated';
  END IF;
END $$;
