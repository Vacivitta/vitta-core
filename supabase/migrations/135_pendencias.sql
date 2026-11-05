-- 135_pendencias.sql
-- Pendências técnicas das fases 1 e 2: exclusão de etapa/funil sem perder
-- histórico, criação de campanha numa transação só e meta da unidade sem
-- duplicata.
--
-- Por quê:
--   - Excluir uma etapa ou um funil com leads pelo banco (SQL, PostgREST, outra
--     tela) tirava os leads do funil (leads.stage_id e leads.funnel_id ON DELETE
--     SET NULL, 002/068) e APAGAVA o histórico de quem passou pela etapa
--     (lead_stage_history.para_stage_id ON DELETE CASCADE, 023). O app já conta os
--     leads antes de excluir (src/lib/funnels.ts, PR #34); o banco não.
--   - Excluir um funil apagava em cascata os campos personalizados dele
--     (campos_lead.funnel_id, 129), embora a 129 diga que campo não se apaga: a
--     chave podia voltar com outro tipo e os valores gravados nos leads que
--     trocaram de funil ficavam sem rótulo.
--   - A tela de campanhas criava a campanha e depois inseria os destinatários em
--     lotes de 100, em chamadas separadas: falhando no meio, ficava campanha sem
--     (ou com parte dos) destinatários.
--   - UNIQUE (unit_id, user_id, month) de sales_goals (072) não pega a meta da
--     unidade (user_id NULL): NULLs são distintos, e o upsert de
--     /api/sales-goals duplicava a meta do mês em vez de atualizar.
--
-- O que faz:
--   1. FKs para funis e etapas:
--      - leads.stage_id e leads.funnel_id: ON DELETE RESTRICT. Excluir etapa ou
--        funil com algum lead (inclusive perdido ou arquivado) falha com 23503. A
--        ordem do app continua: funil vazio exclui, e as etapas vão em cascata
--        (funnel_stages.funnel_id ON DELETE CASCADE, sem leads nelas).
--      - lead_stage_history.para_stage_id: aceita NULL e passa a ON DELETE SET
--        NULL, como de_stage_id. Excluir uma etapa vazia (nenhum lead nela agora)
--        não apaga mais os movimentos de quem passou por ela: fica o registro
--        (quem, quando, de onde, via), sem o destino. Trigger
--        fn_historico_destino_obrigatorio: INSERT continua exigindo o destino
--        (23502), como o NOT NULL de antes; só a exclusão da etapa deixa NULL.
--      - campos_lead.funnel_id: ON DELETE RESTRICT, e o trigger
--        fn_funil_solta_campos (BEFORE DELETE em funnels) desativa os campos do
--        funil e os passa para a unidade (funnel_id NULL, ativo false) antes de
--        excluir: chave, tipo e valores gravados continuam, como na desativação.
--        Roda como quem exclui, sob o RLS de campos_lead (gestor da unidade ou
--        admin global): para quem não pode alterar os campos, sobra campo
--        apontando para o funil e o RESTRICT recusa a exclusão (23503).
--      - wa_timed_automations.filter_funnel_id e filter_stage_id: ON DELETE
--        RESTRICT (eram SET NULL, 070). Com SET NULL, excluir o funil ou a etapa
--        (mesmo vazios) usados como filtro de uma automação por tempo tirava o
--        filtro e a automação passava a valer para TODOS os leads/conversas da
--        unidade. Agora a exclusão falha com 23503 (o app diz qual automação);
--        excluir ou editar a automação antes. Os alvos de ação (action_stage_id
--        da 070, wa_automations.stage_id da 032b, quote_automations.stage_id da
--        019) ficam SET NULL: sem etapa, a automação não age (o cron e
--        execute_quote_automation pulam; a de evento registra 'mal_configurada'),
--        não amplia nada. Campanhas e metas não guardam funil nem etapa.
--      - motivos_perda (ON DELETE CASCADE do funil) e leads.motivo_perda_id (SET
--        NULL) ficam: com o funil vazio, só sobram motivos usados por leads que
--        trocaram de funil, e o trigger trg_motivo_perda_apagado (126) copia o nome
--        para leads.motivo_perda antes de apagar. Como esse trigger roda sob o RLS
--        de quem exclui, lead transferido para outra unidade perde o nome do
--        motivo (perdia antes também).
--   2. criar_campanha(unidade, nome, template, agendada_para, limite_diario,
--      destinatarios jsonb): insere a campanha e os destinatários num comando só
--      (tudo ou nada) e devolve a campanha. SECURITY INVOKER: roda com o RLS de
--      quem chama (a rota /api/whatsapp/campaign-create chama com a sessão do
--      usuário). Nome do template e categoria vêm da tabela, total de
--      destinatários e custo estimado são calculados dos destinatários, status
--      'agendada' com data (futura) e 'rascunho' sem. Recusa lead de outra unidade
--      e destinatário sem telefone. EXECUTE para authenticated e service_role.
--      O botão Disparar e o cron não mudam (a campanha nasce como antes).
--   3. sales_goals: UNIQUE NULLS NOT DISTINCT (unit_id, user_id, month). Aborta
--      se já houver metas repetidas (produção tinha 1 linha em sales_goals).
--
-- Depende da 129 (campos_lead) e da 132 (arquivado gerado por arquivado_em).
-- Aplicar em produção é [H]: o Infra aplica, com aprovação e backup do dia, como
-- supabase_admin, com --single-transaction; depois registra a versão '135' e roda
-- notify pgrst, 'reload schema'. Sem BEGIN/COMMIT. Idempotente. Recria FKs de
-- leads (valida ~3 mil linhas, rápido). Ordem com o deploy: 135 ANTES do app
-- (o app novo cria campanha por criar_campanha); o app de hoje funciona com a
-- 135 (ele já não exclui etapa nem funil com leads e cria campanha pelas tabelas).
-- Depois de um restore, reaplicar (fecha de novo o EXECUTE de anon em
-- criar_campanha); não recria funções SECURITY DEFINER, a 118 reaplicada depois
-- passa.
--
-- Reversão (só com aprovação; a de 1 volta a apagar histórico ao excluir etapa e a
-- tirar o filtro das automações por tempo):
--   DROP FUNCTION IF EXISTS public.criar_campanha(uuid, text, uuid, timestamptz, integer, jsonb);
--   DROP TRIGGER IF EXISTS trg_funil_solta_campos ON public.funnels;
--   DROP TRIGGER IF EXISTS trg_historico_destino_obrigatorio ON public.lead_stage_history;
--   DROP FUNCTION IF EXISTS public.fn_funil_solta_campos(), public.fn_historico_destino_obrigatorio();
--   recriar as FKs com o ON DELETE de antes (leads_stage_id_fkey e leads_funnel_id_fkey
--   SET NULL; wa_timed_automations_filter_funnel_id_fkey e _filter_stage_id_fkey SET
--   NULL; campos_lead_funnel_id_fkey CASCADE; lead_stage_history_para_stage_id_fkey
--   CASCADE, depois DELETE das linhas com para_stage_id NULL e SET NOT NULL);
--   sales_goals: DROP CONSTRAINT sales_goals_unit_id_user_id_month_key e
--   ADD CONSTRAINT ... UNIQUE (unit_id, user_id, month).

SET LOCAL lock_timeout = '5s';

DO $$
BEGIN
  IF current_setting('lock_timeout') <> '5s' THEN
    RAISE EXCEPTION '135: rode com --single-transaction (lock_timeout atual: %)', current_setting('lock_timeout');
  END IF;
  IF current_user <> 'supabase_admin' THEN
    RAISE EXCEPTION '135: rodar como supabase_admin (atual: %)', current_user;
  END IF;
  IF to_regclass('public.campos_lead') IS NULL THEN
    RAISE EXCEPTION '135: depende da 129 (campos_lead)';
  END IF;
  IF to_regprocedure('public.fn_lead_arquivado()') IS NULL THEN
    RAISE EXCEPTION '135: depende da 132 (fn_lead_arquivado)';
  END IF;
END $$;

-- ── 1. FKs para funis e etapas ───────────────────────────────────────────────
ALTER TABLE public.lead_stage_history ALTER COLUMN para_stage_id DROP NOT NULL;

-- Troca toda FK da coluna para o alvo (o nome pode ter derivado na produção)
-- pela FK com o nome e o ON DELETE abaixo; não mexe se já está assim.
DO $$
DECLARE
  fk record;
  coluna_num smallint;
  ja_certa boolean;
  antiga text;
BEGIN
  FOR fk IN
    SELECT * FROM (VALUES
      ('public.leads'::regclass, 'stage_id', 'public.funnel_stages'::regclass, 'leads_stage_id_fkey', 'r'),
      ('public.leads', 'funnel_id', 'public.funnels', 'leads_funnel_id_fkey', 'r'),
      ('public.lead_stage_history', 'para_stage_id', 'public.funnel_stages', 'lead_stage_history_para_stage_id_fkey', 'n'),
      ('public.campos_lead', 'funnel_id', 'public.funnels', 'campos_lead_funnel_id_fkey', 'r'),
      ('public.wa_timed_automations', 'filter_funnel_id', 'public.funnels', 'wa_timed_automations_filter_funnel_id_fkey', 'r'),
      ('public.wa_timed_automations', 'filter_stage_id', 'public.funnel_stages', 'wa_timed_automations_filter_stage_id_fkey', 'r')
    ) AS t(tabela, coluna, alvo, nome, acao)
  LOOP
    SELECT attnum INTO coluna_num FROM pg_attribute WHERE attrelid = fk.tabela AND attname = fk.coluna;

    SELECT count(*) = 1 AND bool_and(c.conname = fk.nome AND c.confdeltype = fk.acao) INTO ja_certa
      FROM pg_constraint c
     WHERE c.conrelid = fk.tabela AND c.contype = 'f' AND c.confrelid = fk.alvo AND c.conkey = ARRAY[coluna_num];
    CONTINUE WHEN ja_certa;

    FOR antiga IN
      SELECT c.conname FROM pg_constraint c
       WHERE c.conrelid = fk.tabela AND c.contype = 'f' AND c.confrelid = fk.alvo AND c.conkey = ARRAY[coluna_num]
    LOOP
      EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', fk.tabela, antiga);
    END LOOP;
    EXECUTE format('ALTER TABLE %s ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES %s (id) ON DELETE %s',
                   fk.tabela, fk.nome, fk.coluna, fk.alvo,
                   CASE fk.acao WHEN 'r' THEN 'RESTRICT' ELSE 'SET NULL' END);
  END LOOP;
END $$;

-- search_path 'public' (não ''), como as funções de trigger da 126: rodam como
-- quem escreve e as policies que disparam resolvem nomes pelo search_path.
CREATE OR REPLACE FUNCTION public.fn_historico_destino_obrigatorio()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.para_stage_id IS NULL THEN
    RAISE EXCEPTION 'Movimento de etapa sem a etapa de destino' USING ERRCODE = '23502';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_historico_destino_obrigatorio ON public.lead_stage_history;
CREATE TRIGGER trg_historico_destino_obrigatorio
  BEFORE INSERT ON public.lead_stage_history
  FOR EACH ROW EXECUTE FUNCTION public.fn_historico_destino_obrigatorio();

CREATE OR REPLACE FUNCTION public.fn_funil_solta_campos()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  UPDATE public.campos_lead SET ativo = false, funnel_id = NULL WHERE funnel_id = OLD.id;
  RETURN OLD;
END;
$function$;

DROP TRIGGER IF EXISTS trg_funil_solta_campos ON public.funnels;
CREATE TRIGGER trg_funil_solta_campos
  BEFORE DELETE ON public.funnels
  FOR EACH ROW EXECUTE FUNCTION public.fn_funil_solta_campos();

REVOKE EXECUTE ON FUNCTION public.fn_historico_destino_obrigatorio(), public.fn_funil_solta_campos()
  FROM PUBLIC, anon, authenticated;

-- ── 2. Criação de campanha numa transação só ─────────────────────────────────
-- SECURITY INVOKER: o RLS de wa_campaigns, wa_campaign_recipients, leads e
-- wa_message_templates decide o que quem chama pode criar. search_path 'public':
-- as policies dessas tabelas citam profiles sem schema.
CREATE OR REPLACE FUNCTION public.criar_campanha(
  p_unit uuid,
  p_nome text,
  p_template uuid,
  p_agendada_para timestamptz,
  p_limite_diario integer,
  p_destinatarios jsonb
)
 RETURNS public.wa_campaigns
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  modelo record;
  total integer;
  custo numeric;
  sem_telefone integer;
  fora_da_unidade integer;
  campanha public.wa_campaigns;
BEGIN
  IF btrim(coalesce(p_nome, '')) = '' THEN
    RAISE EXCEPTION 'Informe o nome da campanha' USING ERRCODE = '22023';
  END IF;
  IF p_limite_diario IS NULL OR p_limite_diario < 1 THEN
    RAISE EXCEPTION 'Informe um limite diário de pelo menos 1 envio' USING ERRCODE = '22023';
  END IF;
  IF p_agendada_para IS NOT NULL AND p_agendada_para <= now() THEN
    RAISE EXCEPTION 'Escolha uma data de agendamento no futuro' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(p_destinatarios) IS DISTINCT FROM 'array' OR jsonb_array_length(p_destinatarios) = 0 THEN
    RAISE EXCEPTION 'Nenhum destinatário válido' USING ERRCODE = '22023';
  END IF;

  SELECT t.id, t.name, t.category INTO modelo
    FROM public.wa_message_templates t
   WHERE t.id = p_template AND t.unit_id = p_unit;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Template não encontrado nesta unidade' USING ERRCODE = '22023';
  END IF;

  SELECT count(*), coalesce(sum(coalesce(d.cost_usd, 0)), 0),
         count(*) FILTER (WHERE coalesce(btrim(d.phone), '') = ''),
         count(*) FILTER (WHERE d.lead_id IS NOT NULL
                            AND NOT EXISTS (SELECT 1 FROM public.leads l WHERE l.id = d.lead_id AND l.unit_id = p_unit))
    INTO total, custo, sem_telefone, fora_da_unidade
    FROM jsonb_to_recordset(p_destinatarios) AS d(lead_id uuid, phone text, cost_usd numeric);
  IF sem_telefone > 0 THEN
    RAISE EXCEPTION '% destinatário(s) sem telefone', sem_telefone USING ERRCODE = '22023';
  END IF;
  -- Sob o RLS, lead de outra unidade nem aparece em public.leads
  IF fora_da_unidade > 0 THEN
    RAISE EXCEPTION '% destinatário(s) com lead fora desta unidade', fora_da_unidade USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.wa_campaigns (unit_id, nome, template_id, template_nome, template_category, status,
                                   scheduled_at, daily_limit, total_recipients, estimated_cost_usd, created_by)
  VALUES (p_unit, btrim(p_nome), modelo.id, modelo.name,
          CASE WHEN modelo.category = 'utility' THEN 'utility' ELSE 'marketing' END,
          CASE WHEN p_agendada_para IS NULL THEN 'rascunho' ELSE 'agendada' END,
          p_agendada_para, p_limite_diario, total, custo, auth.uid())
  RETURNING * INTO campanha;

  INSERT INTO public.wa_campaign_recipients (campaign_id, lead_id, phone, nome, has_optin, in_csw, cost_usd)
  SELECT campanha.id, d.lead_id, btrim(d.phone), nullif(btrim(d.nome), ''),
         coalesce(d.has_optin, false), coalesce(d.in_csw, false), coalesce(d.cost_usd, 0)
    FROM jsonb_to_recordset(p_destinatarios)
      AS d(lead_id uuid, phone text, nome text, has_optin boolean, in_csw boolean, cost_usd numeric);

  RETURN campanha;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.criar_campanha(uuid, text, uuid, timestamptz, integer, jsonb) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.criar_campanha(uuid, text, uuid, timestamptz, integer, jsonb) TO authenticated, service_role;

-- ── 3. Meta da unidade sem duplicata ─────────────────────────────────────────
DO $$
DECLARE
  repetidas integer;
  antiga text;
BEGIN
  SELECT count(*) INTO repetidas
    FROM (SELECT 1 FROM public.sales_goals GROUP BY unit_id, user_id, month HAVING count(*) > 1) g;
  IF repetidas > 0 THEN
    RAISE EXCEPTION '135: % grupo(s) de metas repetidas (mesma unidade, usuário e mês) em sales_goals: apague as repetidas antes de aplicar', repetidas;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_index i ON i.indexrelid = c.conindid
              WHERE c.conrelid = 'public.sales_goals'::regclass
                AND c.conname = 'sales_goals_unit_id_user_id_month_key' AND i.indnullsnotdistinct) THEN
    RETURN;
  END IF;

  FOR antiga IN
    SELECT c.conname FROM pg_constraint c
     WHERE c.conrelid = 'public.sales_goals'::regclass AND c.contype = 'u'
       AND (SELECT array_agg(a.attname::text ORDER BY a.attname) FROM pg_attribute a
             WHERE a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)) = ARRAY['month', 'unit_id', 'user_id']
  LOOP
    EXECUTE format('ALTER TABLE public.sales_goals DROP CONSTRAINT %I', antiga);
  END LOOP;
  ALTER TABLE public.sales_goals ADD CONSTRAINT sales_goals_unit_id_user_id_month_key
    UNIQUE NULLS NOT DISTINCT (unit_id, user_id, month);
END $$;

-- ── 4. Conferência ───────────────────────────────────────────────────────────
DO $$
DECLARE
  errado text;
BEGIN
  SELECT string_agg(format('%s.%s', e.tabela, e.nome), ', ') INTO errado
    FROM (VALUES ('public.leads'::regclass, 'leads_stage_id_fkey', 'r'),
                 ('public.leads', 'leads_funnel_id_fkey', 'r'),
                 ('public.lead_stage_history', 'lead_stage_history_para_stage_id_fkey', 'n'),
                 ('public.campos_lead', 'campos_lead_funnel_id_fkey', 'r'),
                 ('public.wa_timed_automations', 'wa_timed_automations_filter_funnel_id_fkey', 'r'),
                 ('public.wa_timed_automations', 'wa_timed_automations_filter_stage_id_fkey', 'r')) AS e(tabela, nome, acao)
    LEFT JOIN pg_constraint c ON c.conrelid = e.tabela AND c.conname = e.nome AND c.contype = 'f'
   WHERE c.oid IS NULL OR c.confdeltype <> e.acao;
  IF errado IS NOT NULL THEN
    RAISE EXCEPTION '135: FK ausente ou sem o ON DELETE esperado: %', errado;
  END IF;
  -- Cascata só das etapas e dos motivos do próprio funil
  SELECT string_agg(format('%s.%s', c.conrelid::regclass, c.conname), ', ') INTO errado
    FROM pg_constraint c
   WHERE c.contype = 'f' AND c.confrelid IN ('public.funnels'::regclass, 'public.funnel_stages'::regclass)
     AND c.confdeltype = 'c'
     AND c.conrelid NOT IN ('public.funnel_stages'::regclass, 'public.motivos_perda'::regclass);
  IF errado IS NOT NULL THEN
    RAISE EXCEPTION '135: sobrou FK em cascata para funis/etapas: %', errado;
  END IF;
  IF NOT (SELECT i.indnullsnotdistinct FROM pg_constraint c JOIN pg_index i ON i.indexrelid = c.conindid
           WHERE c.conrelid = 'public.sales_goals'::regclass AND c.conname = 'sales_goals_unit_id_user_id_month_key') THEN
    RAISE EXCEPTION '135: sales_goals sem UNIQUE NULLS NOT DISTINCT';
  END IF;
  IF has_function_privilege('anon', 'public.criar_campanha(uuid,text,uuid,timestamptz,integer,jsonb)', 'EXECUTE')
     OR (SELECT prosecdef FROM pg_proc WHERE oid = 'public.criar_campanha(uuid,text,uuid,timestamptz,integer,jsonb)'::regprocedure) THEN
    RAISE EXCEPTION '135: criar_campanha executável por anon ou SECURITY DEFINER';
  END IF;
  IF has_function_privilege('authenticated', 'public.fn_funil_solta_campos()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.fn_historico_destino_obrigatorio()', 'EXECUTE') THEN
    RAISE EXCEPTION '135: authenticated executa funções de trigger da 135';
  END IF;
END $$;
