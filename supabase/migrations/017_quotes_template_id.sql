-- ============================================================
-- VITTA CORE CRM — Migration 017: Liga orçamento ao template visual
-- ============================================================

ALTER TABLE quotes
  ADD COLUMN IF NOT EXISTS template_id UUID REFERENCES quote_templates(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_quotes_template ON quotes(template_id) WHERE template_id IS NOT NULL;
