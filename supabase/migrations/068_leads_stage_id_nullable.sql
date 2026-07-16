-- ============================================================================
-- Migration 068: FK leads.stage_id → RESTRICT (bloqueia exclusão com leads)
--
-- A FK anterior era ON DELETE SET NULL, mas stage_id é NOT NULL, causando
-- erro ao excluir etapas. Agora a FK é RESTRICT — o app verifica leads
-- antes de tentar excluir e exibe mensagem legível.
-- ============================================================================

ALTER TABLE leads DROP CONSTRAINT IF EXISTS leads_stage_id_fkey;
ALTER TABLE leads ADD CONSTRAINT leads_stage_id_fkey
  FOREIGN KEY (stage_id) REFERENCES funnel_stages(id) ON DELETE RESTRICT;
