-- ============================================================================
-- Migration 070: Automações baseadas em tempo
--
-- Permite criar regras como "lead sem resposta há 48h → enviar template" ou
-- "lead parado na etapa X há 5 dias → mover para Y".
-- ============================================================================

CREATE TABLE IF NOT EXISTS wa_timed_automations (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id          UUID NOT NULL REFERENCES units(id) ON DELETE CASCADE,
  nome             TEXT NOT NULL DEFAULT '',
  condition        TEXT NOT NULL,          -- no_patient_reply | lead_stuck_stage | no_agent_reply | lead_no_task
  threshold_hours  INT  NOT NULL DEFAULT 48,
  action           TEXT NOT NULL,          -- send_template | move_stage
  template_id      UUID REFERENCES wa_message_templates(id) ON DELETE SET NULL,
  action_stage_id  UUID REFERENCES funnel_stages(id) ON DELETE SET NULL,
  filter_stage_id  UUID REFERENCES funnel_stages(id) ON DELETE SET NULL,
  filter_funnel_id UUID REFERENCES funnels(id) ON DELETE SET NULL,
  ativo            BOOLEAN NOT NULL DEFAULT TRUE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS wa_timed_automation_log (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  automation_id  UUID NOT NULL REFERENCES wa_timed_automations(id) ON DELETE CASCADE,
  lead_id        UUID REFERENCES leads(id) ON DELETE SET NULL,
  conversation_id UUID REFERENCES wa_conversations(id) ON DELETE SET NULL,
  triggered_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_timed_auto_unit ON wa_timed_automations(unit_id) WHERE ativo = true;
CREATE INDEX IF NOT EXISTS idx_timed_auto_log_lookup ON wa_timed_automation_log(automation_id, lead_id);
CREATE INDEX IF NOT EXISTS idx_timed_auto_log_conv ON wa_timed_automation_log(automation_id, conversation_id);

-- RLS
ALTER TABLE wa_timed_automations ENABLE ROW LEVEL SECURITY;
ALTER TABLE wa_timed_automation_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "wa_timed_automations_unit" ON wa_timed_automations
  FOR ALL USING (
    unit_id IN (SELECT unit_id FROM user_units WHERE user_id = auth.uid())
    OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND perfil IN ('admin','gestor_vacivitta'))
  );

CREATE POLICY "wa_timed_automation_log_unit" ON wa_timed_automation_log
  FOR ALL USING (
    automation_id IN (
      SELECT id FROM wa_timed_automations WHERE unit_id IN (
        SELECT unit_id FROM user_units WHERE user_id = auth.uid()
      )
    )
    OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND perfil IN ('admin','gestor_vacivitta'))
  );
