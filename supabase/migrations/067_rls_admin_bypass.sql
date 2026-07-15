-- ============================================================================
-- Migration 067: Bypass de RLS para admin/gestor_vacivitta
--
-- Problema: todas as policies usavam user_units para filtrar por unit_id,
-- impedindo que admins (perfil admin/gestor_vacivitta) vissem dados de
-- unidades às quais não estão explicitamente vinculados.
--
-- Solução: função is_global_admin() SECURITY DEFINER que verifica o perfil
-- sem sofrer recursão de RLS, e OR is_global_admin() em todas as policies.
-- ============================================================================

-- 1. Função helper (SECURITY DEFINER para evitar recursão com RLS de profiles)
CREATE OR REPLACE FUNCTION is_global_admin()
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles
    WHERE id = auth.uid()
      AND perfil IN ('admin', 'gestor_vacivitta')
  );
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- ============================================================================
-- 2. Policies com FOR ALL (unit_id direto)
-- ============================================================================

-- funnels
DROP POLICY IF EXISTS "unit_members_funnels" ON funnels;
CREATE POLICY "unit_members_funnels" ON funnels FOR ALL
  USING (is_global_admin() OR unit_id IN (SELECT unit_id FROM user_units WHERE user_id = auth.uid()))
  WITH CHECK (is_global_admin() OR unit_id IN (SELECT unit_id FROM user_units WHERE user_id = auth.uid()));

-- funnel_stages
DROP POLICY IF EXISTS "unit_members_funnel_stages" ON funnel_stages;
CREATE POLICY "unit_members_funnel_stages" ON funnel_stages FOR ALL
  USING (is_global_admin() OR unit_id IN (SELECT unit_id FROM user_units WHERE user_id = auth.uid()))
  WITH CHECK (is_global_admin() OR unit_id IN (SELECT unit_id FROM user_units WHERE user_id = auth.uid()));

-- lead_contacts
DROP POLICY IF EXISTS "unit_members_lead_contacts" ON lead_contacts;
CREATE POLICY "unit_members_lead_contacts" ON lead_contacts FOR ALL
  USING (is_global_admin() OR unit_id IN (SELECT unit_id FROM user_units WHERE user_id = auth.uid()))
  WITH CHECK (is_global_admin() OR unit_id IN (SELECT unit_id FROM user_units WHERE user_id = auth.uid()));

-- lead_notes
DROP POLICY IF EXISTS "unit_members_lead_notes" ON lead_notes;
CREATE POLICY "unit_members_lead_notes" ON lead_notes FOR ALL
  USING (is_global_admin() OR unit_id IN (SELECT unit_id FROM user_units WHERE user_id = auth.uid()))
  WITH CHECK (is_global_admin() OR unit_id IN (SELECT unit_id FROM user_units WHERE user_id = auth.uid()));

-- lead_responsible_history
DROP POLICY IF EXISTS "unit_members_lead_responsible_history" ON lead_responsible_history;
CREATE POLICY "unit_members_lead_responsible_history" ON lead_responsible_history FOR ALL
  USING (is_global_admin() OR unit_id IN (SELECT unit_id FROM user_units WHERE user_id = auth.uid()))
  WITH CHECK (is_global_admin() OR unit_id IN (SELECT unit_id FROM user_units WHERE user_id = auth.uid()));

-- lead_tasks
DROP POLICY IF EXISTS "unit_members_lead_tasks" ON lead_tasks;
CREATE POLICY "unit_members_lead_tasks" ON lead_tasks FOR ALL
  USING (is_global_admin() OR unit_id IN (SELECT unit_id FROM user_units WHERE user_id = auth.uid()))
  WITH CHECK (is_global_admin() OR unit_id IN (SELECT unit_id FROM user_units WHERE user_id = auth.uid()));

-- products
DROP POLICY IF EXISTS "unit_members_products" ON products;
CREATE POLICY "unit_members_products" ON products FOR ALL
  USING (is_global_admin() OR unit_id IN (SELECT unit_id FROM user_units WHERE user_id = auth.uid()))
  WITH CHECK (is_global_admin() OR unit_id IN (SELECT unit_id FROM user_units WHERE user_id = auth.uid()));

-- product_prices
DROP POLICY IF EXISTS "unit_members_product_prices" ON product_prices;
CREATE POLICY "unit_members_product_prices" ON product_prices FOR ALL
  USING (is_global_admin() OR unit_id IN (SELECT unit_id FROM user_units WHERE user_id = auth.uid()))
  WITH CHECK (is_global_admin() OR unit_id IN (SELECT unit_id FROM user_units WHERE user_id = auth.uid()));

-- quotes
DROP POLICY IF EXISTS "unit_members_quotes" ON quotes;
CREATE POLICY "unit_members_quotes" ON quotes FOR ALL
  USING (is_global_admin() OR unit_id IN (SELECT unit_id FROM user_units WHERE user_id = auth.uid()))
  WITH CHECK (is_global_admin() OR unit_id IN (SELECT unit_id FROM user_units WHERE user_id = auth.uid()));

-- quote_items
DROP POLICY IF EXISTS "unit_members_quote_items" ON quote_items;
CREATE POLICY "unit_members_quote_items" ON quote_items FOR ALL
  USING (is_global_admin() OR unit_id IN (SELECT unit_id FROM user_units WHERE user_id = auth.uid()))
  WITH CHECK (is_global_admin() OR unit_id IN (SELECT unit_id FROM user_units WHERE user_id = auth.uid()));

-- quote_automations
DROP POLICY IF EXISTS "unit_members_quote_automations" ON quote_automations;
CREATE POLICY "unit_members_quote_automations" ON quote_automations FOR ALL
  USING (is_global_admin() OR unit_id IN (SELECT unit_id FROM user_units WHERE user_id = auth.uid()))
  WITH CHECK (is_global_admin() OR unit_id IN (SELECT unit_id FROM user_units WHERE user_id = auth.uid()));

-- quote_templates
DROP POLICY IF EXISTS "unit_members_quote_templates" ON quote_templates;
CREATE POLICY "unit_members_quote_templates" ON quote_templates FOR ALL
  USING (is_global_admin() OR unit_id IN (SELECT unit_id FROM user_units WHERE user_id = auth.uid()))
  WITH CHECK (is_global_admin() OR unit_id IN (SELECT unit_id FROM user_units WHERE user_id = auth.uid()));

-- wa_billing_conversations
DROP POLICY IF EXISTS "unit_members_wa_billing" ON wa_billing_conversations;
CREATE POLICY "unit_members_wa_billing" ON wa_billing_conversations FOR ALL
  USING (is_global_admin() OR unit_id IN (SELECT unit_id FROM user_units WHERE user_id = auth.uid()))
  WITH CHECK (is_global_admin() OR unit_id IN (SELECT unit_id FROM user_units WHERE user_id = auth.uid()));

-- ============================================================================
-- 3. Policies com comandos separados (SELECT/UPDATE/DELETE/INSERT)
-- ============================================================================

-- leads
DROP POLICY IF EXISTS "unit_members_leads_select" ON leads;
CREATE POLICY "unit_members_leads_select" ON leads FOR SELECT
  USING (is_global_admin() OR unit_id IN (SELECT unit_id FROM user_units WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "unit_members_leads_update" ON leads;
CREATE POLICY "unit_members_leads_update" ON leads FOR UPDATE
  USING (is_global_admin() OR unit_id IN (SELECT unit_id FROM user_units WHERE user_id = auth.uid()))
  WITH CHECK (is_global_admin() OR unit_id IN (SELECT unit_id FROM user_units WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "unit_members_leads_delete" ON leads;
CREATE POLICY "unit_members_leads_delete" ON leads FOR DELETE
  USING (is_global_admin() OR unit_id IN (SELECT unit_id FROM user_units WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "unit_members_leads_insert" ON leads;
CREATE POLICY "unit_members_leads_insert" ON leads FOR INSERT
  WITH CHECK (is_global_admin() OR unit_id IN (SELECT unit_id FROM user_units WHERE user_id = auth.uid()));

-- units
DROP POLICY IF EXISTS "unit_members_units" ON units;
CREATE POLICY "unit_members_units" ON units FOR SELECT
  USING (is_global_admin() OR id IN (SELECT unit_id FROM user_units WHERE user_id = auth.uid()));

-- notifications
DROP POLICY IF EXISTS "unit_members_notifications_select" ON notifications;
CREATE POLICY "unit_members_notifications_select" ON notifications FOR SELECT
  USING (is_global_admin() OR unit_id IN (SELECT unit_id FROM user_units WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "unit_members_notifications_update" ON notifications;
CREATE POLICY "unit_members_notifications_update" ON notifications FOR UPDATE
  USING (is_global_admin() OR unit_id IN (SELECT unit_id FROM user_units WHERE user_id = auth.uid()))
  WITH CHECK (is_global_admin() OR unit_id IN (SELECT unit_id FROM user_units WHERE user_id = auth.uid()));

-- wa_conversations
DROP POLICY IF EXISTS "wa_conv_select" ON wa_conversations;
DROP POLICY IF EXISTS "wa_conv_update" ON wa_conversations;
DROP POLICY IF EXISTS "unit_members_wa_conversations_select" ON wa_conversations;
CREATE POLICY "unit_members_wa_conversations_select" ON wa_conversations FOR SELECT
  USING (is_global_admin() OR unit_id IN (SELECT unit_id FROM user_units WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "unit_members_wa_conversations_update" ON wa_conversations;
CREATE POLICY "unit_members_wa_conversations_update" ON wa_conversations FOR UPDATE
  USING (is_global_admin() OR unit_id IN (SELECT unit_id FROM user_units WHERE user_id = auth.uid()))
  WITH CHECK (is_global_admin() OR unit_id IN (SELECT unit_id FROM user_units WHERE user_id = auth.uid()));

-- wa_messages
DROP POLICY IF EXISTS "wa_msg_select" ON wa_messages;
DROP POLICY IF EXISTS "wa_msg_update" ON wa_messages;
DROP POLICY IF EXISTS "unit_members_wa_messages_select" ON wa_messages;
CREATE POLICY "unit_members_wa_messages_select" ON wa_messages FOR SELECT
  USING (is_global_admin() OR unit_id IN (SELECT unit_id FROM user_units WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "unit_members_wa_messages_update" ON wa_messages;
CREATE POLICY "unit_members_wa_messages_update" ON wa_messages FOR UPDATE
  USING (is_global_admin() OR unit_id IN (SELECT unit_id FROM user_units WHERE user_id = auth.uid()))
  WITH CHECK (is_global_admin() OR unit_id IN (SELECT unit_id FROM user_units WHERE user_id = auth.uid()));

-- ============================================================================
-- 4. Policies com subqueries via leads/units
-- ============================================================================

-- lead_negotiation
DROP POLICY IF EXISTS "unit_members_lead_negotiation" ON lead_negotiation;
CREATE POLICY "unit_members_lead_negotiation" ON lead_negotiation FOR ALL
  USING (is_global_admin() OR EXISTS (
    SELECT 1 FROM leads l
    WHERE l.id = lead_negotiation.lead_id
      AND l.unit_id IN (SELECT unit_id FROM user_units WHERE user_id = auth.uid())
  ))
  WITH CHECK (is_global_admin() OR EXISTS (
    SELECT 1 FROM leads l
    WHERE l.id = lead_negotiation.lead_id
      AND l.unit_id IN (SELECT unit_id FROM user_units WHERE user_id = auth.uid())
  ));

-- lead_stage_history
DROP POLICY IF EXISTS "unit_members_lead_stage_history" ON lead_stage_history;
CREATE POLICY "unit_members_lead_stage_history" ON lead_stage_history FOR ALL
  USING (is_global_admin() OR EXISTS (
    SELECT 1 FROM leads l
    WHERE l.id = lead_stage_history.lead_id
      AND l.unit_id IN (SELECT unit_id FROM user_units WHERE user_id = auth.uid())
  ))
  WITH CHECK (is_global_admin() OR EXISTS (
    SELECT 1 FROM leads l
    WHERE l.id = lead_stage_history.lead_id
      AND l.unit_id IN (SELECT unit_id FROM user_units WHERE user_id = auth.uid())
  ));

-- tenants
DROP POLICY IF EXISTS "unit_members_tenants" ON tenants;
CREATE POLICY "unit_members_tenants" ON tenants FOR SELECT
  USING (is_global_admin() OR id IN (
    SELECT u.tenant_id FROM units u
    JOIN user_units uu ON uu.unit_id = u.id
    WHERE uu.user_id = auth.uid()
  ));

-- wa_templates (tabela wa_templates)
DROP POLICY IF EXISTS "wa_tpl_all" ON wa_templates;
DROP POLICY IF EXISTS "wa_tpl_select" ON wa_templates;
DROP POLICY IF EXISTS "unit_members_wa_templates_all" ON wa_templates;
CREATE POLICY "unit_members_wa_templates_all" ON wa_templates FOR ALL
  USING (is_global_admin() OR unit_id IN (SELECT unit_id FROM user_units WHERE user_id = auth.uid()))
  WITH CHECK (is_global_admin() OR unit_id IN (SELECT unit_id FROM user_units WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "unit_members_wa_templates_sel" ON wa_templates;
CREATE POLICY "unit_members_wa_templates_sel" ON wa_templates FOR SELECT
  USING (is_global_admin() OR unit_id IN (SELECT unit_id FROM user_units WHERE user_id = auth.uid()));

-- wa_message_templates (se existir separadamente)
DROP POLICY IF EXISTS "unit_members_wa_templates" ON wa_message_templates;
DROP POLICY IF EXISTS "unit_members_wa_templates_select" ON wa_message_templates;
