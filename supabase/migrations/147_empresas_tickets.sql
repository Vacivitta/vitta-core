-- 147_empresas_tickets.sql
-- Empresas e tickets (Fase 3·2, entrega 4).
--
-- Por quê: o comercial de licenças e as campanhas in company trabalham com
-- empresas, e a CS precisa abrir e acompanhar pedidos de suporte (tickets) com
-- funil próprio, a partir da conversa (decisões de 05/11/2026: tickets ficam na
-- unidade de quem atende; abertura manual pelo botão na conversa; funil com
-- etapas configuráveis).
--
-- O que faz:
--   1. funnels.objeto ('negocio' | 'ticket', padrão negocio). Lead só em funil de
--      negócio e ticket só em funil de ticket (23514); funil com registros não
--      troca de objeto.
--   2. empresas (unit_id, nome, CNPJ com 14 dígitos e único na unidade,
--      responsável, observação) e empresa_vinculos (empresa, lead, papel). O grupo
--      do WhatsApp pode ser ligado a uma empresa (wa_conversations.empresa_id).
--   3. tickets (número, título, descrição, funil e etapa de ticket, status
--      aberto | resolvido, prioridade, responsável, empresa, lead, conversa, quem
--      abriu). Tudo da mesma unidade (23514); resolvido_em segue o status.
--   4. Aviso pessoal ao responsável quando o ticket é atribuído a outra pessoa
--      (notifications.ticket_id), por fn_ticket_notifica (SECURITY DEFINER: o app
--      não grava notifications desde a 136).
--   5. Módulos (146): criar empresa exige 'empresas'; criar ticket, 'tickets'.
--   6. RLS: quem está na unidade (ou a marca) lê e grava; apagar empresa ou
--      ticket, só gestor.
--   7. mesclar_leads passa a mover vínculos com empresas e tickets do lead
--      removido (a guarda dela recusa FK para leads sem tratamento).
--
-- Aplicar em produção é [H]: o Infra aplica, com aprovação e backup do dia, como
-- supabase_admin, com --single-transaction; depois registra a versão '147' e roda
-- notify pgrst, 'reload schema'. Sem BEGIN/COMMIT. Idempotente. Depois da 146 e
-- antes do deploy do app desta versão. O app de hoje a ignora (todos os funis
-- nascem 'negocio').
--
-- Reversão:
--   (reaplicar mesclar_leads da 129)
--   DROP TABLE IF EXISTS public.tickets, public.empresa_vinculos CASCADE;
--   ALTER TABLE public.wa_conversations DROP COLUMN IF EXISTS empresa_id;
--   ALTER TABLE public.notifications DROP COLUMN IF EXISTS ticket_id;
--   DROP TABLE IF EXISTS public.empresas CASCADE;
--   DROP TRIGGER IF EXISTS trg_lead_funil_negocio ON public.leads;
--   DROP TRIGGER IF EXISTS trg_funil_objeto_fixo ON public.funnels;
--   DROP FUNCTION IF EXISTS public.fn_lead_funil_negocio(), public.fn_funil_objeto_fixo(),
--     public.fn_ticket_consistente(), public.fn_ticket_notifica(), public.fn_empresa_vinculo_unidade(),
--     public.fn_conversa_empresa();
--   ALTER TABLE public.funnels DROP COLUMN IF EXISTS objeto;

SET LOCAL lock_timeout = '5s';

DO $$
BEGIN
  IF current_setting('lock_timeout') <> '5s' THEN
    RAISE EXCEPTION '147: rode com --single-transaction (lock_timeout atual: %)', current_setting('lock_timeout');
  END IF;
  IF current_user <> 'supabase_admin' THEN
    RAISE EXCEPTION '147: rodar como supabase_admin (atual: %)', current_user;
  END IF;
  IF to_regprocedure('public.modulo_ativo(uuid,text)') IS NULL THEN
    RAISE EXCEPTION '147: aplicar a 146 antes';
  END IF;
END $$;

-- ── 1. Funil de negócio ou de ticket ─────────────────────────────────────────
ALTER TABLE public.funnels ADD COLUMN IF NOT EXISTS objeto text NOT NULL DEFAULT 'negocio';
ALTER TABLE public.funnels DROP CONSTRAINT IF EXISTS funnels_objeto_check;
ALTER TABLE public.funnels ADD CONSTRAINT funnels_objeto_check CHECK (objeto IN ('negocio', 'ticket'));

CREATE OR REPLACE FUNCTION public.fn_lead_funil_negocio()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO public
AS $function$
BEGIN
  IF NEW.funnel_id IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.funnels f WHERE f.id = NEW.funnel_id AND f.objeto <> 'negocio') THEN
    RAISE EXCEPTION 'Lead só entra em funil de negócio' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.fn_lead_funil_negocio() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_lead_funil_negocio ON public.leads;
CREATE TRIGGER trg_lead_funil_negocio BEFORE INSERT OR UPDATE OF funnel_id ON public.leads
  FOR EACH ROW EXECUTE FUNCTION public.fn_lead_funil_negocio();

-- ── 2. Empresas ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.empresas (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id        uuid        NOT NULL REFERENCES public.units (id) ON DELETE CASCADE,
  nome           text        NOT NULL CHECK (btrim(nome) <> ''),
  cnpj           text        CHECK (cnpj ~ '^[0-9]{14}$'),
  responsavel_id uuid        REFERENCES public.profiles (id) ON DELETE SET NULL,
  observacao     text,
  criado_em      timestamptz NOT NULL DEFAULT now(),
  criado_por     uuid        REFERENCES public.profiles (id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_empresas_unit ON public.empresas (unit_id, nome);
CREATE UNIQUE INDEX IF NOT EXISTS uq_empresas_cnpj ON public.empresas (unit_id, cnpj) WHERE cnpj IS NOT NULL;

DROP TRIGGER IF EXISTS trg_modulo_empresas ON public.empresas;
CREATE TRIGGER trg_modulo_empresas BEFORE INSERT ON public.empresas
  FOR EACH ROW EXECUTE FUNCTION public.fn_exige_modulo('empresas');

CREATE TABLE IF NOT EXISTS public.empresa_vinculos (
  empresa_id uuid        NOT NULL REFERENCES public.empresas (id) ON DELETE CASCADE,
  lead_id    uuid        NOT NULL REFERENCES public.leads (id) ON DELETE CASCADE,
  papel      text        NOT NULL DEFAULT 'contato' CHECK (papel IN ('decisor', 'socio', 'contato', 'financeiro', 'outro')),
  criado_em  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (empresa_id, lead_id)
);
CREATE INDEX IF NOT EXISTS idx_empresa_vinculos_lead ON public.empresa_vinculos (lead_id);

CREATE OR REPLACE FUNCTION public.fn_empresa_vinculo_unidade()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO public
AS $function$
BEGIN
  IF (SELECT e.unit_id FROM public.empresas e WHERE e.id = NEW.empresa_id)
     IS DISTINCT FROM (SELECT l.unit_id FROM public.leads l WHERE l.id = NEW.lead_id) THEN
    RAISE EXCEPTION 'Empresa e lead são de unidades diferentes' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.fn_empresa_vinculo_unidade() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_empresa_vinculo_unidade ON public.empresa_vinculos;
CREATE TRIGGER trg_empresa_vinculo_unidade BEFORE INSERT OR UPDATE ON public.empresa_vinculos
  FOR EACH ROW EXECUTE FUNCTION public.fn_empresa_vinculo_unidade();

ALTER TABLE public.wa_conversations ADD COLUMN IF NOT EXISTS empresa_id uuid REFERENCES public.empresas (id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION public.fn_conversa_empresa()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO public
AS $function$
BEGIN
  IF NEW.empresa_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.empresas e WHERE e.id = NEW.empresa_id AND e.unit_id = NEW.unit_id) THEN
    RAISE EXCEPTION 'A empresa é de outra unidade' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.fn_conversa_empresa() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_conversa_empresa ON public.wa_conversations;
CREATE TRIGGER trg_conversa_empresa BEFORE INSERT OR UPDATE OF empresa_id, unit_id ON public.wa_conversations
  FOR EACH ROW EXECUTE FUNCTION public.fn_conversa_empresa();

-- ── 3. Tickets ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.tickets (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  numero         bigint      GENERATED ALWAYS AS IDENTITY UNIQUE,
  unit_id        uuid        NOT NULL REFERENCES public.units (id) ON DELETE CASCADE,
  titulo         text        NOT NULL CHECK (btrim(titulo) <> ''),
  descricao      text,
  funnel_id      uuid        NOT NULL REFERENCES public.funnels (id) ON DELETE RESTRICT,
  stage_id       uuid        REFERENCES public.funnel_stages (id) ON DELETE SET NULL,
  status         text        NOT NULL DEFAULT 'aberto' CHECK (status IN ('aberto', 'resolvido')),
  prioridade     text        NOT NULL DEFAULT 'media' CHECK (prioridade IN ('baixa', 'media', 'alta', 'urgente')),
  responsavel_id uuid        REFERENCES public.profiles (id) ON DELETE SET NULL,
  empresa_id     uuid        REFERENCES public.empresas (id) ON DELETE SET NULL,
  lead_id        uuid        REFERENCES public.leads (id) ON DELETE SET NULL,
  conversa_id    uuid        REFERENCES public.wa_conversations (id) ON DELETE SET NULL,
  criado_por     uuid        REFERENCES public.profiles (id) ON DELETE SET NULL,
  criado_em      timestamptz NOT NULL DEFAULT now(),
  atualizado_em  timestamptz NOT NULL DEFAULT now(),
  resolvido_em   timestamptz
);
CREATE INDEX IF NOT EXISTS idx_tickets_unit ON public.tickets (unit_id, status, criado_em DESC);
CREATE INDEX IF NOT EXISTS idx_tickets_responsavel ON public.tickets (responsavel_id) WHERE status = 'aberto';
CREATE INDEX IF NOT EXISTS idx_tickets_empresa ON public.tickets (empresa_id);
CREATE INDEX IF NOT EXISTS idx_tickets_lead ON public.tickets (lead_id);
CREATE INDEX IF NOT EXISTS idx_tickets_conversa ON public.tickets (conversa_id);

DROP TRIGGER IF EXISTS trg_modulo_tickets ON public.tickets;
CREATE TRIGGER trg_modulo_tickets BEFORE INSERT ON public.tickets
  FOR EACH ROW EXECUTE FUNCTION public.fn_exige_modulo('tickets');

CREATE OR REPLACE FUNCTION public.fn_ticket_consistente()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO public
AS $function$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.funnels f WHERE f.id = NEW.funnel_id AND f.unit_id = NEW.unit_id AND f.objeto = 'ticket') THEN
    RAISE EXCEPTION 'O ticket precisa de um funil de ticket da mesma unidade' USING ERRCODE = '23514';
  END IF;
  IF NEW.stage_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.funnel_stages s WHERE s.id = NEW.stage_id AND s.funnel_id = NEW.funnel_id) THEN
    RAISE EXCEPTION 'A etapa é de outro funil' USING ERRCODE = '23514';
  END IF;
  IF NEW.empresa_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.empresas e WHERE e.id = NEW.empresa_id AND e.unit_id = NEW.unit_id) THEN
    RAISE EXCEPTION 'A empresa do ticket é de outra unidade' USING ERRCODE = '23514';
  END IF;
  IF NEW.lead_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.leads l WHERE l.id = NEW.lead_id AND l.unit_id = NEW.unit_id) THEN
    RAISE EXCEPTION 'O lead do ticket é de outra unidade' USING ERRCODE = '23514';
  END IF;
  IF NEW.conversa_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.wa_conversations c WHERE c.id = NEW.conversa_id AND c.unit_id = NEW.unit_id) THEN
    RAISE EXCEPTION 'A conversa do ticket é de outra unidade' USING ERRCODE = '23514';
  END IF;
  IF NEW.responsavel_id IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.responsavel_id IS DISTINCT FROM OLD.responsavel_id)
     AND NOT EXISTS (SELECT 1 FROM public.user_units uu WHERE uu.user_id = NEW.responsavel_id AND uu.unit_id = NEW.unit_id) THEN
    RAISE EXCEPTION 'O responsável precisa estar na unidade do ticket' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'INSERT' THEN
    NEW.criado_por := coalesce(NEW.criado_por, auth.uid());
  END IF;
  NEW.atualizado_em := now();
  NEW.resolvido_em := CASE WHEN NEW.status = 'resolvido' THEN coalesce(NEW.resolvido_em, now()) END;
  RETURN NEW;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.fn_ticket_consistente() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_ticket_consistente ON public.tickets;
CREATE TRIGGER trg_ticket_consistente BEFORE INSERT OR UPDATE ON public.tickets
  FOR EACH ROW EXECUTE FUNCTION public.fn_ticket_consistente();

-- Funil com lead ou ticket não troca de objeto
CREATE OR REPLACE FUNCTION public.fn_funil_objeto_fixo()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO public
AS $function$
BEGIN
  IF NEW.objeto IS DISTINCT FROM OLD.objeto
     AND (EXISTS (SELECT 1 FROM public.leads l WHERE l.funnel_id = NEW.id)
          OR EXISTS (SELECT 1 FROM public.tickets t WHERE t.funnel_id = NEW.id)) THEN
    RAISE EXCEPTION 'O funil já tem registros; não dá para trocar entre negócio e ticket' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.fn_funil_objeto_fixo() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_funil_objeto_fixo ON public.funnels;
CREATE TRIGGER trg_funil_objeto_fixo BEFORE UPDATE OF objeto ON public.funnels
  FOR EACH ROW EXECUTE FUNCTION public.fn_funil_objeto_fixo();

-- ── 4. Aviso ao responsável ──────────────────────────────────────────────────
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS ticket_id uuid REFERENCES public.tickets (id) ON DELETE CASCADE;

CREATE OR REPLACE FUNCTION public.fn_ticket_notifica()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  IF NEW.responsavel_id IS NOT NULL
     AND NEW.responsavel_id IS DISTINCT FROM auth.uid()
     AND (TG_OP = 'INSERT' OR NEW.responsavel_id IS DISTINCT FROM OLD.responsavel_id) THEN
    INSERT INTO public.notifications (unit_id, user_id, type, title, body, lead_id, ticket_id)
    VALUES (NEW.unit_id, NEW.responsavel_id, 'ticket_atribuido',
            format('Ticket #%s atribuído a você', NEW.numero), left(NEW.titulo, 200), NEW.lead_id, NEW.id);
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.fn_ticket_notifica() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_ticket_notifica ON public.tickets;
CREATE TRIGGER trg_ticket_notifica AFTER INSERT OR UPDATE OF responsavel_id ON public.tickets
  FOR EACH ROW EXECUTE FUNCTION public.fn_ticket_notifica();

-- ── 6. Quem lê e grava ───────────────────────────────────────────────────────
ALTER TABLE public.empresas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.empresa_vinculos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tickets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.empresas, public.empresa_vinculos, public.tickets FROM anon;
REVOKE TRUNCATE ON public.empresas, public.empresa_vinculos, public.tickets FROM authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.empresas, public.empresa_vinculos, public.tickets TO authenticated;
GRANT ALL ON public.empresas, public.empresa_vinculos, public.tickets TO service_role;

DROP POLICY IF EXISTS empresas_membros ON public.empresas;
CREATE POLICY empresas_membros ON public.empresas FOR SELECT TO authenticated USING (
  (SELECT public.is_global_admin())
  OR unit_id IN (SELECT uu.unit_id FROM public.user_units uu WHERE uu.user_id = (SELECT auth.uid())));
DROP POLICY IF EXISTS empresas_grava ON public.empresas;
CREATE POLICY empresas_grava ON public.empresas FOR INSERT TO authenticated WITH CHECK (
  (SELECT public.is_global_admin())
  OR unit_id IN (SELECT uu.unit_id FROM public.user_units uu WHERE uu.user_id = (SELECT auth.uid())));
DROP POLICY IF EXISTS empresas_altera ON public.empresas;
CREATE POLICY empresas_altera ON public.empresas FOR UPDATE TO authenticated USING (
  (SELECT public.is_global_admin())
  OR unit_id IN (SELECT uu.unit_id FROM public.user_units uu WHERE uu.user_id = (SELECT auth.uid())))
  WITH CHECK (
  (SELECT public.is_global_admin())
  OR unit_id IN (SELECT uu.unit_id FROM public.user_units uu WHERE uu.user_id = (SELECT auth.uid())));
DROP POLICY IF EXISTS empresas_apaga ON public.empresas;
CREATE POLICY empresas_apaga ON public.empresas FOR DELETE TO authenticated USING (
  (SELECT public.is_global_admin())
  OR ((SELECT public.is_gestor())
      AND unit_id IN (SELECT uu.unit_id FROM public.user_units uu WHERE uu.user_id = (SELECT auth.uid()))));

-- Vínculo segue a empresa (EXISTS sob o RLS dela, que só restringe)
DROP POLICY IF EXISTS empresa_vinculos_membros ON public.empresa_vinculos;
CREATE POLICY empresa_vinculos_membros ON public.empresa_vinculos FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.empresas e WHERE e.id = empresa_vinculos.empresa_id))
  WITH CHECK (EXISTS (SELECT 1 FROM public.empresas e WHERE e.id = empresa_vinculos.empresa_id));

DROP POLICY IF EXISTS tickets_membros ON public.tickets;
CREATE POLICY tickets_membros ON public.tickets FOR SELECT TO authenticated USING (
  (SELECT public.is_global_admin())
  OR unit_id IN (SELECT uu.unit_id FROM public.user_units uu WHERE uu.user_id = (SELECT auth.uid())));
DROP POLICY IF EXISTS tickets_grava ON public.tickets;
CREATE POLICY tickets_grava ON public.tickets FOR INSERT TO authenticated WITH CHECK (
  (SELECT public.is_global_admin())
  OR unit_id IN (SELECT uu.unit_id FROM public.user_units uu WHERE uu.user_id = (SELECT auth.uid())));
DROP POLICY IF EXISTS tickets_altera ON public.tickets;
CREATE POLICY tickets_altera ON public.tickets FOR UPDATE TO authenticated USING (
  (SELECT public.is_global_admin())
  OR unit_id IN (SELECT uu.unit_id FROM public.user_units uu WHERE uu.user_id = (SELECT auth.uid())))
  WITH CHECK (
  (SELECT public.is_global_admin())
  OR unit_id IN (SELECT uu.unit_id FROM public.user_units uu WHERE uu.user_id = (SELECT auth.uid())));
DROP POLICY IF EXISTS tickets_apaga ON public.tickets;
CREATE POLICY tickets_apaga ON public.tickets FOR DELETE TO authenticated USING (
  (SELECT public.is_global_admin())
  OR ((SELECT public.is_gestor())
      AND unit_id IN (SELECT uu.unit_id FROM public.user_units uu WHERE uu.user_id = (SELECT auth.uid()))));

-- ── 7. Mesclar leads move empresas e tickets ─────────────────────────────────
-- Igual à da 129, com empresa_vinculos e tickets na lista e no que é movido.
CREATE OR REPLACE FUNCTION public.mesclar_leads(manter uuid, remover uuid, por uuid DEFAULT NULL)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  lm public.leads%ROWTYPE;
  lr public.leads%ROWTYPE;
  nr public.lead_negotiation%ROWTYPE;
  sem_tratamento text;
  status_final text;
  motivo_de_lr boolean;
BEGIN
  -- Depois de um restore o EXECUTE volta para authenticated (ver CLAUDE.md); a
  -- função não pode depender só do GRANT, porque apaga lead de qualquer unidade.
  IF coalesce(auth.role(), '') IN ('anon', 'authenticated') THEN
    RAISE EXCEPTION 'mesclar_leads: só o servidor mescla leads (api/leads/mesclar)' USING ERRCODE = '42501';
  END IF;
  IF manter IS NULL OR remover IS NULL THEN
    RAISE EXCEPTION 'mesclar_leads: informe os dois leads' USING ERRCODE = '22004';
  END IF;
  IF manter = remover THEN
    RAISE EXCEPTION 'mesclar_leads: o lead a manter e o lead a remover são o mesmo' USING ERRCODE = '22023';
  END IF;

  PERFORM 1 FROM public.leads WHERE id IN (manter, remover) ORDER BY id FOR UPDATE;
  SELECT * INTO lm FROM public.leads WHERE id = manter;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'mesclar_leads: lead % não existe', manter USING ERRCODE = 'P0002';
  END IF;
  SELECT * INTO lr FROM public.leads WHERE id = remover;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'mesclar_leads: lead % não existe', remover USING ERRCODE = 'P0002';
  END IF;
  IF lm.unit_id IS DISTINCT FROM lr.unit_id THEN
    RAISE EXCEPTION 'mesclar_leads: os leads são de unidades diferentes' USING ERRCODE = '22023';
  END IF;

  SELECT string_agg(format('%s.%s', c.conrelid::regclass, a.attname), ', ') INTO sem_tratamento
    FROM pg_catalog.pg_constraint c
    JOIN pg_catalog.pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
   WHERE c.contype = 'f'
     AND c.confrelid = 'public.leads'::regclass
     AND format('%s.%s', c.conrelid::regclass, a.attname) <> ALL (ARRAY[
       'public.lead_contacts.lead_id', 'public.lead_notes.lead_id', 'public.lead_tasks.lead_id',
       'public.lead_responsible_history.lead_id', 'public.lead_stage_history.lead_id',
       'public.notifications.lead_id', 'public.wa_conversations.lead_id',
       'public.wa_campaign_recipients.lead_id', 'public.wa_timed_automation_log.lead_id',
       'public.quotes.lead_id', 'public.lead_negotiation.lead_id', 'public.automation_runs.lead_id',
       'public.lead_tags.lead_id', 'public.lead_anexos.lead_id',
       'public.empresa_vinculos.lead_id', 'public.tickets.lead_id']);
  IF sem_tratamento IS NOT NULL THEN
    RAISE EXCEPTION 'mesclar_leads: chave estrangeira para leads sem tratamento: %', sem_tratamento;
  END IF;

  UPDATE public.lead_contacts            SET lead_id = manter WHERE lead_id = remover;
  UPDATE public.lead_notes               SET lead_id = manter WHERE lead_id = remover;
  UPDATE public.lead_tasks               SET lead_id = manter WHERE lead_id = remover;
  UPDATE public.lead_responsible_history SET lead_id = manter WHERE lead_id = remover;
  UPDATE public.lead_stage_history       SET lead_id = manter WHERE lead_id = remover;
  UPDATE public.notifications            SET lead_id = manter WHERE lead_id = remover;
  UPDATE public.wa_conversations         SET lead_id = manter WHERE lead_id = remover;
  UPDATE public.wa_campaign_recipients   SET lead_id = manter WHERE lead_id = remover;
  UPDATE public.wa_timed_automation_log  SET lead_id = manter WHERE lead_id = remover;
  UPDATE public.quotes                   SET lead_id = manter WHERE lead_id = remover;
  UPDATE public.automation_runs          SET lead_id = manter WHERE lead_id = remover;
  UPDATE public.lead_anexos              SET lead_id = manter WHERE lead_id = remover;
  UPDATE public.tickets                  SET lead_id = manter WHERE lead_id = remover;

  -- Os dois podem estar na mesma empresa (chave primária empresa_id, lead_id)
  INSERT INTO public.empresa_vinculos (empresa_id, lead_id, papel, criado_em)
  SELECT empresa_id, manter, papel, criado_em FROM public.empresa_vinculos WHERE lead_id = remover
  ON CONFLICT (empresa_id, lead_id) DO NOTHING;
  DELETE FROM public.empresa_vinculos WHERE lead_id = remover;

  -- Os dois podem ter a mesma tag (chave primária lead_id, tag_id)
  INSERT INTO public.lead_tags (lead_id, tag_id, unit_id, criado_em, criado_por)
  SELECT manter, tag_id, unit_id, criado_em, criado_por FROM public.lead_tags WHERE lead_id = remover
  ON CONFLICT (lead_id, tag_id) DO NOTHING;
  DELETE FROM public.lead_tags WHERE lead_id = remover;

  SELECT * INTO nr FROM public.lead_negotiation WHERE lead_id = remover;
  IF FOUND THEN
    IF EXISTS (SELECT 1 FROM public.lead_negotiation WHERE lead_id = manter) THEN
      UPDATE public.lead_negotiation
         SET valor_proposta  = coalesce(valor_proposta, nr.valor_proposta),
             modelo          = coalesce(modelo, nr.modelo),
             valor_negociado = coalesce(valor_negociado, nr.valor_negociado)
       WHERE lead_id = manter;
      DELETE FROM public.lead_negotiation WHERE lead_id = remover;
    ELSE
      UPDATE public.lead_negotiation SET lead_id = manter WHERE lead_id = remover;
    END IF;
  END IF;

  -- Negócio: ganho em qualquer um vale; senão, aberto em qualquer um vale
  status_final := CASE
    WHEN 'ganho'  IN (lm.status, lr.status) THEN 'ganho'
    WHEN 'aberto' IN (lm.status, lr.status) THEN 'aberto'
    ELSE 'perdido'
  END;
  -- Os dois perdidos: fica o motivo da perda mais recente
  motivo_de_lr := lr.status = 'perdido'
    AND (lm.status <> 'perdido'
         OR (lr.perdido_em IS NOT NULL AND (lm.perdido_em IS NULL OR lr.perdido_em > lm.perdido_em)));

  -- Apaga antes de completar `manter`: com o índice único da 122, copiar o
  -- telefone de `remover` para `manter` com os dois ainda vivos daria 23505
  DELETE FROM public.leads WHERE id = remover;

  UPDATE public.leads
     SET telefone        = coalesce(lm.telefone, lr.telefone),
         email           = coalesce(lm.email, lr.email),
         cpf             = coalesce(lm.cpf, lr.cpf),
         data_nascimento = coalesce(lm.data_nascimento, lr.data_nascimento),
         sobrenome       = coalesce(lm.sobrenome, lr.sobrenome),
         observacoes_cli = coalesce(lm.observacoes_cli, lr.observacoes_cli),
         origem          = coalesce(lm.origem, lr.origem),
         campanha_id     = coalesce(lm.campanha_id, lr.campanha_id),
         -- `||` fica com o valor da direita: o do lead mantido vence
         campos          = lr.campos || lm.campos,
         is_converted    = lm.is_converted OR lr.is_converted,
         status          = status_final,
         ganho_em        = greatest(lm.ganho_em, lr.ganho_em),
         perdido_em      = greatest(lm.perdido_em, lr.perdido_em),
         motivo_perda_id = CASE WHEN status_final <> 'perdido' THEN NULL
                                WHEN motivo_de_lr THEN lr.motivo_perda_id ELSE lm.motivo_perda_id END,
         motivo_perda    = CASE WHEN status_final <> 'perdido' THEN NULL
                                WHEN motivo_de_lr THEN lr.motivo_perda ELSE lm.motivo_perda END,
         wa_optin_at     = least(lm.wa_optin_at, lr.wa_optin_at),
         -- opt-out é obrigação legal: basta um dos dois ter pedido
         wa_optout_at    = coalesce(lm.wa_optout_at, lr.wa_optout_at),
         created_at      = least(lm.created_at, lr.created_at)
   WHERE id = manter;

  INSERT INTO public.lead_notes (lead_id, unit_id, autor_id, conteudo)
  VALUES (manter, lm.unit_id, por,
          format('Lead mesclado com %s em %s',
                 concat_ws(' ', lr.nome, lr.sobrenome),
                 to_char(now() AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI')));
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.mesclar_leads(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.mesclar_leads(uuid, uuid, uuid) TO service_role;

DO $$
BEGIN
  IF has_function_privilege('authenticated', 'public.fn_ticket_notifica()', 'EXECUTE')
     OR has_function_privilege('anon', 'public.fn_ticket_notifica()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.mesclar_leads(uuid,uuid,uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.mesclar_leads(uuid,uuid,uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION '147: funções SECURITY DEFINER executáveis por anon/authenticated';
  END IF;
END $$;
