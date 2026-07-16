-- ============================================================================
-- Migration 068: stage_id nullable + FK SET NULL
--
-- Leads arquivados não devem impedir exclusão de etapas. stage_id passa a
-- ser nullable e a FK volta para ON DELETE SET NULL — leads arquivados
-- perdem a referência à etapa excluída, leads ativos são verificados no app.
-- ============================================================================

ALTER TABLE leads ALTER COLUMN stage_id DROP NOT NULL;

ALTER TABLE leads DROP CONSTRAINT IF EXISTS leads_stage_id_fkey;
ALTER TABLE leads ADD CONSTRAINT leads_stage_id_fkey
  FOREIGN KEY (stage_id) REFERENCES funnel_stages(id) ON DELETE SET NULL;
