-- 121_telefone_normalizado.sql
-- Telefone do lead num formato só, busca que casa e mesclagem de duplicados.
--
-- Por quê: leads.telefone é texto livre. Em produção (03/11/2026) 2.985 de 3.026
-- leads estão como "(31) 99667-4494", e o webhook procurava o lead com
-- ilike '%<últimos 8 dígitos>%', que nunca casa com o número mascarado (o hífen
-- fica no meio): cada cliente que mandava mensagem virava um lead novo. O trigger
-- auto_link_wa_conversation existe em produção (criado fora das migrações) mas
-- compara telefone = wa_phone e também nunca casa.
--
-- O que faz:
--   1. normalizar_telefone(text): forma canônica, só dígitos com DDI. Brasil é
--      55 + DDD + número, celular sempre com o 9 (13 dígitos), fixo com 12.
--      Mesma regra de normalizarTelefone (src/lib/telefone.ts); os casos de
--      tests/db/telefone_casos.json valem para as duas. IMMUTABLE e executável
--      por authenticated: a coluna gerada a chama em todo INSERT/UPDATE de leads
--      feito pelo navegador.
--   2. leads.telefone_norm, coluna gerada (STORED), e índice NÃO único
--      (unit_id, telefone_norm). O índice único vem na 122, depois de mesclar os
--      duplicados que já existem.
--   3. mesclar_leads(manter, remover, por): move para `manter` tudo que aponta
--      para `remover`, completa os campos vazios de `manter`, registra uma nota e
--      apaga `remover`. Só service_role executa (a rota api/leads/mesclar confere
--      sessão, perfil gestor e unidade antes de chamar).
--   4. auto_link_wa_conversation(): passa a casar pelo telefone_norm, só com lead
--      não arquivado da mesma unidade, o mais recente; e o trigger BEFORE INSERT
--      em wa_conversations passa a ser versionado aqui.
--
-- Se um dia a regra de normalizar_telefone mudar, reaplique esta migração (ou
-- uma nova com a função nova): o passo "recalcula" no fim atualiza as linhas cuja
-- telefone_norm ficou diferente da regra, porque o Postgres não recalcula colunas
-- geradas quando só o corpo da função muda.
--
-- Aplicar em produção é [H]: o Infra aplica, com aprovação e backup do dia, como
-- supabase_admin, com --single-transaction; depois registra a versão '121' e roda
-- notify pgrst, 'reload schema'. Sem BEGIN/COMMIT. Idempotente. Reescreve a
-- tabela leads (ADD COLUMN STORED), rápido com ~3 mil linhas.
-- Ordem: 121 → deploy do app → mesclar os duplicados pela tela Clientes → 122.

SET LOCAL lock_timeout = '5s';

DO $$
BEGIN
  IF current_setting('lock_timeout') <> '5s' THEN
    RAISE EXCEPTION '121: rode com --single-transaction (lock_timeout atual: %)', current_setting('lock_timeout');
  END IF;
  IF current_user <> 'supabase_admin' THEN
    RAISE EXCEPTION '121: rodar como supabase_admin (atual: %)', current_user;
  END IF;
END $$;

-- ── 1. normalizar_telefone ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.normalizar_telefone(entrada text)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE PARALLEL SAFE
AS $function$
DECLARE
  internacional constant boolean := coalesce(entrada ~ '^\s*\+', false);
  d text := regexp_replace(coalesce(entrada, ''), '[^0-9]', '', 'g');
  nacional text;
  primeiro text;
BEGIN
  IF NOT internacional THEN
    d := ltrim(d, '0');
  END IF;

  IF d LIKE '55%' AND length(d) IN (12, 13) THEN
    nacional := substr(d, 3);
  ELSIF internacional OR length(d) > 11 THEN
    IF d NOT LIKE '55%' AND length(d) BETWEEN 11 AND 15 THEN
      RETURN d;
    END IF;
    RETURN NULL;
  ELSIF length(d) IN (10, 11) THEN
    nacional := d;
  ELSE
    RETURN NULL;
  END IF;

  IF nacional !~ '^[1-9][1-9]' THEN
    RETURN NULL;
  END IF;
  primeiro := substr(nacional, 3, 1);
  IF length(nacional) = 11 THEN
    RETURN CASE WHEN primeiro = '9' THEN '55' || nacional END;
  END IF;
  IF primeiro BETWEEN '2' AND '5' THEN
    RETURN '55' || nacional;
  END IF;
  IF primeiro BETWEEN '6' AND '9' THEN
    RETURN '55' || substr(nacional, 1, 2) || '9' || substr(nacional, 3);
  END IF;
  RETURN NULL;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.normalizar_telefone(text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.normalizar_telefone(text) TO authenticated, service_role;

-- ── 2. Coluna gerada e índice ────────────────────────────────────────────────
ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS telefone_norm text GENERATED ALWAYS AS (public.normalizar_telefone(telefone)) STORED;

CREATE INDEX IF NOT EXISTS idx_leads_unit_telefone_norm ON public.leads (unit_id, telefone_norm);

-- ── 3. mesclar_leads ─────────────────────────────────────────────────────────
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

  -- Uma FK nova para leads sem tratamento aqui seria apagada em cascata (ou
  -- zerada) em silêncio ao apagar `remover`: aborta em vez disso.
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
       'public.quotes.lead_id', 'public.lead_negotiation.lead_id']);
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
  -- telefone enquanto `remover` existe violaria a unicidade.
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

-- ── 4. auto_link_wa_conversation ─────────────────────────────────────────────
-- wa_phone é o wa_id da Meta: tem DDI mas vem sem '+'. O '+' evita que um número
-- estrangeiro de 11 dígitos seja lido como DDD + celular brasileiro.
CREATE OR REPLACE FUNCTION public.auto_link_wa_conversation()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE
  v_lead_id uuid;
BEGIN
  IF NEW.lead_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  SELECT id INTO v_lead_id
    FROM public.leads
   WHERE unit_id = NEW.unit_id
     AND NOT arquivado
     AND telefone_norm = public.normalizar_telefone('+' || NEW.wa_phone)
   ORDER BY created_at DESC
   LIMIT 1;

  IF v_lead_id IS NOT NULL THEN
    NEW.lead_id := v_lead_id;
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.auto_link_wa_conversation() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.auto_link_wa_conversation() TO service_role;

-- Em produção o trigger foi criado à mão, com nome desconhecido: remove qualquer
-- trigger de wa_conversations que chame esta função e cria o versionado.
DO $$
DECLARE t text;
BEGIN
  FOR t IN
    SELECT tgname FROM pg_trigger
     WHERE tgrelid = 'public.wa_conversations'::regclass
       AND tgfoid = 'public.auto_link_wa_conversation()'::regprocedure
       AND NOT tgisinternal
  LOOP
    EXECUTE format('DROP TRIGGER %I ON public.wa_conversations', t);
  END LOOP;
END $$;

CREATE TRIGGER trg_auto_link_wa_conversation
  BEFORE INSERT ON public.wa_conversations
  FOR EACH ROW EXECUTE FUNCTION public.auto_link_wa_conversation();

-- ── Recalcula e confere ──────────────────────────────────────────────────────
UPDATE public.leads SET telefone = telefone
 WHERE telefone_norm IS DISTINCT FROM public.normalizar_telefone(telefone);

DO $$
BEGIN
  IF public.normalizar_telefone('(31) 99667-4494') IS DISTINCT FROM '5531996674494'
     OR public.normalizar_telefone('3188887777') IS DISTINCT FROM '5531988887777'
     OR public.normalizar_telefone('+1 212 555 1234') IS DISTINCT FROM '12125551234' THEN
    RAISE EXCEPTION '121: normalizar_telefone fora da regra';
  END IF;
  IF has_function_privilege('authenticated', 'public.mesclar_leads(uuid,uuid,uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.mesclar_leads(uuid,uuid,uuid)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.mesclar_leads(uuid,uuid,uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION '121: privilégios de mesclar_leads errados';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.normalizar_telefone(text)', 'EXECUTE') THEN
    RAISE EXCEPTION '121: authenticated precisa executar normalizar_telefone (coluna gerada de leads)';
  END IF;
END $$;
