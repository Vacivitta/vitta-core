-- ============================================================================
-- Migration 062: RLS por unit_id em todas as tabelas CRM
--
-- Substitui as policies genéricas "auth.role() = 'authenticated'" por filtro
-- real via user_units, igualando o padrão já usado nas tabelas wa_*.
-- ============================================================================

-- ── Helper: subquery reutilizada em todas as policies ───────────────────────
-- unit_id IN (SELECT unit_id FROM user_units WHERE user_id = auth.uid())

-- ============================================================================
-- 1. LEADS
-- ============================================================================
DROP POLICY IF EXISTS "Authenticated lê leads" ON leads;
DROP POLICY IF EXISTS "Authenticated insere leads" ON leads;
DROP POLICY IF EXISTS "Authenticated atualiza leads" ON leads;

CREATE POLICY "unit_members_leads_select" ON leads
  FOR SELECT USING (
    unit_id IN (SELECT unit_id FROM user_units WHERE user_id = auth.uid())
  );

CREATE POLICY "unit_members_leads_insert" ON leads
  FOR INSERT WITH CHECK (
    unit_id IN (SELECT unit_id FROM user_units WHERE user_id = auth.uid())
  );

CREATE POLICY "unit_members_leads_update" ON leads
  FOR UPDATE USING (
    unit_id IN (SELECT unit_id FROM user_units WHERE user_id = auth.uid())
  );

CREATE POLICY "unit_members_leads_delete" ON leads
  FOR DELETE USING (
    unit_id IN (SELECT unit_id FROM user_units WHERE user_id = auth.uid())
  );

-- ============================================================================
-- 2. FUNNELS
-- ============================================================================
DROP POLICY IF EXISTS "Authenticated acessa funis" ON funnels;

CREATE POLICY "unit_members_funnels" ON funnels
  FOR ALL USING (
    unit_id IN (SELECT unit_id FROM user_units WHERE user_id = auth.uid())
  ) WITH CHECK (
    unit_id IN (SELECT unit_id FROM user_units WHERE user_id = auth.uid())
  );

-- ============================================================================
-- 3. FUNNEL_STAGES
-- ============================================================================
DROP POLICY IF EXISTS "Authenticated acessa etapas" ON funnel_stages;

CREATE POLICY "unit_members_funnel_stages" ON funnel_stages
  FOR ALL USING (
    unit_id IN (SELECT unit_id FROM user_units WHERE user_id = auth.uid())
  ) WITH CHECK (
    unit_id IN (SELECT unit_id FROM user_units WHERE user_id = auth.uid())
  );

-- ============================================================================
-- 4. LEAD_CONTACTS
-- ============================================================================
DROP POLICY IF EXISTS "Authenticated acessa contatos" ON lead_contacts;

CREATE POLICY "unit_members_lead_contacts" ON lead_contacts
  FOR ALL USING (
    unit_id IN (SELECT unit_id FROM user_units WHERE user_id = auth.uid())
  ) WITH CHECK (
    unit_id IN (SELECT unit_id FROM user_units WHERE user_id = auth.uid())
  );

-- ============================================================================
-- 5. LEAD_NOTES
-- ============================================================================
DROP POLICY IF EXISTS "Authenticated acessa anotações" ON lead_notes;

CREATE POLICY "unit_members_lead_notes" ON lead_notes
  FOR ALL USING (
    unit_id IN (SELECT unit_id FROM user_units WHERE user_id = auth.uid())
  ) WITH CHECK (
    unit_id IN (SELECT unit_id FROM user_units WHERE user_id = auth.uid())
  );

-- ============================================================================
-- 6. LEAD_TASKS
-- ============================================================================
DROP POLICY IF EXISTS "Authenticated acessa tarefas" ON lead_tasks;

CREATE POLICY "unit_members_lead_tasks" ON lead_tasks
  FOR ALL USING (
    unit_id IN (SELECT unit_id FROM user_units WHERE user_id = auth.uid())
  ) WITH CHECK (
    unit_id IN (SELECT unit_id FROM user_units WHERE user_id = auth.uid())
  );

-- ============================================================================
-- 7. LEAD_RESPONSIBLE_HISTORY
-- ============================================================================
DROP POLICY IF EXISTS "Authenticated acessa histórico" ON lead_responsible_history;

CREATE POLICY "unit_members_lead_responsible_history" ON lead_responsible_history
  FOR ALL USING (
    unit_id IN (SELECT unit_id FROM user_units WHERE user_id = auth.uid())
  ) WITH CHECK (
    unit_id IN (SELECT unit_id FROM user_units WHERE user_id = auth.uid())
  );

-- ============================================================================
-- 8. LEAD_NEGOTIATION (sem unit_id — filtra via lead_id → leads.unit_id)
-- ============================================================================
DROP POLICY IF EXISTS "Authenticated acessa negociação" ON lead_negotiation;

CREATE POLICY "unit_members_lead_negotiation" ON lead_negotiation
  FOR ALL USING (
    lead_id IN (
      SELECT id FROM leads
      WHERE unit_id IN (SELECT unit_id FROM user_units WHERE user_id = auth.uid())
    )
  ) WITH CHECK (
    lead_id IN (
      SELECT id FROM leads
      WHERE unit_id IN (SELECT unit_id FROM user_units WHERE user_id = auth.uid())
    )
  );

-- ============================================================================
-- 9. LEAD_STAGE_HISTORY (sem unit_id — filtra via lead_id → leads.unit_id)
-- ============================================================================
DROP POLICY IF EXISTS "lead_stage_history_read" ON lead_stage_history;
DROP POLICY IF EXISTS "lead_stage_history_insert" ON lead_stage_history;

CREATE POLICY "unit_members_lead_stage_history" ON lead_stage_history
  FOR ALL USING (
    lead_id IN (
      SELECT id FROM leads
      WHERE unit_id IN (SELECT unit_id FROM user_units WHERE user_id = auth.uid())
    )
  ) WITH CHECK (
    lead_id IN (
      SELECT id FROM leads
      WHERE unit_id IN (SELECT unit_id FROM user_units WHERE user_id = auth.uid())
    )
  );

-- ============================================================================
-- 10. PRODUCTS
-- ============================================================================
DROP POLICY IF EXISTS "Authenticated acessa produtos" ON products;

CREATE POLICY "unit_members_products" ON products
  FOR ALL USING (
    unit_id IN (SELECT unit_id FROM user_units WHERE user_id = auth.uid())
  ) WITH CHECK (
    unit_id IN (SELECT unit_id FROM user_units WHERE user_id = auth.uid())
  );

-- ============================================================================
-- 11. PRODUCT_PRICES
-- ============================================================================
DROP POLICY IF EXISTS "Authenticated acessa preços" ON product_prices;

CREATE POLICY "unit_members_product_prices" ON product_prices
  FOR ALL USING (
    unit_id IN (SELECT unit_id FROM user_units WHERE user_id = auth.uid())
  ) WITH CHECK (
    unit_id IN (SELECT unit_id FROM user_units WHERE user_id = auth.uid())
  );

-- ============================================================================
-- 12. QUOTES (mantém policies públicas para link de orçamento)
-- ============================================================================
DROP POLICY IF EXISTS "Authenticated acessa orçamentos" ON quotes;

CREATE POLICY "unit_members_quotes" ON quotes
  FOR ALL USING (
    unit_id IN (SELECT unit_id FROM user_units WHERE user_id = auth.uid())
  ) WITH CHECK (
    unit_id IN (SELECT unit_id FROM user_units WHERE user_id = auth.uid())
  );
-- quotes_public_read e quotes_public_update_status permanecem (acesso anônimo via token)

-- ============================================================================
-- 13. QUOTE_ITEMS (mantém policy pública para link de orçamento)
-- ============================================================================
DROP POLICY IF EXISTS "Authenticated acessa itens de orçamento" ON quote_items;

CREATE POLICY "unit_members_quote_items" ON quote_items
  FOR ALL USING (
    unit_id IN (SELECT unit_id FROM user_units WHERE user_id = auth.uid())
  ) WITH CHECK (
    unit_id IN (SELECT unit_id FROM user_units WHERE user_id = auth.uid())
  );
-- quote_items_public_read permanece

-- ============================================================================
-- 14. QUOTE_TEMPLATES
-- ============================================================================
DROP POLICY IF EXISTS "Authenticated acessa templates" ON quote_templates;

CREATE POLICY "unit_members_quote_templates" ON quote_templates
  FOR ALL USING (
    unit_id IN (SELECT unit_id FROM user_units WHERE user_id = auth.uid())
  ) WITH CHECK (
    unit_id IN (SELECT unit_id FROM user_units WHERE user_id = auth.uid())
  );

-- ============================================================================
-- 15. QUOTE_AUTOMATIONS
-- ============================================================================
DROP POLICY IF EXISTS "Authenticated acessa automações" ON quote_automations;

CREATE POLICY "unit_members_quote_automations" ON quote_automations
  FOR ALL USING (
    unit_id IN (SELECT unit_id FROM user_units WHERE user_id = auth.uid())
  ) WITH CHECK (
    unit_id IN (SELECT unit_id FROM user_units WHERE user_id = auth.uid())
  );

-- ============================================================================
-- 16. NOTIFICATIONS
-- ============================================================================
DROP POLICY IF EXISTS "notifications_select" ON notifications;
DROP POLICY IF EXISTS "notifications_update" ON notifications;

CREATE POLICY "unit_members_notifications_select" ON notifications
  FOR SELECT USING (
    unit_id IN (SELECT unit_id FROM user_units WHERE user_id = auth.uid())
  );

CREATE POLICY "unit_members_notifications_update" ON notifications
  FOR UPDATE USING (
    unit_id IN (SELECT unit_id FROM user_units WHERE user_id = auth.uid())
  );

-- ============================================================================
-- 17. WA_BILLING_CONVERSATIONS
-- ============================================================================
DROP POLICY IF EXISTS "Authenticated acessa billing" ON wa_billing_conversations;

CREATE POLICY "unit_members_wa_billing" ON wa_billing_conversations
  FOR ALL USING (
    unit_id IN (SELECT unit_id FROM user_units WHERE user_id = auth.uid())
  ) WITH CHECK (
    unit_id IN (SELECT unit_id FROM user_units WHERE user_id = auth.uid())
  );

-- ============================================================================
-- 18. PROFILES — todos logados continuam vendo todos os perfis (necessário para
--     exibir nomes de atendentes em outras unidades em contextos como supervisão).
--     UPDATE já tem policy restritiva.
-- ============================================================================
-- Sem alteração: profiles SELECT permanece aberto para authenticated.

-- ============================================================================
-- 19. TENANTS e UNITS — restringir leitura para as unidades do usuário
-- ============================================================================
DROP POLICY IF EXISTS "Authenticated acessa tenants" ON tenants;
DROP POLICY IF EXISTS "Authenticated acessa units" ON units;
DROP POLICY IF EXISTS "Authenticated acessa user_units" ON user_units;

CREATE POLICY "unit_members_tenants" ON tenants
  FOR SELECT USING (
    id IN (
      SELECT u.tenant_id FROM units u
      JOIN user_units uu ON uu.unit_id = u.id
      WHERE uu.user_id = auth.uid()
    )
  );

CREATE POLICY "unit_members_units" ON units
  FOR SELECT USING (
    id IN (SELECT unit_id FROM user_units WHERE user_id = auth.uid())
  );

CREATE POLICY "unit_members_user_units" ON user_units
  FOR SELECT USING (
    user_id = auth.uid()
  );
