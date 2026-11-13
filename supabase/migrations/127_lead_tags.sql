-- 127_lead_tags.sql
-- Tags no lead, com o mesmo catálogo das conversas (wa_tags).
--
-- Por quê: hoje a tag só existe na conversa (wa_conversation_tags). Um lead sem
-- conversa não pode ser marcado, e o funil, as campanhas e as automações precisam
-- segmentar pelo cliente, não pelo atendimento. Em produção (04/11/2026) há 17
-- tags e 39 aplicações em conversas, todas da unidade Itu.
--
-- O que faz:
--   1. lead_tags(lead_id, tag_id, unit_id, criado_em, criado_por). O trigger
--      lead_tags_unidade preenche unit_id com a unidade do lead e recusa tag de
--      outra unidade (23514). É SECURITY DEFINER para enxergar o lead e a tag
--      mesmo sem RLS: quem decide quem pode aplicar é a policy, não o trigger.
--      criado_por é o usuário do JWT quando houver (o navegador não escolhe).
--      Na transferência do lead para outra unidade as tags da origem saem
--      (trigger lead_tags_ao_transferir em leads).
--   2. RLS em lead_tags: membros da unidade (user_units) e admin global leem,
--      aplicam e removem; o WITH CHECK confere o lead e a tag, não só unit_id.
--      Sem UPDATE: trocar a tag é remover e aplicar.
--   3. Policy de wa_conversation_tags passa a validar a conversa: antes só a tag
--      era conferida, e um membro da unidade A podia marcar (e desmarcar) uma
--      conversa da unidade B com uma tag da A. Mesmo nome da policy da 092.
--   4. Cópia única das tags das conversas para o lead vinculado (sem apagar as da
--      conversa). Só roda na aplicação que cria a tabela: reaplicar não devolve ao
--      lead uma tag que alguém tirou depois. Pula pares de unidades diferentes.
--   5. mesclar_leads: corpo da 126 (que consolida o status: ganho > aberto >
--      perdido, datas e motivo) mais o tratamento de lead_tags (move as tags do
--      removido para o mantido sem duplicar) e a entrada na lista da trava de FKs.
--      Por isso exige a 126: aplicada antes dela, a 126 recriaria a função sem
--      lead_tags (e a trava de FKs recusaria toda mesclagem).
--
-- Reaplicar a 092 recria a policy antiga de wa_conversation_tags: se isso
-- acontecer, reaplique esta depois. Reaplicar a 121 ou a 126 recria mesclar_leads
-- sem lead_tags: reaplique depois a última migração que recria a função (esta,
-- ou uma posterior que parta do corpo desta).
--
-- Aplicar em produção é [H]: o Infra aplica, com aprovação e backup do dia, como
-- supabase_admin (dono de mesclar_leads), com --single-transaction; depois
-- registra a versão '127' e roda notify pgrst, 'reload schema'. Sem BEGIN/COMMIT.
-- Idempotente. Conferir depois: has_function_privilege('authenticated',
-- 'public.mesclar_leads(uuid,uuid,uuid)', 'EXECUTE') = false.
-- Reversão (só com aprovação): DROP TABLE public.lead_tags; recriar a policy de
-- wa_conversation_tags da 092 e mesclar_leads da 126.

SET LOCAL lock_timeout = '5s';

DO $$
BEGIN
  IF current_setting('lock_timeout') <> '5s' THEN
    RAISE EXCEPTION '127: rode com --single-transaction (lock_timeout atual: %)', current_setting('lock_timeout');
  END IF;
  IF current_user <> 'supabase_admin' THEN
    RAISE EXCEPTION '127: rodar como supabase_admin (atual: %)', current_user;
  END IF;
  IF to_regprocedure('public.mesclar_leads(uuid,uuid,uuid)') IS NULL THEN
    RAISE EXCEPTION '127: depende da 121 (mesclar_leads)';
  END IF;
  IF to_regclass('public.motivos_perda') IS NULL
     OR NOT EXISTS (SELECT 1 FROM pg_attribute
                     WHERE attrelid = 'public.leads'::regclass AND attname = 'status' AND NOT attisdropped) THEN
    RAISE EXCEPTION '127: depende da 126 (leads.status, motivos_perda): mesclar_leads parte do corpo dela';
  END IF;
  IF to_regclass('public.wa_conversation_tags') IS NULL THEN
    RAISE EXCEPTION '127: depende da 058 (wa_tags, wa_conversation_tags)';
  END IF;
  PERFORM set_config('vc127.copiar_tags', (to_regclass('public.lead_tags') IS NULL)::text, true);
END $$;

CREATE TABLE IF NOT EXISTS public.lead_tags (
  lead_id    uuid        NOT NULL REFERENCES public.leads (id) ON DELETE CASCADE,
  tag_id     uuid        NOT NULL REFERENCES public.wa_tags (id) ON DELETE CASCADE,
  unit_id    uuid        NOT NULL REFERENCES public.units (id) ON DELETE CASCADE,
  criado_em  timestamptz NOT NULL DEFAULT now(),
  criado_por uuid        REFERENCES auth.users (id) ON DELETE SET NULL,
  PRIMARY KEY (lead_id, tag_id)
);

ALTER TABLE public.lead_tags OWNER TO postgres;

CREATE INDEX IF NOT EXISTS idx_lead_tags_unit_tag ON public.lead_tags (unit_id, tag_id);
CREATE INDEX IF NOT EXISTS idx_lead_tags_tag ON public.lead_tags (tag_id);

CREATE OR REPLACE FUNCTION public.lead_tags_unidade()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  unidade_lead uuid;
  unidade_tag  uuid;
BEGIN
  SELECT unit_id INTO unidade_lead FROM public.leads WHERE id = NEW.lead_id;
  SELECT unit_id INTO unidade_tag FROM public.wa_tags WHERE id = NEW.tag_id;
  IF unidade_lead IS NULL OR unidade_tag IS NULL THEN
    RAISE EXCEPTION 'lead_tags: lead ou tag não existe' USING ERRCODE = '23503';
  END IF;
  IF unidade_tag <> unidade_lead THEN
    RAISE EXCEPTION 'lead_tags: a tag é de outra unidade' USING ERRCODE = '23514';
  END IF;
  NEW.unit_id := unidade_lead;
  IF auth.uid() IS NOT NULL THEN
    NEW.criado_por := auth.uid();
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.lead_tags_unidade() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.lead_tags_unidade() TO service_role;

DROP TRIGGER IF EXISTS trg_lead_tags_unidade ON public.lead_tags;
CREATE TRIGGER trg_lead_tags_unidade
  BEFORE INSERT OR UPDATE ON public.lead_tags
  FOR EACH ROW EXECUTE FUNCTION public.lead_tags_unidade();

-- O catálogo de tags é por unidade: na transferência (api/leads/transfer) as tags
-- da unidade de origem não valem no destino
CREATE OR REPLACE FUNCTION public.lead_tags_ao_transferir()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  DELETE FROM public.lead_tags WHERE lead_id = NEW.id AND unit_id <> NEW.unit_id;
  RETURN NULL;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.lead_tags_ao_transferir() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.lead_tags_ao_transferir() TO service_role;

DROP TRIGGER IF EXISTS trg_lead_tags_ao_transferir ON public.leads;
CREATE TRIGGER trg_lead_tags_ao_transferir
  AFTER UPDATE OF unit_id ON public.leads
  FOR EACH ROW WHEN (NEW.unit_id IS DISTINCT FROM OLD.unit_id)
  EXECUTE FUNCTION public.lead_tags_ao_transferir();

ALTER TABLE public.lead_tags ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.lead_tags FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, DELETE ON public.lead_tags TO authenticated;
GRANT ALL ON public.lead_tags TO service_role;

DROP POLICY IF EXISTS lead_tags_select ON public.lead_tags;
CREATE POLICY lead_tags_select ON public.lead_tags
  FOR SELECT TO authenticated
  USING ((SELECT public.is_global_admin())
         OR unit_id IN (SELECT uu.unit_id FROM public.user_units uu WHERE uu.user_id = (SELECT auth.uid())));

DROP POLICY IF EXISTS lead_tags_insert ON public.lead_tags;
CREATE POLICY lead_tags_insert ON public.lead_tags
  FOR INSERT TO authenticated
  WITH CHECK (
    ((SELECT public.is_global_admin())
     OR unit_id IN (SELECT uu.unit_id FROM public.user_units uu WHERE uu.user_id = (SELECT auth.uid())))
    AND EXISTS (SELECT 1 FROM public.leads l WHERE l.id = lead_id AND l.unit_id = lead_tags.unit_id)
    AND EXISTS (SELECT 1 FROM public.wa_tags t WHERE t.id = tag_id AND t.unit_id = lead_tags.unit_id)
  );

DROP POLICY IF EXISTS lead_tags_delete ON public.lead_tags;
CREATE POLICY lead_tags_delete ON public.lead_tags
  FOR DELETE TO authenticated
  USING ((SELECT public.is_global_admin())
         OR unit_id IN (SELECT uu.unit_id FROM public.user_units uu WHERE uu.user_id = (SELECT auth.uid())));

-- FOR ALL porque a API grava com upsert (ON CONFLICT DO UPDATE exige UPDATE)
DROP POLICY IF EXISTS "unit_members_wa_conversation_tags" ON public.wa_conversation_tags;
CREATE POLICY "unit_members_wa_conversation_tags" ON public.wa_conversation_tags AS PERMISSIVE FOR ALL TO public
  USING (EXISTS (
    SELECT 1 FROM public.wa_conversations c
      JOIN public.wa_tags t ON t.unit_id = c.unit_id
     WHERE c.id = conversation_id AND t.id = tag_id
       AND ((SELECT public.is_global_admin())
            OR c.unit_id IN (SELECT uu.unit_id FROM public.user_units uu WHERE uu.user_id = (SELECT auth.uid())))))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.wa_conversations c
      JOIN public.wa_tags t ON t.unit_id = c.unit_id
     WHERE c.id = conversation_id AND t.id = tag_id
       AND ((SELECT public.is_global_admin())
            OR c.unit_id IN (SELECT uu.unit_id FROM public.user_units uu WHERE uu.user_id = (SELECT auth.uid())))));

DO $$
DECLARE
  copiadas bigint;
  puladas  bigint;
BEGIN
  IF current_setting('vc127.copiar_tags') <> 'true' THEN
    RETURN;
  END IF;
  INSERT INTO public.lead_tags (lead_id, tag_id, unit_id)
  SELECT DISTINCT c.lead_id, ct.tag_id, c.unit_id
    FROM public.wa_conversation_tags ct
    JOIN public.wa_conversations c ON c.id = ct.conversation_id
    JOIN public.wa_tags t ON t.id = ct.tag_id AND t.unit_id = c.unit_id
    JOIN public.leads l ON l.id = c.lead_id AND l.unit_id = c.unit_id
  ON CONFLICT (lead_id, tag_id) DO NOTHING;
  GET DIAGNOSTICS copiadas = ROW_COUNT;

  SELECT count(*) INTO puladas
    FROM public.wa_conversation_tags ct
    JOIN public.wa_conversations c ON c.id = ct.conversation_id
    LEFT JOIN public.wa_tags t ON t.id = ct.tag_id
    LEFT JOIN public.leads l ON l.id = c.lead_id
   WHERE c.lead_id IS NOT NULL
     AND (t.unit_id IS DISTINCT FROM c.unit_id OR l.unit_id IS DISTINCT FROM c.unit_id);
  RAISE NOTICE '127: % tag(s) copiada(s) das conversas para os leads; % aplicação(ões) de unidade divergente pulada(s)',
    copiadas, puladas;
END $$;

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
       'public.lead_tags.lead_id']);
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
  IF has_function_privilege('authenticated', 'public.mesclar_leads(uuid,uuid,uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.mesclar_leads(uuid,uuid,uuid)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.mesclar_leads(uuid,uuid,uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION '127: privilégios de mesclar_leads errados';
  END IF;
  IF has_function_privilege('authenticated', 'public.lead_tags_unidade()', 'EXECUTE')
     OR has_function_privilege('anon', 'public.lead_tags_unidade()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.lead_tags_ao_transferir()', 'EXECUTE')
     OR has_function_privilege('anon', 'public.lead_tags_ao_transferir()', 'EXECUTE') THEN
    RAISE EXCEPTION '127: funções de trigger de lead_tags executáveis por authenticated/anon';
  END IF;
  IF has_table_privilege('anon', 'public.lead_tags', 'SELECT')
     OR has_table_privilege('authenticated', 'public.lead_tags', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.lead_tags', 'TRUNCATE') THEN
    RAISE EXCEPTION '127: lead_tags com privilégios além de SELECT/INSERT/DELETE para authenticated';
  END IF;
  IF (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'wa_conversation_tags') <> 1 THEN
    RAISE EXCEPTION '127: wa_conversation_tags deveria ter exatamente uma policy';
  END IF;
END $$;
