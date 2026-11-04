-- 128_lead_anexos.sql
-- Anexos na ficha do lead: carteira de vacinação, pedido médico, contrato, proposta.
--
-- Por quê: anexo de paciente é dado de saúde (LGPD, dado sensível). Todos os
-- buckets que existem hoje são públicos (015, 046, 064, 076): quem tem a URL lê
-- o arquivo para sempre. Este bucket é privado e não tem policy nenhuma em
-- storage.objects: só o servidor (service_role) lê e grava, e o navegador recebe
-- uma URL assinada de 5 minutos depois de a rota conferir o acesso ao lead.
--
-- O que faz:
--   1. Bucket lead-anexos PRIVADO, 20 MB, só PDF, JPEG, PNG, WebP e HEIC/HEIF.
--      O caminho é <unit_id>/<lead_id>/<uuid>-<nome>; a coluna caminho é a fonte
--      da verdade (depois de mesclar leads o prefixo continua o do lead removido).
--   2. public.lead_anexos: uma linha por arquivo. unit_id vem do lead (trigger,
--      como a 065) e não pode divergir dele; quando o lead troca de unidade
--      (transferência) os anexos acompanham no mesmo UPDATE.
--   3. RLS: membros da unidade (user_units) e admin global leem. Ninguém do
--      navegador grava nem apaga: as rotas api/leads/[id]/anexos fazem isso com o
--      service_role, depois de conferir sessão, acesso e tipo do arquivo.
--   4. mesclar_leads (121) recriada com lead_anexos na lista: sem isso a trava
--      dela aborta toda mesclagem (FK nova para leads sem tratamento). Os anexos
--      passam para o lead mantido; o objeto no storage não muda de lugar.
--
-- Depende da 121 (mesclar_leads). Aplicar em produção é [H]: o Infra aplica, com
-- aprovação e backup do dia, como supabase_admin, com --single-transaction;
-- depois registra a versão '128' e roda notify pgrst, 'reload schema'. Sem
-- BEGIN/COMMIT. Idempotente. Depois de um restore, reaplicar (fecha de novo o
-- EXECUTE de mesclar_leads e das funções daqui). Reversão no fim (comentada).

SET LOCAL lock_timeout = '5s';

DO $$
BEGIN
  IF current_setting('lock_timeout') <> '5s' THEN
    RAISE EXCEPTION '128: rode com --single-transaction (lock_timeout atual: %)', current_setting('lock_timeout');
  END IF;
  IF current_user <> 'supabase_admin' THEN
    RAISE EXCEPTION '128: rodar como supabase_admin (atual: %)', current_user;
  END IF;
  IF to_regprocedure('public.mesclar_leads(uuid,uuid,uuid)') IS NULL THEN
    RAISE EXCEPTION '128: depende da 121 (mesclar_leads)';
  END IF;
  IF to_regclass('storage.buckets') IS NULL OR to_regclass('storage.objects') IS NULL THEN
    RAISE EXCEPTION '128: schema storage ausente';
  END IF;
END $$;

-- ── 1. Bucket privado ────────────────────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('lead-anexos', 'lead-anexos', false, 20971520,
        ARRAY['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'])
ON CONFLICT (id) DO UPDATE SET
  public             = false,
  file_size_limit    = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- ── 2. Tabela ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.lead_anexos (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id     uuid        NOT NULL REFERENCES public.leads (id) ON DELETE CASCADE,
  unit_id     uuid        NOT NULL REFERENCES public.units (id) ON DELETE CASCADE,
  caminho     text        NOT NULL UNIQUE,
  nome        text        NOT NULL CHECK (length(nome) BETWEEN 1 AND 200),
  mime        text        NOT NULL CHECK (mime IN ('application/pdf', 'image/jpeg', 'image/png', 'image/webp',
                                                   'image/heic', 'image/heif')),
  tamanho     bigint      NOT NULL CHECK (tamanho BETWEEN 1 AND 20971520),
  enviado_por uuid        REFERENCES public.profiles (id) ON DELETE SET NULL,
  criado_em   timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.lead_anexos OWNER TO postgres;

CREATE INDEX IF NOT EXISTS idx_lead_anexos_lead_criado ON public.lead_anexos (lead_id, criado_em DESC);

CREATE OR REPLACE FUNCTION public.fn_lead_anexos_unit()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE
  v_unit uuid;
BEGIN
  SELECT unit_id INTO v_unit FROM public.leads WHERE id = NEW.lead_id;
  IF NEW.unit_id IS NULL THEN
    NEW.unit_id := v_unit;
  ELSIF NEW.unit_id IS DISTINCT FROM v_unit THEN
    RAISE EXCEPTION 'lead_anexos: unit_id diferente da unidade do lead' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.fn_lead_anexos_unit() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.fn_lead_anexos_unit() TO service_role;

DROP TRIGGER IF EXISTS trg_lead_anexos_unit ON public.lead_anexos;
CREATE TRIGGER trg_lead_anexos_unit
  BEFORE INSERT OR UPDATE OF lead_id, unit_id ON public.lead_anexos
  FOR EACH ROW EXECUTE FUNCTION public.fn_lead_anexos_unit();

-- SECURITY DEFINER: o admin global pode trocar leads.unit_id pelo navegador
-- (guarda da 113) e authenticated não tem UPDATE em lead_anexos. Função de
-- trigger não é chamável diretamente.
CREATE OR REPLACE FUNCTION public.fn_lead_anexos_segue_unidade()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  UPDATE public.lead_anexos SET unit_id = NEW.unit_id
   WHERE lead_id = NEW.id AND unit_id IS DISTINCT FROM NEW.unit_id;
  RETURN NULL;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.fn_lead_anexos_segue_unidade() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.fn_lead_anexos_segue_unidade() TO service_role;

DROP TRIGGER IF EXISTS trg_lead_anexos_segue_unidade ON public.leads;
CREATE TRIGGER trg_lead_anexos_segue_unidade
  AFTER UPDATE OF unit_id ON public.leads
  FOR EACH ROW WHEN (OLD.unit_id IS DISTINCT FROM NEW.unit_id)
  EXECUTE FUNCTION public.fn_lead_anexos_segue_unidade();

-- ── 3. RLS e privilégios ─────────────────────────────────────────────────────
ALTER TABLE public.lead_anexos ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.lead_anexos FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.lead_anexos TO authenticated;
GRANT ALL    ON public.lead_anexos TO service_role;

DROP POLICY IF EXISTS "unit_members_lead_anexos_select" ON public.lead_anexos;
CREATE POLICY "unit_members_lead_anexos_select" ON public.lead_anexos AS PERMISSIVE FOR SELECT TO authenticated
  USING (
    (SELECT public.is_global_admin())
    OR unit_id IN (SELECT uu.unit_id FROM public.user_units uu WHERE uu.user_id = (SELECT auth.uid()))
  );

-- ── 4. mesclar_leads com lead_anexos ─────────────────────────────────────────
-- Corpo da 121, mais lead_anexos na lista da trava e no UPDATE.
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
       'public.lead_anexos.lead_id']);
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
         is_converted    = lm.is_converted OR lr.is_converted,
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

-- ── Conferência ──────────────────────────────────────────────────────────────
DO $$
DECLARE
  b storage.buckets%ROWTYPE;
  abertas text;
BEGIN
  SELECT * INTO b FROM storage.buckets WHERE id = 'lead-anexos';
  IF b.public IS DISTINCT FROM false OR b.file_size_limit IS DISTINCT FROM 20971520 THEN
    RAISE EXCEPTION '128: bucket lead-anexos deveria ser privado e com limite de 20 MB';
  END IF;

  -- Policy em storage.objects sem filtro de bucket valeria também para este
  -- (policies se somam); e nenhuma pode citar lead-anexos.
  SELECT string_agg(policyname, ', ') INTO abertas
    FROM pg_policies
   WHERE schemaname = 'storage' AND tablename = 'objects'
     AND (coalesce(qual, '') || coalesce(with_check, '') NOT LIKE '%bucket_id%'
          OR coalesce(qual, '') || coalesce(with_check, '') LIKE '%lead-anexos%');
  IF abertas IS NOT NULL THEN
    RAISE EXCEPTION '128: policies em storage.objects que alcançariam lead-anexos: %', abertas;
  END IF;

  SELECT string_agg(policyname, ', ') INTO abertas
    FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'lead_anexos'
     AND policyname <> 'unit_members_lead_anexos_select';
  IF abertas IS NOT NULL THEN
    RAISE EXCEPTION '128: policies inesperadas em lead_anexos: %', abertas;
  END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.lead_anexos'::regclass) THEN
    RAISE EXCEPTION '128: RLS desligado em lead_anexos';
  END IF;
  IF has_table_privilege('anon', 'public.lead_anexos', 'SELECT')
     OR has_table_privilege('authenticated', 'public.lead_anexos', 'INSERT,UPDATE,DELETE,TRUNCATE') THEN
    RAISE EXCEPTION '128: privilégios inesperados em lead_anexos para anon/authenticated';
  END IF;
  IF has_function_privilege('authenticated', 'public.mesclar_leads(uuid,uuid,uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.mesclar_leads(uuid,uuid,uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.fn_lead_anexos_segue_unidade()', 'EXECUTE')
     OR has_function_privilege('anon', 'public.fn_lead_anexos_segue_unidade()', 'EXECUTE') THEN
    RAISE EXCEPTION '128: funções executáveis por anon/authenticated';
  END IF;
END $$;

-- ── Reversão (só com aprovação; como supabase_admin, --single-transaction) ────
-- Apaga o registro dos anexos; os objetos do bucket ficam e precisam ser
-- removidos pela API do storage antes de apagar o bucket. mesclar_leads volta
-- reaplicando a 121 (só depois do DROP TABLE, senão a trava dela aborta).
-- DROP TRIGGER IF EXISTS trg_lead_anexos_segue_unidade ON public.leads;
-- DROP TABLE IF EXISTS public.lead_anexos;
-- DROP FUNCTION IF EXISTS public.fn_lead_anexos_segue_unidade();
-- DROP FUNCTION IF EXISTS public.fn_lead_anexos_unit();
