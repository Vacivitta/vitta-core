-- 148_contatos.sql
-- Contato separado do Negócio, etapa 5a: os dados (Fase 3·2, entrega 5; ADR 0001).
--
-- Por quê: o lead é hoje a pessoa e a oportunidade ao mesmo tempo; um cliente que
-- volta reabre o mesmo negócio e o histórico se mistura. O Contato (a pessoa,
-- cliente para sempre, da unidade: ADR 0005) passa a existir ao lado do lead, que
-- vira o Negócio e mantém o id. Esta etapa só cria e mantém os dados: o app ainda
-- lê e grava a pessoa no lead (5b passa a ler do contato; 5c, a gravar).
--
-- O que faz:
--   1. contatos: a pessoa (nome, telefone, e-mail, CPF, nascimento, profissão,
--      endereço, redes, observações, cliente, opt-in/opt-out de WhatsApp). O
--      dependente é um contato com responsavel_id (o responsável) e relação.
--      Telefone único por unidade entre os titulares.
--   2. Backfill 1:1: cada lead vira um contato com o MESMO id (leads.contato_id =
--      leads.id); cada dependente (lead_contacts) vira um contato com o id dele,
--      ligado ao contato do lead. wa_conversations.contato_id vem do lead.
--   3. Espelho enquanto o app grava no lead (SECURITY DEFINER: o app não escreve em
--      contatos):
--      - lead novo cria o contato com o id do lead;
--      - mudar a pessoa ou a unidade no lead atualiza o contato (e os dependentes
--        seguem a unidade);
--      - lead apagado (ou removido por mesclar_leads) apaga o contato que ficou sem
--        lead;
--      - dependente (lead_contacts) criado, alterado ou apagado espelha no contato;
--      - conversa ligada a um lead recebe o contato dele.
--   4. RLS: quem está na unidade (ou a marca) lê; ninguém do app grava ainda.
--
-- Aplicar em produção é [H]: o Infra aplica, com aprovação e backup do dia, como
-- supabase_admin, com --single-transaction; depois registra a versão '148' e roda
-- notify pgrst, 'reload schema'. Sem BEGIN/COMMIT. Idempotente. Pode ir antes ou
-- depois do deploy: nada no app lê contatos ainda.
--
-- Reversão:
--   DROP TRIGGER IF EXISTS trg_lead_contato ON public.leads;
--   DROP TRIGGER IF EXISTS trg_lead_contato_espelho ON public.leads;
--   DROP TRIGGER IF EXISTS trg_lead_contato_apaga ON public.leads;
--   DROP TRIGGER IF EXISTS trg_dependente_contato ON public.lead_contacts;
--   DROP TRIGGER IF EXISTS trg_conversa_contato ON public.wa_conversations;
--   ALTER TABLE public.wa_conversations DROP COLUMN IF EXISTS contato_id;
--   ALTER TABLE public.leads DROP COLUMN IF EXISTS contato_id;
--   DROP TABLE IF EXISTS public.contatos;
--   DROP FUNCTION IF EXISTS public.fn_lead_contato(), public.fn_lead_contato_espelho(),
--     public.fn_lead_contato_apaga(), public.fn_dependente_contato(), public.fn_conversa_contato();

SET LOCAL lock_timeout = '5s';

DO $$
BEGIN
  IF current_setting('lock_timeout') <> '5s' THEN
    RAISE EXCEPTION '148: rode com --single-transaction (lock_timeout atual: %)', current_setting('lock_timeout');
  END IF;
  IF current_user <> 'supabase_admin' THEN
    RAISE EXCEPTION '148: rodar como supabase_admin (atual: %)', current_user;
  END IF;
END $$;

-- ── 1. Contatos ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.contatos (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id         uuid        NOT NULL REFERENCES public.units (id) ON DELETE CASCADE,
  nome            text        NOT NULL,
  sobrenome       text,
  telefone        text,
  telefone_norm   text        GENERATED ALWAYS AS (public.normalizar_telefone(telefone)) STORED,
  email           text,
  cpf             text,
  data_nascimento date,
  profissao       text,
  cidade          text,
  estado          text,
  pais            text,
  instagram       text,
  site            text,
  observacoes     text,
  cliente         boolean     NOT NULL DEFAULT false,
  wa_optin_at     timestamptz,
  wa_optout_at    timestamptz,
  responsavel_id  uuid        REFERENCES public.contatos (id) ON DELETE CASCADE,
  relacao         text,
  criado_em       timestamptz NOT NULL DEFAULT now(),
  atualizado_em   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT contatos_dependente_check CHECK (responsavel_id IS NULL OR responsavel_id <> id)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_contatos_unit_telefone
  ON public.contatos (unit_id, telefone_norm) WHERE telefone_norm IS NOT NULL AND responsavel_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_contatos_unit_nome ON public.contatos (unit_id, nome);
CREATE INDEX IF NOT EXISTS idx_contatos_responsavel ON public.contatos (responsavel_id) WHERE responsavel_id IS NOT NULL;

ALTER TABLE public.contatos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.contatos FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.contatos FROM authenticated;
GRANT SELECT ON public.contatos TO authenticated;
GRANT ALL ON public.contatos TO service_role;

DROP POLICY IF EXISTS contatos_select ON public.contatos;
CREATE POLICY contatos_select ON public.contatos FOR SELECT TO authenticated USING (
  (SELECT public.is_global_admin())
  OR unit_id IN (SELECT uu.unit_id FROM public.user_units uu WHERE uu.user_id = (SELECT auth.uid()))
);

ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS contato_id uuid REFERENCES public.contatos (id) ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS idx_leads_contato ON public.leads (contato_id);
ALTER TABLE public.wa_conversations ADD COLUMN IF NOT EXISTS contato_id uuid REFERENCES public.contatos (id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_wa_conversations_contato ON public.wa_conversations (contato_id);

-- ── 2. Backfill ──────────────────────────────────────────────────────────────
INSERT INTO public.contatos (id, unit_id, nome, sobrenome, telefone, email, cpf, data_nascimento, profissao,
                             cidade, estado, pais, instagram, site, observacoes, cliente, wa_optin_at, wa_optout_at, criado_em)
SELECT l.id, l.unit_id, l.nome, l.sobrenome, l.telefone, l.email, l.cpf, l.data_nascimento, l.profissao,
       l.cidade, l.estado, l.pais, l.instagram, l.site, l.observacoes_cli, coalesce(l.is_converted, false),
       l.wa_optin_at, l.wa_optout_at, l.created_at
  FROM public.leads l
 WHERE l.contato_id IS NULL
ON CONFLICT (id) DO NOTHING;

UPDATE public.leads SET contato_id = id WHERE contato_id IS NULL;
ALTER TABLE public.leads ALTER COLUMN contato_id SET NOT NULL;

INSERT INTO public.contatos (id, unit_id, nome, telefone, email, data_nascimento, observacoes, responsavel_id, relacao, criado_em)
SELECT lc.id, l.unit_id, lc.nome, lc.telefone, lc.email, lc.data_nascimento, lc.observacao, l.contato_id, lc.relacao, lc.created_at
  FROM public.lead_contacts lc
  JOIN public.leads l ON l.id = lc.lead_id
ON CONFLICT (id) DO NOTHING;

UPDATE public.wa_conversations wc
   SET contato_id = l.contato_id
  FROM public.leads l
 WHERE l.id = wc.lead_id AND wc.contato_id IS DISTINCT FROM l.contato_id;

-- ── 3. Espelho ───────────────────────────────────────────────────────────────
-- Lead novo: cria o contato com o mesmo id (o app ainda não escolhe contato)
CREATE OR REPLACE FUNCTION public.fn_lead_contato()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  IF NEW.contato_id IS NULL THEN
    INSERT INTO public.contatos (id, unit_id, nome, sobrenome, telefone, email, cpf, data_nascimento, profissao,
                                 cidade, estado, pais, instagram, site, observacoes, cliente, wa_optin_at, wa_optout_at)
    VALUES (NEW.id, NEW.unit_id, NEW.nome, NEW.sobrenome, NEW.telefone, NEW.email, NEW.cpf, NEW.data_nascimento,
            NEW.profissao, NEW.cidade, NEW.estado, NEW.pais, NEW.instagram, NEW.site, NEW.observacoes_cli,
            coalesce(NEW.is_converted, false), NEW.wa_optin_at, NEW.wa_optout_at);
    NEW.contato_id := NEW.id;
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.fn_lead_contato() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_lead_contato ON public.leads;
CREATE TRIGGER trg_lead_contato BEFORE INSERT ON public.leads
  FOR EACH ROW EXECUTE FUNCTION public.fn_lead_contato();

-- Pessoa ou unidade alterada no lead: o contato acompanha
CREATE OR REPLACE FUNCTION public.fn_lead_contato_espelho()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  UPDATE public.contatos
     SET unit_id = NEW.unit_id, nome = NEW.nome, sobrenome = NEW.sobrenome, telefone = NEW.telefone,
         email = NEW.email, cpf = NEW.cpf, data_nascimento = NEW.data_nascimento, profissao = NEW.profissao,
         cidade = NEW.cidade, estado = NEW.estado, pais = NEW.pais, instagram = NEW.instagram, site = NEW.site,
         observacoes = NEW.observacoes_cli, cliente = coalesce(NEW.is_converted, false),
         wa_optin_at = NEW.wa_optin_at, wa_optout_at = NEW.wa_optout_at, atualizado_em = now()
   WHERE id = NEW.contato_id;
  IF NEW.unit_id IS DISTINCT FROM OLD.unit_id THEN
    UPDATE public.contatos SET unit_id = NEW.unit_id, atualizado_em = now() WHERE responsavel_id = NEW.contato_id;
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.fn_lead_contato_espelho() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_lead_contato_espelho ON public.leads;
CREATE TRIGGER trg_lead_contato_espelho AFTER UPDATE OF unit_id, nome, sobrenome, telefone, email, cpf, data_nascimento,
  profissao, cidade, estado, pais, instagram, site, observacoes_cli, is_converted, wa_optin_at, wa_optout_at
  ON public.leads FOR EACH ROW EXECUTE FUNCTION public.fn_lead_contato_espelho();

-- Lead apagado (ou removido por mesclar_leads): apaga o contato que ficou sem lead
CREATE OR REPLACE FUNCTION public.fn_lead_contato_apaga()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.leads l WHERE l.contato_id = OLD.contato_id) THEN
    DELETE FROM public.contatos WHERE id = OLD.contato_id;
  END IF;
  RETURN OLD;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.fn_lead_contato_apaga() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_lead_contato_apaga ON public.leads;
CREATE TRIGGER trg_lead_contato_apaga AFTER DELETE ON public.leads
  FOR EACH ROW EXECUTE FUNCTION public.fn_lead_contato_apaga();

-- Dependentes: o contato do dependente tem o id da linha de lead_contacts
CREATE OR REPLACE FUNCTION public.fn_dependente_contato()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_lead public.leads%ROWTYPE;
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM public.contatos WHERE id = OLD.id;
    RETURN OLD;
  END IF;
  SELECT * INTO v_lead FROM public.leads WHERE id = NEW.lead_id;
  INSERT INTO public.contatos (id, unit_id, nome, telefone, email, data_nascimento, observacoes, responsavel_id, relacao)
  VALUES (NEW.id, v_lead.unit_id, NEW.nome, NEW.telefone, NEW.email, NEW.data_nascimento, NEW.observacao,
          v_lead.contato_id, NEW.relacao)
  ON CONFLICT (id) DO UPDATE
     SET unit_id = EXCLUDED.unit_id, nome = EXCLUDED.nome, telefone = EXCLUDED.telefone, email = EXCLUDED.email,
         data_nascimento = EXCLUDED.data_nascimento, observacoes = EXCLUDED.observacoes,
         responsavel_id = EXCLUDED.responsavel_id, relacao = EXCLUDED.relacao, atualizado_em = now();
  RETURN NEW;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.fn_dependente_contato() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_dependente_contato ON public.lead_contacts;
CREATE TRIGGER trg_dependente_contato AFTER INSERT OR UPDATE OR DELETE ON public.lead_contacts
  FOR EACH ROW EXECUTE FUNCTION public.fn_dependente_contato();

-- Conversa ligada a um lead recebe o contato dele (depois de trg_auto_link_wa_conversation)
CREATE OR REPLACE FUNCTION public.fn_conversa_contato()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  IF NEW.lead_id IS NOT NULL AND (TG_OP = 'INSERT' OR NEW.lead_id IS DISTINCT FROM OLD.lead_id) THEN
    NEW.contato_id := (SELECT l.contato_id FROM public.leads l WHERE l.id = NEW.lead_id);
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.fn_conversa_contato() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_conversa_contato ON public.wa_conversations;
CREATE TRIGGER trg_conversa_contato BEFORE INSERT OR UPDATE OF lead_id ON public.wa_conversations
  FOR EACH ROW EXECUTE FUNCTION public.fn_conversa_contato();

-- ── Conferência ──────────────────────────────────────────────────────────────
DO $$
DECLARE
  sem_contato bigint;
  dependentes bigint;
BEGIN
  SELECT count(*) INTO sem_contato FROM public.leads l
   WHERE NOT EXISTS (SELECT 1 FROM public.contatos c WHERE c.id = l.contato_id);
  SELECT count(*) INTO dependentes FROM public.lead_contacts lc
   WHERE NOT EXISTS (SELECT 1 FROM public.contatos c WHERE c.id = lc.id AND c.responsavel_id IS NOT NULL);
  IF sem_contato > 0 OR dependentes > 0 THEN
    RAISE EXCEPTION '148: % lead(s) sem contato, % dependente(s) sem contato', sem_contato, dependentes;
  END IF;
  IF EXISTS (SELECT 1 FROM public.wa_conversations wc JOIN public.leads l ON l.id = wc.lead_id
              WHERE wc.contato_id IS DISTINCT FROM l.contato_id) THEN
    RAISE EXCEPTION '148: conversa com lead e contato diferentes';
  END IF;
END $$;
