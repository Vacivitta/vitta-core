-- ============================================================================
-- Migration 069: wa_automations — suporte a ação send_template
--
-- Adiciona template_id para referenciar qual template enviar quando a ação
-- da automação for 'send_template'.
-- ============================================================================

ALTER TABLE wa_automations
  ADD COLUMN IF NOT EXISTS template_id UUID REFERENCES wa_message_templates(id) ON DELETE SET NULL;
