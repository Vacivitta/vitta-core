-- 138_orcamento_expirado_automacao.sql
-- Orçamento que expira dispara a automação de orçamento e registra a execução.
--
-- Por quê: a tela de Automações deixa configurar "orçamento expirado → mover
-- para etapa / perder o lead" (quote_automations, 019), mas só a rota pública
-- /api/orcamento/respond chama execute_quote_automation, e ela trata aceito,
-- recusado e visualizado. Quem expira orçamento é o cron check-expiring
-- (route.ts:86) e a página /orcamento (page.tsx:38), e nenhum dos dois chama:
-- a regra de expirado nunca rodou. Em 05/11/2026 havia 214 orçamentos expirados
-- em produção.
--
-- O que faz:
--   1. Trigger trg_quote_expirado_automacao (AFTER UPDATE OF status em quotes):
--      na passagem para 'expirado' de um orçamento com lead, se a unidade tem
--      regra ativa de expirado, chama execute_quote_automation e grava a
--      execução em automation_runs (origem 'evento', gatilho 'quote_expirado',
--      automation_id = id da regra em quote_automations). Vale para o cron, a
--      página e qualquer outro caminho que expire o orçamento.
--      Resultado: etapa_movida (detalhe de/para), lead_perdido (detalhe de/para),
--      pulado (ja_na_etapa, ja_perdido, mal_configurada) ou falhou (motivo = SQLSTATE,
--      ex.: VC001). Uma falha da automação (ex.: etapa com campo obrigatório
--      que o lead não tem, 130) é registrada e não desfaz a expiração.
--      Regra desligada ou 'none' não grava nada, como os pulos de rotina das
--      automações por evento.
--   2. automation_runs.resultado aceita 'lead_perdido'.
--   3. fn_quote_expirado_automacao é SECURITY DEFINER (quem expira pela página é
--      o usuário logado, e execute_quote_automation só o service_role executa),
--      search_path fixo, sem EXECUTE para PUBLIC, anon e authenticated.
--
-- Os orçamentos que já estão expirados não disparam (decisão de 05/11/2026).
--
-- Aplicar em produção é [H]: o Infra aplica, com aprovação e backup do dia, como
-- supabase_admin, com --single-transaction; depois registra a versão '138' e roda
-- notify pgrst, 'reload schema'. Sem BEGIN/COMMIT. Idempotente. Não depende de
-- deploy. Depois de um restore, reaplicar antes da 118 (ordem pós-restore).
--
-- Reversão:
--   DROP TRIGGER IF EXISTS trg_quote_expirado_automacao ON public.quotes;
--   DROP FUNCTION IF EXISTS public.fn_quote_expirado_automacao();
--   (lead_perdido pode ficar no CHECK; para tirar, apagar antes as linhas com ele)

SET LOCAL lock_timeout = '5s';

DO $$
BEGIN
  IF current_setting('lock_timeout') <> '5s' THEN
    RAISE EXCEPTION '138: rode com --single-transaction (lock_timeout atual: %)', current_setting('lock_timeout');
  END IF;
  IF current_user <> 'supabase_admin' THEN
    RAISE EXCEPTION '138: rodar como supabase_admin (atual: %)', current_user;
  END IF;
  IF to_regclass('public.automation_runs') IS NULL THEN
    RAISE EXCEPTION '138: depende da 120 (automation_runs)';
  END IF;
END $$;

ALTER TABLE public.automation_runs DROP CONSTRAINT IF EXISTS automation_runs_resultado_check;
ALTER TABLE public.automation_runs ADD CONSTRAINT automation_runs_resultado_check
  CHECK (resultado IN ('etapa_movida', 'modelo_enviado', 'lead_perdido', 'pulado', 'falhou'));

CREATE OR REPLACE FUNCTION public.fn_quote_expirado_automacao()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  regra      record;
  antes      record;
  depois     record;
  v_resultado text;
  v_motivo    text;
  v_detalhe   jsonb;
BEGIN
  IF NEW.status IS DISTINCT FROM 'expirado' OR OLD.status IS NOT DISTINCT FROM 'expirado' OR NEW.lead_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT q.id, q.action, q.stage_id INTO regra
    FROM public.quote_automations q
   WHERE q.unit_id = NEW.unit_id AND q.quote_status = 'expirado' AND q.ativo
   LIMIT 1;
  IF NOT FOUND OR regra.action = 'none' THEN
    RETURN NULL;
  END IF;

  SELECT l.stage_id, l.status INTO antes FROM public.leads l WHERE l.id = NEW.lead_id;

  IF regra.action = 'move_stage' AND regra.stage_id IS NULL THEN
    v_resultado := 'pulado'; v_motivo := 'mal_configurada';
  ELSIF regra.action = 'move_stage' AND antes.stage_id IS NOT DISTINCT FROM regra.stage_id THEN
    v_resultado := 'pulado'; v_motivo := 'ja_na_etapa';
  ELSIF regra.action = 'archive' AND antes.status = 'perdido' THEN
    v_resultado := 'pulado'; v_motivo := 'ja_perdido';
  ELSE
    BEGIN
      PERFORM public.execute_quote_automation(NEW.unit_id, NEW.lead_id, 'expirado', NULL);
      SELECT l.stage_id, l.status INTO depois FROM public.leads l WHERE l.id = NEW.lead_id;
      v_resultado := CASE regra.action WHEN 'archive' THEN 'lead_perdido' ELSE 'etapa_movida' END;
      v_detalhe := jsonb_build_object('de', antes.stage_id, 'para', depois.stage_id);
    EXCEPTION WHEN OTHERS THEN
      v_resultado := 'falhou'; v_motivo := SQLSTATE;
      v_detalhe := jsonb_build_object('etapa', 'banco');
    END;
  END IF;

  INSERT INTO public.automation_runs (unit_id, origem, automation_id, gatilho, acao, lead_id, resultado, motivo, detalhe)
  VALUES (NEW.unit_id, 'evento', regra.id, 'quote_expirado', regra.action, NEW.lead_id, v_resultado, v_motivo, v_detalhe);

  RETURN NULL;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.fn_quote_expirado_automacao() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_quote_expirado_automacao ON public.quotes;
CREATE TRIGGER trg_quote_expirado_automacao
  AFTER UPDATE OF status ON public.quotes
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_quote_expirado_automacao();
