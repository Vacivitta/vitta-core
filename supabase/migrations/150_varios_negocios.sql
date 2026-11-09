-- 150_varios_negocios.sql
-- Contato separado do Negócio, etapa 5c2: um contato pode ter vários negócios (Fase 3·2,
-- entrega 5; ADR 0001).
--
-- Por quê: até aqui o telefone era único em leads, então o cliente que voltava
-- reabria o mesmo negócio e o histórico se misturava. Agora o telefone é único só no
-- contato (148), e cada oportunidade nova é um negócio novo ligado à mesma pessoa.
--
-- O que faz:
--   1. Sai o índice único uq_leads_unit_telefone_norm (122). Fica o índice comum
--      idx_leads_unit_telefone_norm (121) para as buscas. A unicidade fica em
--      uq_contatos_unit_telefone (148), só entre titulares.
--   2. fn_lead_contato (BEFORE INSERT em leads):
--      - sem contato_id, procura o contato titular da unidade com o mesmo telefone e
--        liga o negócio a ele; sem contato, cria um com o id do lead (como na 148);
--      - com contato (achado ou informado), preenche no contato só o que ele ainda
--        não tem e o negócio passa a ter a pessoa do contato. Contato de outra
--        unidade é recusado.
--   3. fn_lead_contato_espelho (149) passa a calcular cliente como "algum negócio
--      do contato é convertido" e recusa mudar a unidade de um negócio cujo contato
--      tem outros negócios (o contato é da unidade; levaria os outros junto).
--      fn_lead_contato_apaga recalcula cliente quando o contato fica.
--   4. auto_link_wa_conversation: entre os negócios do telefone, prefere o aberto.
--
-- Aplicar em produção é [H]: o Infra aplica, com aprovação e backup do dia, como
-- supabase_admin, com --single-transaction; depois registra a versão '150' e roda
-- notify pgrst, 'reload schema'. Sem BEGIN/COMMIT. Idempotente. Antes do deploy do
-- app (o webhook novo abre negócio novo para contato existente, o que o índice
-- único recusaria).
--
-- Reversão (só enquanto nenhum contato tiver dois negócios; senão a 122 recusa):
--   reaplicar 122 (recria o índice único), 145 (auto_link), 149 (espelho) e as
--   funções fn_lead_contato / fn_lead_contato_apaga da 148.

SET LOCAL lock_timeout = '5s';

DO $$
BEGIN
  IF current_setting('lock_timeout') <> '5s' THEN
    RAISE EXCEPTION '150: rode com --single-transaction (lock_timeout atual: %)', current_setting('lock_timeout');
  END IF;
  IF current_user <> 'supabase_admin' THEN
    RAISE EXCEPTION '150: rodar como supabase_admin (atual: %)', current_user;
  END IF;
END $$;

-- ── 1. Telefone único só no contato ──────────────────────────────────────────
DROP INDEX IF EXISTS public.uq_leads_unit_telefone_norm;
CREATE INDEX IF NOT EXISTS idx_leads_unit_telefone_norm ON public.leads (unit_id, telefone_norm);

-- ── 2. Negócio novo se liga ao contato do telefone ───────────────────────────
CREATE OR REPLACE FUNCTION public.fn_lead_contato()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_contato public.contatos%ROWTYPE;
BEGIN
  IF NEW.contato_id IS NULL AND public.normalizar_telefone(NEW.telefone) IS NOT NULL THEN
    SELECT c.id INTO NEW.contato_id
      FROM public.contatos c
     WHERE c.unit_id = NEW.unit_id
       AND c.responsavel_id IS NULL
       AND c.telefone_norm = public.normalizar_telefone(NEW.telefone);
  END IF;

  IF NEW.contato_id IS NULL THEN
    INSERT INTO public.contatos (id, unit_id, nome, sobrenome, telefone, email, cpf, data_nascimento, profissao,
                                 cidade, estado, pais, instagram, site, observacoes, cliente, wa_optin_at, wa_optout_at)
    VALUES (NEW.id, NEW.unit_id, NEW.nome, NEW.sobrenome, NEW.telefone, NEW.email, NEW.cpf, NEW.data_nascimento,
            NEW.profissao, NEW.cidade, NEW.estado, NEW.pais, NEW.instagram, NEW.site, NEW.observacoes_cli,
            coalesce(NEW.is_converted, false), NEW.wa_optin_at, NEW.wa_optout_at);
    NEW.contato_id := NEW.id;
    RETURN NEW;
  END IF;

  SELECT * INTO v_contato FROM public.contatos WHERE id = NEW.contato_id;
  IF NOT FOUND OR v_contato.unit_id IS DISTINCT FROM NEW.unit_id OR v_contato.responsavel_id IS NOT NULL THEN
    RAISE EXCEPTION 'contato % não é um titular da unidade do negócio', NEW.contato_id USING ERRCODE = '23514';
  END IF;

  -- O contato ganha o que ainda não tem; o negócio fica com a pessoa do contato
  UPDATE public.contatos c
     SET sobrenome = coalesce(c.sobrenome, NEW.sobrenome), email = coalesce(c.email, NEW.email),
         cpf = coalesce(c.cpf, NEW.cpf), data_nascimento = coalesce(c.data_nascimento, NEW.data_nascimento),
         profissao = coalesce(c.profissao, NEW.profissao), cidade = coalesce(c.cidade, NEW.cidade),
         estado = coalesce(c.estado, NEW.estado), pais = coalesce(c.pais, NEW.pais),
         instagram = coalesce(c.instagram, NEW.instagram), site = coalesce(c.site, NEW.site),
         observacoes = coalesce(c.observacoes, NEW.observacoes_cli),
         wa_optin_at = coalesce(c.wa_optin_at, NEW.wa_optin_at), wa_optout_at = coalesce(c.wa_optout_at, NEW.wa_optout_at),
         cliente = c.cliente OR coalesce(NEW.is_converted, false)
   WHERE c.id = NEW.contato_id
  RETURNING * INTO v_contato;

  NEW.nome := v_contato.nome; NEW.sobrenome := v_contato.sobrenome; NEW.telefone := v_contato.telefone;
  NEW.email := v_contato.email; NEW.cpf := v_contato.cpf; NEW.data_nascimento := v_contato.data_nascimento;
  NEW.profissao := v_contato.profissao; NEW.cidade := v_contato.cidade; NEW.estado := v_contato.estado;
  NEW.pais := v_contato.pais; NEW.instagram := v_contato.instagram; NEW.site := v_contato.site;
  NEW.observacoes_cli := v_contato.observacoes;
  NEW.wa_optin_at := v_contato.wa_optin_at; NEW.wa_optout_at := v_contato.wa_optout_at;
  RETURN NEW;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.fn_lead_contato() FROM PUBLIC, anon, authenticated;

-- ── 3. Cliente = algum negócio convertido; unidade só com um negócio ─────────
CREATE OR REPLACE FUNCTION public.fn_lead_contato_espelho()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_cliente boolean;
BEGIN
  IF NEW.unit_id IS DISTINCT FROM OLD.unit_id
     AND EXISTS (SELECT 1 FROM public.leads l WHERE l.contato_id = NEW.contato_id AND l.id <> NEW.id) THEN
    RAISE EXCEPTION 'o contato deste negócio tem outros negócios nesta unidade; transferir levaria todos'
      USING ERRCODE = '23514';
  END IF;
  v_cliente := EXISTS (SELECT 1 FROM public.leads l WHERE l.contato_id = NEW.contato_id AND l.is_converted);
  UPDATE public.contatos c
     SET unit_id = NEW.unit_id, nome = NEW.nome, sobrenome = NEW.sobrenome, telefone = NEW.telefone,
         email = NEW.email, cpf = NEW.cpf, data_nascimento = NEW.data_nascimento, profissao = NEW.profissao,
         cidade = NEW.cidade, estado = NEW.estado, pais = NEW.pais, instagram = NEW.instagram, site = NEW.site,
         observacoes = NEW.observacoes_cli, cliente = v_cliente,
         wa_optin_at = NEW.wa_optin_at, wa_optout_at = NEW.wa_optout_at, atualizado_em = now()
   WHERE c.id = NEW.contato_id
     AND (c.unit_id, c.nome, c.sobrenome, c.telefone, c.email, c.cpf, c.data_nascimento, c.profissao, c.cidade,
          c.estado, c.pais, c.instagram, c.site, c.observacoes, c.cliente, c.wa_optin_at, c.wa_optout_at)
         IS DISTINCT FROM
         (NEW.unit_id, NEW.nome, NEW.sobrenome, NEW.telefone, NEW.email, NEW.cpf, NEW.data_nascimento,
          NEW.profissao, NEW.cidade, NEW.estado, NEW.pais, NEW.instagram, NEW.site, NEW.observacoes_cli,
          v_cliente, NEW.wa_optin_at, NEW.wa_optout_at);
  IF NEW.unit_id IS DISTINCT FROM OLD.unit_id THEN
    UPDATE public.contatos SET unit_id = NEW.unit_id, atualizado_em = now() WHERE responsavel_id = NEW.contato_id;
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.fn_lead_contato_espelho() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.fn_lead_contato_apaga()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.leads l WHERE l.contato_id = OLD.contato_id) THEN
    DELETE FROM public.contatos WHERE id = OLD.contato_id;
  ELSE
    UPDATE public.contatos c
       SET cliente = EXISTS (SELECT 1 FROM public.leads l WHERE l.contato_id = c.id AND l.is_converted)
     WHERE c.id = OLD.contato_id;
  END IF;
  RETURN OLD;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.fn_lead_contato_apaga() FROM PUBLIC, anon, authenticated;

-- ── 4. Conversa nova liga ao negócio aberto do telefone ──────────────────────
CREATE OR REPLACE FUNCTION public.auto_link_wa_conversation()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE
  v_lead_id uuid;
BEGIN
  IF NEW.lead_id IS NOT NULL OR NEW.tipo = 'grupo' THEN
    RETURN NEW;
  END IF;

  SELECT id INTO v_lead_id
    FROM public.leads
   WHERE unit_id = NEW.unit_id
     AND NOT arquivado
     AND telefone_norm = public.normalizar_telefone('+' || NEW.wa_phone)
   ORDER BY (status = 'aberto') DESC, created_at DESC
   LIMIT 1;

  IF v_lead_id IS NOT NULL THEN
    NEW.lead_id := v_lead_id;
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.auto_link_wa_conversation() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.auto_link_wa_conversation() TO service_role;

-- ── Conferência ──────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'uq_leads_unit_telefone_norm') THEN
    RAISE EXCEPTION '150: o índice único de telefone em leads continua';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'uq_contatos_unit_telefone') THEN
    RAISE EXCEPTION '150: falta o índice único de telefone em contatos (148)';
  END IF;
END $$;
