-- 152_correcoes_contato.sql
-- Correções achadas na conferência (blast radius) de 148–151 em produção.
--
-- O que faz:
--   1. Segurança: trocar leads.contato_id (UPDATE) só para um contato titular da
--      mesma unidade do negócio. Sem isso, quem grava leads (authenticated) podia
--      apontar o próprio negócio para o contato de outra unidade e, pelo espelho
--      SECURITY DEFINER, sobrescrever a pessoa dela e dos negócios dela. O INSERT
--      já tinha essa checagem (150).
--   2. contatos.cliente acompanha o ganho: o espelho lead → contato passa a
--      disparar também por status e stage_id. Ganhar grava só status/stage_id e
--      fn_lead_status (126) liga is_converted no BEFORE; trigger com lista de
--      colunas só olha o SET do comando, então o contato nunca ficava cliente.
--      Backfill do cliente de todos os titulares.
--   3. Apagar um negócio não leva os dependentes da pessoa: se o contato tem outro
--      negócio, os lead_contacts do apagado passam para o mais recente dos outros
--      (antes do CASCADE de lead_contacts.lead_id).
--   4. abrir_negocio_da_mensagem: o webhook abre o negócio novo com trava por
--      contato (pg_advisory_xact_lock) e confere de novo se já há negócio aberto,
--      para duas mensagens seguidas não abrirem dois negócios. Só service_role.
--
-- Aplicar em produção é [H]: o Infra aplica, com aprovação e backup do dia, como
-- supabase_admin, com --single-transaction; depois registra a versão '152' e roda
-- notify pgrst, 'reload schema'. Sem BEGIN/COMMIT. Idempotente. Antes do deploy do
-- app (o webhook novo chama abrir_negocio_da_mensagem). Depois de um restore:
-- reaplicar depois da 150 (ordem pós-restore).
--
-- Reversão:
--   DROP TRIGGER IF EXISTS trg_lead_contato_troca ON public.leads;
--   DROP TRIGGER IF EXISTS trg_lead_dependentes_ficam ON public.leads;
--   DROP FUNCTION IF EXISTS public.fn_lead_contato_troca(), public.fn_lead_dependentes_ficam(),
--     public.abrir_negocio_da_mensagem(uuid, uuid, text);
--   e recriar trg_lead_contato_espelho com a lista da 148.

SET LOCAL lock_timeout = '5s';

DO $$
BEGIN
  IF current_setting('lock_timeout') <> '5s' THEN
    RAISE EXCEPTION '152: rode com --single-transaction (lock_timeout atual: %)', current_setting('lock_timeout');
  END IF;
  IF current_user <> 'supabase_admin' THEN
    RAISE EXCEPTION '152: rodar como supabase_admin (atual: %)', current_user;
  END IF;
  IF to_regclass('public.uq_leads_unit_telefone_norm') IS NOT NULL THEN
    RAISE EXCEPTION '152: depende da 150 (vários negócios por contato)';
  END IF;
END $$;

-- ── 1. contato_id só troca para um titular da mesma unidade ──────────────────
CREATE OR REPLACE FUNCTION public.fn_lead_contato_troca()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  IF NEW.contato_id IS DISTINCT FROM OLD.contato_id THEN
    IF NEW.contato_id IS NULL OR NOT EXISTS (
         SELECT 1 FROM public.contatos c
          WHERE c.id = NEW.contato_id AND c.unit_id = NEW.unit_id AND c.responsavel_id IS NULL) THEN
      RAISE EXCEPTION 'contato % não é um titular da unidade do negócio', NEW.contato_id USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.fn_lead_contato_troca() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_lead_contato_troca ON public.leads;
CREATE TRIGGER trg_lead_contato_troca BEFORE UPDATE OF contato_id ON public.leads
  FOR EACH ROW EXECUTE FUNCTION public.fn_lead_contato_troca();

-- ── 2. Cliente acompanha o ganho ─────────────────────────────────────────────
DROP TRIGGER IF EXISTS trg_lead_contato_espelho ON public.leads;
CREATE TRIGGER trg_lead_contato_espelho AFTER UPDATE OF unit_id, nome, sobrenome, telefone, email, cpf, data_nascimento,
  profissao, cidade, estado, pais, instagram, site, observacoes_cli, is_converted, status, stage_id,
  wa_optin_at, wa_optout_at
  ON public.leads FOR EACH ROW EXECUTE FUNCTION public.fn_lead_contato_espelho();

UPDATE public.contatos c
   SET cliente = EXISTS (SELECT 1 FROM public.leads l WHERE l.contato_id = c.id AND l.is_converted)
 WHERE c.responsavel_id IS NULL
   AND c.cliente IS DISTINCT FROM EXISTS (SELECT 1 FROM public.leads l WHERE l.contato_id = c.id AND l.is_converted);

-- ── 3. Dependentes ficam com a pessoa ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_lead_dependentes_ficam()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_outro uuid;
BEGIN
  SELECT l.id INTO v_outro FROM public.leads l
   WHERE l.contato_id = OLD.contato_id AND l.id <> OLD.id
   ORDER BY l.created_at DESC LIMIT 1;
  IF v_outro IS NOT NULL THEN
    UPDATE public.lead_contacts SET lead_id = v_outro WHERE lead_id = OLD.id;
  END IF;
  RETURN OLD;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.fn_lead_dependentes_ficam() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_lead_dependentes_ficam ON public.leads;
CREATE TRIGGER trg_lead_dependentes_ficam BEFORE DELETE ON public.leads
  FOR EACH ROW EXECUTE FUNCTION public.fn_lead_dependentes_ficam();

-- ── 4. Negócio novo pela mensagem, sem duplicar ──────────────────────────────
CREATE OR REPLACE FUNCTION public.abrir_negocio_da_mensagem(p_contato uuid, p_stage uuid, p_origem text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_contato public.contatos%ROWTYPE;
  v_lead uuid;
BEGIN
  -- Duas mensagens seguidas do mesmo contato esperam aqui uma pela outra
  PERFORM pg_advisory_xact_lock(hashtextextended('abrir_negocio:' || p_contato::text, 0));

  SELECT l.id INTO v_lead FROM public.leads l
   WHERE l.contato_id = p_contato AND l.status = 'aberto' AND NOT l.arquivado
   ORDER BY l.created_at DESC LIMIT 1;
  IF v_lead IS NOT NULL THEN
    RETURN v_lead;
  END IF;

  SELECT * INTO v_contato FROM public.contatos WHERE id = p_contato AND responsavel_id IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'contato % não existe ou não é titular', p_contato USING ERRCODE = '23514';
  END IF;

  INSERT INTO public.leads (unit_id, contato_id, nome, origem, funnel_id, stage_id)
  SELECT v_contato.unit_id, v_contato.id, v_contato.nome, p_origem, fs.funnel_id, fs.id
    FROM public.funnel_stages fs
    JOIN public.funnels f ON f.id = fs.funnel_id
   WHERE fs.id = p_stage AND f.unit_id = v_contato.unit_id AND f.objeto = 'negocio'
  RETURNING id INTO v_lead;
  IF v_lead IS NULL THEN
    RAISE EXCEPTION 'etapa % não é de um funil de negócio da unidade do contato', p_stage USING ERRCODE = '23514';
  END IF;
  RETURN v_lead;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.abrir_negocio_da_mensagem(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.abrir_negocio_da_mensagem(uuid, uuid, text) TO service_role;

-- ── Conferência ──────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.contatos c WHERE c.responsavel_id IS NULL
               AND c.cliente IS DISTINCT FROM EXISTS (SELECT 1 FROM public.leads l WHERE l.contato_id = c.id AND l.is_converted)) THEN
    RAISE EXCEPTION '152: contatos.cliente continua divergente';
  END IF;
  IF has_function_privilege('authenticated', 'public.abrir_negocio_da_mensagem(uuid, uuid, text)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.abrir_negocio_da_mensagem(uuid, uuid, text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.fn_lead_contato_troca()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.fn_lead_dependentes_ficam()', 'EXECUTE') THEN
    RAISE EXCEPTION '152: funções executáveis por anon/authenticated';
  END IF;
END $$;
