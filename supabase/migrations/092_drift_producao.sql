-- 092_drift_producao.sql
-- Deriva: traz para o repositório o estado REAL da produção (lido pelo Infra em
-- 29/10/2026, somente leitura, arquivo F0-B fora do repositório) de objetos que
-- foram criados ou alterados fora das migrações:
--   - funções is_admin() e rls_auto_enable() (esta, inerte: nenhum event trigger a usa);
--   - todas as policies das tabelas wa_*, de units e de funnel_stages, com o texto
--     exato de pg_policies (inclui wa_conv_insert e wa_msg_insert, que não estavam
--     no repositório, e os nomes que divergiam);
--   - remoção da coluna transitória funnel_stages.alerta_dias, que só existe num
--     banco montado do zero (criada pela 037b para a 038/059 rodarem) e não existe
--     em produção.
--
-- Em produção: é um no-op de comportamento (recria exatamente as mesmas policies
-- e funções). O recomendado é só REGISTRAR a versão, sem reaplicar. Se for
-- reaplicada, rodar como supabase_admin (dono das funções), com
--   psql --single-transaction -v ON_ERROR_STOP=1
-- Sem BEGIN/COMMIT neste arquivo. Idempotente.
--
-- NÃO coberto (corpo não colhido): a função handle_wa_templates_updated_at() e o
-- trigger de updated_at de wa_templates, e as constraints/índices de wa_templates.
-- Ver 066b.

SET LOCAL lock_timeout = '5s';

-- Guarda: exige transação única. Fora de uma transação o SET LOCAL acima não vale
-- (lock_timeout continua no padrão), e um erro depois do laço de DROP abaixo
-- deixaria as tabelas sem policy nenhuma (RLS ligado = tudo negado = atendimento
-- parado). Rodar com psql --single-transaction.
DO $$
BEGIN
  IF current_setting('lock_timeout') <> '5s' THEN
    RAISE EXCEPTION '092: rode com --single-transaction (lock_timeout atual: %)', current_setting('lock_timeout');
  END IF;
END $$;

-- ── 1. Funções ───────────────────────────────────────────────────────────────
-- Texto de pg_get_functiondef em produção.
CREATE OR REPLACE FUNCTION public.is_admin()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM profiles
    WHERE id = auth.uid() AND perfil = 'admin'
  );
$function$;

-- Inerte: função de event trigger sem nenhum event trigger que a chame (produção
-- tem só os 8 event triggers do Supabase). Registrada para o repositório bater com
-- a produção; NÃO criar event trigger para ela.
CREATE OR REPLACE FUNCTION public.rls_auto_enable()
 RETURNS event_trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
     IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        EXECUTE format('alter table if exists %s enable row level security', cmd.object_identity);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
     ELSE
        RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     END IF;
  END LOOP;
END;
$function$;

-- Mesmos privilégios da 090 (que só trata estas duas se já existirem)
REVOKE EXECUTE ON FUNCTION public.is_admin()        FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.is_admin()        TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.rls_auto_enable() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.rls_auto_enable() TO service_role;

-- ── 2. Policies: remove todas as atuais destas tabelas e recria as de produção ─
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT tablename, policyname FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename = ANY (ARRAY['funnel_stages', 'units', 'wa_automations', 'wa_billing_conversations', 'wa_campaign_recipients', 'wa_campaigns', 'wa_config', 'wa_conversation_tags', 'wa_conversations', 'wa_internal_notes', 'wa_message_costs', 'wa_message_templates', 'wa_messages', 'wa_queue_agents', 'wa_queues', 'wa_quick_replies', 'wa_scheduled_messages', 'wa_tags', 'wa_template_folders', 'wa_templates', 'wa_timed_automation_log', 'wa_timed_automations'])
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.policyname, r.tablename);
  END LOOP;
END $$;


-- funnel_stages
CREATE POLICY "unit_members_funnel_stages" ON public.funnel_stages AS PERMISSIVE FOR ALL TO public
  USING ((( SELECT is_global_admin() AS is_global_admin) OR (unit_id IN ( SELECT user_units.unit_id
   FROM user_units
  WHERE (user_units.user_id = ( SELECT auth.uid() AS uid))))))
  WITH CHECK ((( SELECT is_global_admin() AS is_global_admin) OR (unit_id IN ( SELECT user_units.unit_id
   FROM user_units
  WHERE (user_units.user_id = ( SELECT auth.uid() AS uid))))));

-- units
CREATE POLICY "admin_units_delete" ON public.units AS PERMISSIVE FOR DELETE TO public
  USING (( SELECT is_admin() AS is_admin));
CREATE POLICY "admin_units_insert" ON public.units AS PERMISSIVE FOR INSERT TO public
  WITH CHECK (( SELECT is_admin() AS is_admin));
CREATE POLICY "admin_units_update" ON public.units AS PERMISSIVE FOR UPDATE TO public
  USING (( SELECT is_admin() AS is_admin));
CREATE POLICY "unit_members_units" ON public.units AS PERMISSIVE FOR SELECT TO public
  USING ((( SELECT is_global_admin() AS is_global_admin) OR (id IN ( SELECT user_units.unit_id
   FROM user_units
  WHERE (user_units.user_id = ( SELECT auth.uid() AS uid))))));

-- wa_automations
CREATE POLICY "unit_members_wa_automations" ON public.wa_automations AS PERMISSIVE FOR ALL TO public
  USING ((unit_id IN ( SELECT profiles.unit_id
   FROM profiles
  WHERE (profiles.id = ( SELECT auth.uid() AS uid)))));

-- wa_billing_conversations
CREATE POLICY "unit_members_wa_billing" ON public.wa_billing_conversations AS PERMISSIVE FOR ALL TO public
  USING ((( SELECT is_global_admin() AS is_global_admin) OR (unit_id IN ( SELECT user_units.unit_id
   FROM user_units
  WHERE (user_units.user_id = ( SELECT auth.uid() AS uid))))))
  WITH CHECK ((( SELECT is_global_admin() AS is_global_admin) OR (unit_id IN ( SELECT user_units.unit_id
   FROM user_units
  WHERE (user_units.user_id = ( SELECT auth.uid() AS uid))))));

-- wa_campaign_recipients
CREATE POLICY "unit members can manage campaign recipients" ON public.wa_campaign_recipients AS PERMISSIVE FOR ALL TO public
  USING ((campaign_id IN ( SELECT wa_campaigns.id
   FROM wa_campaigns
  WHERE (wa_campaigns.unit_id IN ( SELECT profiles.unit_id
           FROM profiles
          WHERE (profiles.id = ( SELECT auth.uid() AS uid)))))));

-- wa_campaigns
CREATE POLICY "unit members can manage campaigns" ON public.wa_campaigns AS PERMISSIVE FOR ALL TO public
  USING ((unit_id IN ( SELECT profiles.unit_id
   FROM profiles
  WHERE (profiles.id = ( SELECT auth.uid() AS uid)))));

-- wa_conversation_tags
CREATE POLICY "unit_members_wa_conversation_tags" ON public.wa_conversation_tags AS PERMISSIVE FOR ALL TO public
  USING ((( SELECT is_global_admin() AS is_global_admin) OR (tag_id IN ( SELECT t.id
   FROM wa_tags t
  WHERE (t.unit_id IN ( SELECT user_units.unit_id
           FROM user_units
          WHERE (user_units.user_id = ( SELECT auth.uid() AS uid))))))))
  WITH CHECK ((( SELECT is_global_admin() AS is_global_admin) OR (tag_id IN ( SELECT t.id
   FROM wa_tags t
  WHERE (t.unit_id IN ( SELECT user_units.unit_id
           FROM user_units
          WHERE (user_units.user_id = ( SELECT auth.uid() AS uid))))))));

-- wa_conversations
CREATE POLICY "unit_members_wa_conversations_select" ON public.wa_conversations AS PERMISSIVE FOR SELECT TO public
  USING ((( SELECT is_global_admin() AS is_global_admin) OR (unit_id IN ( SELECT user_units.unit_id
   FROM user_units
  WHERE (user_units.user_id = ( SELECT auth.uid() AS uid))))));
CREATE POLICY "unit_members_wa_conversations_update" ON public.wa_conversations AS PERMISSIVE FOR UPDATE TO public
  USING ((( SELECT is_global_admin() AS is_global_admin) OR (unit_id IN ( SELECT user_units.unit_id
   FROM user_units
  WHERE (user_units.user_id = ( SELECT auth.uid() AS uid))))))
  WITH CHECK ((( SELECT is_global_admin() AS is_global_admin) OR (unit_id IN ( SELECT user_units.unit_id
   FROM user_units
  WHERE (user_units.user_id = ( SELECT auth.uid() AS uid))))));
CREATE POLICY "wa_conv_insert" ON public.wa_conversations AS PERMISSIVE FOR INSERT TO public
  WITH CHECK ((unit_id IN ( SELECT user_units.unit_id
   FROM user_units
  WHERE (user_units.user_id = ( SELECT auth.uid() AS uid)))));

-- wa_internal_notes
CREATE POLICY "unit_members_notes" ON public.wa_internal_notes AS PERMISSIVE FOR ALL TO public
  USING ((( SELECT is_global_admin() AS is_global_admin) OR (unit_id IN ( SELECT user_units.unit_id
   FROM user_units
  WHERE (user_units.user_id = ( SELECT auth.uid() AS uid))))))
  WITH CHECK ((( SELECT is_global_admin() AS is_global_admin) OR (unit_id IN ( SELECT user_units.unit_id
   FROM user_units
  WHERE (user_units.user_id = ( SELECT auth.uid() AS uid))))));

-- wa_message_costs
CREATE POLICY "unit members can view message costs" ON public.wa_message_costs AS PERMISSIVE FOR SELECT TO public
  USING ((unit_id IN ( SELECT profiles.unit_id
   FROM profiles
  WHERE (profiles.id = ( SELECT auth.uid() AS uid)))));

-- wa_message_templates
CREATE POLICY "unit members" ON public.wa_message_templates AS PERMISSIVE FOR ALL TO public
  USING ((unit_id IN ( SELECT profiles.unit_id
   FROM profiles
  WHERE (profiles.id = ( SELECT auth.uid() AS uid)))));
CREATE POLICY "unit_members_wa_templates" ON public.wa_message_templates AS PERMISSIVE FOR ALL TO public
  USING ((( SELECT is_global_admin() AS is_global_admin) OR (unit_id IN ( SELECT user_units.unit_id
   FROM user_units
  WHERE (user_units.user_id = ( SELECT auth.uid() AS uid))))))
  WITH CHECK ((( SELECT is_global_admin() AS is_global_admin) OR (unit_id IN ( SELECT user_units.unit_id
   FROM user_units
  WHERE (user_units.user_id = ( SELECT auth.uid() AS uid))))));
CREATE POLICY "unit_members_wa_templates_select" ON public.wa_message_templates AS PERMISSIVE FOR SELECT TO public
  USING ((( SELECT is_global_admin() AS is_global_admin) OR (unit_id IN ( SELECT user_units.unit_id
   FROM user_units
  WHERE (user_units.user_id = ( SELECT auth.uid() AS uid))))));

-- wa_messages
CREATE POLICY "unit_members_wa_messages_select" ON public.wa_messages AS PERMISSIVE FOR SELECT TO public
  USING ((( SELECT is_global_admin() AS is_global_admin) OR (unit_id IN ( SELECT user_units.unit_id
   FROM user_units
  WHERE (user_units.user_id = ( SELECT auth.uid() AS uid))))));
CREATE POLICY "unit_members_wa_messages_update" ON public.wa_messages AS PERMISSIVE FOR UPDATE TO public
  USING ((( SELECT is_global_admin() AS is_global_admin) OR (unit_id IN ( SELECT user_units.unit_id
   FROM user_units
  WHERE (user_units.user_id = ( SELECT auth.uid() AS uid))))))
  WITH CHECK ((( SELECT is_global_admin() AS is_global_admin) OR (unit_id IN ( SELECT user_units.unit_id
   FROM user_units
  WHERE (user_units.user_id = ( SELECT auth.uid() AS uid))))));
CREATE POLICY "wa_msg_insert" ON public.wa_messages AS PERMISSIVE FOR INSERT TO public
  WITH CHECK ((unit_id IN ( SELECT user_units.unit_id
   FROM user_units
  WHERE (user_units.user_id = ( SELECT auth.uid() AS uid)))));

-- wa_queue_agents
CREATE POLICY "unit members can manage queue agents" ON public.wa_queue_agents AS PERMISSIVE FOR ALL TO public
  USING ((queue_id IN ( SELECT wa_queues.id
   FROM wa_queues
  WHERE (wa_queues.unit_id IN ( SELECT profiles.unit_id
           FROM profiles
          WHERE (profiles.id = ( SELECT auth.uid() AS uid)))))));

-- wa_queues
CREATE POLICY "unit_members_queues" ON public.wa_queues AS PERMISSIVE FOR ALL TO public
  USING ((unit_id IN ( SELECT profiles.unit_id
   FROM profiles
  WHERE (profiles.id = ( SELECT auth.uid() AS uid)))));

-- wa_quick_replies
CREATE POLICY "unit members" ON public.wa_quick_replies AS PERMISSIVE FOR ALL TO public
  USING ((unit_id IN ( SELECT profiles.unit_id
   FROM profiles
  WHERE (profiles.id = ( SELECT auth.uid() AS uid)))));

-- wa_scheduled_messages
CREATE POLICY "unit members" ON public.wa_scheduled_messages AS PERMISSIVE FOR ALL TO public
  USING ((( SELECT is_global_admin() AS is_global_admin) OR (unit_id IN ( SELECT user_units.unit_id
   FROM user_units
  WHERE (user_units.user_id = ( SELECT auth.uid() AS uid))))))
  WITH CHECK ((( SELECT is_global_admin() AS is_global_admin) OR (unit_id IN ( SELECT user_units.unit_id
   FROM user_units
  WHERE (user_units.user_id = ( SELECT auth.uid() AS uid))))));

-- wa_tags
CREATE POLICY "unit_members_wa_tags" ON public.wa_tags AS PERMISSIVE FOR ALL TO public
  USING ((( SELECT is_global_admin() AS is_global_admin) OR (unit_id IN ( SELECT user_units.unit_id
   FROM user_units
  WHERE (user_units.user_id = ( SELECT auth.uid() AS uid))))))
  WITH CHECK ((( SELECT is_global_admin() AS is_global_admin) OR (unit_id IN ( SELECT user_units.unit_id
   FROM user_units
  WHERE (user_units.user_id = ( SELECT auth.uid() AS uid))))));

-- wa_template_folders
CREATE POLICY "wa_template_folders_unit" ON public.wa_template_folders AS PERMISSIVE FOR ALL TO public
  USING ((unit_id IN ( SELECT profiles.unit_id
   FROM profiles
  WHERE (profiles.id = ( SELECT auth.uid() AS uid)))));

-- wa_templates
CREATE POLICY "unit_members_wa_templates_all" ON public.wa_templates AS PERMISSIVE FOR ALL TO public
  USING ((( SELECT is_global_admin() AS is_global_admin) OR (unit_id IN ( SELECT user_units.unit_id
   FROM user_units
  WHERE (user_units.user_id = ( SELECT auth.uid() AS uid))))))
  WITH CHECK ((( SELECT is_global_admin() AS is_global_admin) OR (unit_id IN ( SELECT user_units.unit_id
   FROM user_units
  WHERE (user_units.user_id = ( SELECT auth.uid() AS uid))))));
CREATE POLICY "unit_members_wa_templates_sel" ON public.wa_templates AS PERMISSIVE FOR SELECT TO public
  USING ((( SELECT is_global_admin() AS is_global_admin) OR (unit_id IN ( SELECT user_units.unit_id
   FROM user_units
  WHERE (user_units.user_id = ( SELECT auth.uid() AS uid))))));

-- wa_timed_automation_log
CREATE POLICY "wa_timed_automation_log_unit" ON public.wa_timed_automation_log AS PERMISSIVE FOR ALL TO public
  USING (((automation_id IN ( SELECT wa_timed_automations.id
   FROM wa_timed_automations
  WHERE (wa_timed_automations.unit_id IN ( SELECT user_units.unit_id
           FROM user_units
          WHERE (user_units.user_id = ( SELECT auth.uid() AS uid)))))) OR (EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = ( SELECT auth.uid() AS uid)) AND (profiles.perfil = ANY (ARRAY['admin'::text, 'gestor_vacivitta'::text])))))));

-- wa_timed_automations
CREATE POLICY "wa_timed_automations_unit" ON public.wa_timed_automations AS PERMISSIVE FOR ALL TO public
  USING (((unit_id IN ( SELECT user_units.unit_id
   FROM user_units
  WHERE (user_units.user_id = ( SELECT auth.uid() AS uid)))) OR (EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = ( SELECT auth.uid() AS uid)) AND (profiles.perfil = ANY (ARRAY['admin'::text, 'gestor_vacivitta'::text])))))));

-- wa_config: sem policies (acesso só pelo service_role), como em produção.

-- ── 3. Coluna transitória de banco do zero ───────────────────────────────────
-- Em produção não existe (no-op). Num banco do zero foi criada pela 037b.
ALTER TABLE public.funnel_stages DROP COLUMN IF EXISTS alerta_dias;

-- ── Guarda ───────────────────────────────────────────────────────────────────
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM pg_policies
   WHERE schemaname = 'public'
     AND tablename = ANY (ARRAY['funnel_stages', 'units', 'wa_automations', 'wa_billing_conversations', 'wa_campaign_recipients', 'wa_campaigns', 'wa_config', 'wa_conversation_tags', 'wa_conversations', 'wa_internal_notes', 'wa_message_costs', 'wa_message_templates', 'wa_messages', 'wa_queue_agents', 'wa_queues', 'wa_quick_replies', 'wa_scheduled_messages', 'wa_tags', 'wa_template_folders', 'wa_templates', 'wa_timed_automation_log', 'wa_timed_automations']);
  IF n <> 31 THEN
    RAISE EXCEPTION '092: esperado 31 policies nas tabelas da deriva, achou %', n;
  END IF;
  IF has_function_privilege('anon', 'public.is_admin()', 'EXECUTE')
     OR has_function_privilege('anon', 'public.rls_auto_enable()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.rls_auto_enable()', 'EXECUTE') THEN
    RAISE EXCEPTION '092: is_admin/rls_auto_enable com EXECUTE indevido (rodou como supabase_admin?)';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_event_trigger WHERE evtfoid = 'public.rls_auto_enable()'::regprocedure) THEN
    RAISE EXCEPTION '092: rls_auto_enable não deve ter event trigger';
  END IF;
END $$;
