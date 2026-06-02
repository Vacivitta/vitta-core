-- ============================================================
-- VITTA CORE CRM — Migration 019: Automações de funil por status de orçamento
-- Admin configura qual ação executar quando um orçamento muda de status
-- ============================================================

CREATE TABLE IF NOT EXISTS quote_automations (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id      UUID NOT NULL REFERENCES units(id),
  quote_status TEXT NOT NULL CHECK (quote_status IN (
    'enviado', 'visualizado', 'aceito', 'recusado', 'em_negociacao', 'expirado'
  )),
  action       TEXT NOT NULL DEFAULT 'move_stage'
               CHECK (action IN ('move_stage', 'archive', 'none')),
  stage_id     UUID REFERENCES funnel_stages(id) ON DELETE SET NULL,
  ativo        BOOLEAN NOT NULL DEFAULT TRUE,
  criado_em    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (unit_id, quote_status)
);

CREATE INDEX IF NOT EXISTS idx_quote_automations_unit ON quote_automations(unit_id, quote_status) WHERE ativo = TRUE;

ALTER TABLE quote_automations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated acessa automações" ON quote_automations;
CREATE POLICY "Authenticated acessa automações" ON quote_automations
  FOR ALL USING (auth.role() = 'authenticated');
