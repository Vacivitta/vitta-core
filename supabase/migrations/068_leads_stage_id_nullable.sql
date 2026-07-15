-- ============================================================================
-- Migration 068: Permitir stage_id NULL em leads
--
-- A FK leads.stage_id → funnel_stages.id tem ON DELETE SET NULL, mas a coluna
-- tinha NOT NULL, causando erro ao excluir etapas com leads vinculados.
-- ============================================================================

ALTER TABLE leads ALTER COLUMN stage_id DROP NOT NULL;
