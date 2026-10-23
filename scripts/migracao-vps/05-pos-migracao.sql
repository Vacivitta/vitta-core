-- Etapa 4 — ajustes no destino depois de restaurar dados e copiar arquivos.
-- Rodar no banco da VPS (psql) informando os quatro valores abaixo:
--   :origem_storage  URL base da origem, ex.: https://kewupumnkvglodidwuqz.supabase.co
--   :destino_storage URL base pública do Supabase da VPS, ex.: https://api-vittadesk.app.vacivitta.com.br
--   :app_url         URL do app que o pg_cron deve chamar, ex.: https://vittadesk.com.br
--   :cron_secret     valor de CRON_SECRET configurado no app
--
-- Ex.: docker exec -i <db> psql -U supabase_admin -d postgres \
--        -v origem_storage=... -v destino_storage=... -v app_url=... -v cron_secret=... \
--        < 05-pos-migracao.sql

\set ON_ERROR_STOP on

-- ── 1. Links de arquivos: troca o host da origem pelo da VPS ─────────────────
-- Varre todas as colunas de texto do schema public que contenham a URL antiga
-- (media_url, header_image_url, avatares, imagens dos templates de orçamento...).
SELECT set_config('mig.de',   :'origem_storage'  || '/storage/v1/', false);
SELECT set_config('mig.para', :'destino_storage' || '/storage/v1/', false);

DO $$
DECLARE c record; n bigint; total bigint := 0;
  de text := current_setting('mig.de'); para text := current_setting('mig.para');
BEGIN
  FOR c IN
    SELECT table_name, column_name FROM information_schema.columns
    WHERE table_schema = 'public' AND data_type IN ('text', 'character varying')
      AND table_name IN (SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE')
  LOOP
    EXECUTE format('UPDATE public.%I SET %I = replace(%I, $1, $2) WHERE %I LIKE $3',
                   c.table_name, c.column_name, c.column_name, c.column_name)
      USING de, para, '%' || de || '%';
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n > 0 THEN RAISE NOTICE '%.%: % linhas', c.table_name, c.column_name, n; total := total + n; END IF;
  END LOOP;
  RAISE NOTICE 'links atualizados: %', total;
END $$;

-- ── 2. Jobs do pg_cron (não vêm no dump) ─────────────────────────────────────
SELECT set_config('mig.app', :'app_url', false);
SELECT set_config('mig.secret', :'cron_secret', false);

DO $$
DECLARE app text := current_setting('mig.app'); secret text := current_setting('mig.secret');
  cmd text := $f$SELECT net.http_post(url := %L, headers := jsonb_build_object('Authorization', %L, 'Content-Type', 'application/json'), body := '{}'::jsonb)$f$;
BEGIN
  PERFORM cron.schedule('process-wa-scheduled-messages', '* * * * *',
    format(cmd, app || '/api/whatsapp/process-scheduled', 'Bearer ' || secret));
  PERFORM cron.schedule('process-timed-automations', '0 * * * *',
    format(cmd, app || '/api/whatsapp/process-timed-automations', 'Bearer ' || secret));
  PERFORM cron.schedule('check-expiring-quotes', '0 11 * * *',
    format(cmd, app || '/api/orcamento/check-expiring', 'Bearer ' || secret));
  PERFORM cron.schedule('purge-cron-history', '30 6 * * *',
    $c$DELETE FROM cron.job_run_details WHERE start_time < now() - interval '3 days'$c$);
END $$;

-- ── 3. Conferência ───────────────────────────────────────────────────────────
SELECT 'leads' AS tabela, count(*) FROM public.leads
UNION ALL SELECT 'wa_messages', count(*) FROM public.wa_messages
UNION ALL SELECT 'wa_conversations', count(*) FROM public.wa_conversations
UNION ALL SELECT 'quotes', count(*) FROM public.quotes
UNION ALL SELECT 'auth.users', count(*) FROM auth.users
UNION ALL SELECT 'storage.objects', count(*) FROM storage.objects
UNION ALL SELECT 'cron jobs', count(*) FROM cron.job;
