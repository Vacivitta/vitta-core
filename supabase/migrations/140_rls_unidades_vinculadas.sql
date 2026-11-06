-- 140_rls_unidades_vinculadas.sql
-- As regras de acesso que olhavam a unidade ativa (profiles.unit_id) passam a
-- olhar as unidades vinculadas (user_units), como o resto do banco.
--
-- Por quê: 13 tabelas liberavam só a unidade gravada em profiles.unit_id: quem
-- atende Itu e Salto, com Itu ativa, não via modelos, filas, respostas rápidas
-- nem campanhas de Salto, e o admin da marca só via os da unidade em que estava
-- (as outras tabelas já usam user_units e is_global_admin, 067). É o que impede
-- a caixa de entrada de todas as unidades (entrega 4) de usar os modelos e as
-- filas da unidade da conversa, e a unidade ativa de sair do perfil (por aba).
--
-- O que faz: recria a regra de cada tabela com
--   is_global_admin() OR <unidade> IN (unidades do usuário em user_units)
-- para USING e WITH CHECK, só para authenticated:
--   internal_channels (unit_a_id ou unit_b_id), internal_channel_messages (pelo
--   canal), sales_goals, unit_payment_fees, wa_automations, wa_campaigns,
--   wa_campaign_recipients (pela campanha), wa_message_costs (só leitura),
--   wa_message_templates, wa_queues, wa_queue_agents (pela fila),
--   wa_quick_replies, wa_template_folders.
-- No fim, falha se sobrar regra no public que cite profiles.unit_id.
--
-- Ordem com o deploy: **app desta versão primeiro, 140 depois**. O app desta
-- versão filtra pela unidade ativa explicitamente as telas que contavam com a
-- regra para isso (modelos e respostas rápidas no Atendimento e no LeadModal,
-- lista e Realtime de campanhas). Com o app de antes, a 140 faria essas telas
-- misturarem as unidades do usuário.
--
-- Aplicar em produção é [H]: o Infra aplica, com aprovação e backup do dia, como
-- supabase_admin, com --single-transaction; depois registra a versão '140' e roda
-- notify pgrst, 'reload schema'. Sem BEGIN/COMMIT. Idempotente. Não cria função.
--
-- Reversão: recriar cada regra com
--   unit_id IN (SELECT profiles.unit_id FROM profiles WHERE profiles.id = (SELECT auth.uid()))
-- e os nomes de antes (ver 092_drift_producao.sql).

SET LOCAL lock_timeout = '5s';

DO $$
BEGIN
  IF current_setting('lock_timeout') <> '5s' THEN
    RAISE EXCEPTION '140: rode com --single-transaction (lock_timeout atual: %)', current_setting('lock_timeout');
  END IF;
  IF current_user <> 'supabase_admin' THEN
    RAISE EXCEPTION '140: rodar como supabase_admin (atual: %)', current_user;
  END IF;
END $$;

-- ── Tabelas com unit_id ──────────────────────────────────────────────────────
DO $$
DECLARE
  t record;
  regra constant text :=
    '(SELECT is_global_admin()) OR unit_id IN (SELECT uu.unit_id FROM public.user_units uu WHERE uu.user_id = (SELECT auth.uid()))';
BEGIN
  FOR t IN SELECT * FROM (VALUES
      ('sales_goals',          'sales_goals_unit',                     'ALL'),
      ('unit_payment_fees',    'unit_payment_fees_unit',               'ALL'),
      ('wa_automations',       'unit_members_wa_automations',          'ALL'),
      ('wa_campaigns',         'unit members can manage campaigns',    'ALL'),
      ('wa_message_costs',     'unit members can view message costs',  'SELECT'),
      ('wa_message_templates', 'unit members',                         'ALL'),
      ('wa_queues',            'unit_members_queues',                  'ALL'),
      ('wa_quick_replies',     'unit members',                         'ALL'),
      ('wa_template_folders',  'wa_template_folders_unit',             'ALL')
    ) AS v (tabela, antiga, comando)
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t.antiga, t.tabela);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t.tabela || '_unidades', t.tabela);
    IF t.comando = 'SELECT' THEN
      EXECUTE format('CREATE POLICY %I ON public.%I AS PERMISSIVE FOR SELECT TO authenticated USING (%s)',
                     t.tabela || '_unidades', t.tabela, regra);
    ELSE
      EXECUTE format('CREATE POLICY %I ON public.%I AS PERMISSIVE FOR ALL TO authenticated USING (%s) WITH CHECK (%s)',
                     t.tabela || '_unidades', t.tabela, regra, regra);
    END IF;
  END LOOP;
END $$;

-- ── Tabelas ligadas por outra tabela ─────────────────────────────────────────
DROP POLICY IF EXISTS "internal_channels_access" ON public.internal_channels;
DROP POLICY IF EXISTS "internal_channels_unidades" ON public.internal_channels;
CREATE POLICY "internal_channels_unidades" ON public.internal_channels AS PERMISSIVE FOR ALL TO authenticated
  USING (
    (SELECT is_global_admin())
    OR unit_a_id IN (SELECT uu.unit_id FROM public.user_units uu WHERE uu.user_id = (SELECT auth.uid()))
    OR unit_b_id IN (SELECT uu.unit_id FROM public.user_units uu WHERE uu.user_id = (SELECT auth.uid()))
  )
  WITH CHECK (
    (SELECT is_global_admin())
    OR unit_a_id IN (SELECT uu.unit_id FROM public.user_units uu WHERE uu.user_id = (SELECT auth.uid()))
    OR unit_b_id IN (SELECT uu.unit_id FROM public.user_units uu WHERE uu.user_id = (SELECT auth.uid()))
  );

-- As três de baixo filtram pela tabela-mãe, que já está sob o RLS novo
DROP POLICY IF EXISTS "internal_channel_messages_access" ON public.internal_channel_messages;
DROP POLICY IF EXISTS "internal_channel_messages_unidades" ON public.internal_channel_messages;
CREATE POLICY "internal_channel_messages_unidades" ON public.internal_channel_messages AS PERMISSIVE FOR ALL TO authenticated
  USING (channel_id IN (SELECT c.id FROM public.internal_channels c))
  WITH CHECK (channel_id IN (SELECT c.id FROM public.internal_channels c));

DROP POLICY IF EXISTS "unit members can manage campaign recipients" ON public.wa_campaign_recipients;
DROP POLICY IF EXISTS "wa_campaign_recipients_unidades" ON public.wa_campaign_recipients;
CREATE POLICY "wa_campaign_recipients_unidades" ON public.wa_campaign_recipients AS PERMISSIVE FOR ALL TO authenticated
  USING (campaign_id IN (SELECT w.id FROM public.wa_campaigns w))
  WITH CHECK (campaign_id IN (SELECT w.id FROM public.wa_campaigns w));

DROP POLICY IF EXISTS "unit members can manage queue agents" ON public.wa_queue_agents;
DROP POLICY IF EXISTS "wa_queue_agents_unidades" ON public.wa_queue_agents;
CREATE POLICY "wa_queue_agents_unidades" ON public.wa_queue_agents AS PERMISSIVE FOR ALL TO authenticated
  USING (queue_id IN (SELECT q.id FROM public.wa_queues q))
  WITH CHECK (queue_id IN (SELECT q.id FROM public.wa_queues q));

-- ── Conferência ──────────────────────────────────────────────────────────────
DO $$
DECLARE restantes text;
BEGIN
  SELECT string_agg(tablename || '.' || policyname, ', ') INTO restantes
    FROM pg_policies
   WHERE schemaname = 'public'
     AND (qual ~ 'profiles\.unit_id' OR with_check ~ 'profiles\.unit_id');
  IF restantes IS NOT NULL THEN
    RAISE EXCEPTION '140: regras que ainda usam a unidade ativa (profiles.unit_id): %', restantes;
  END IF;
END $$;
