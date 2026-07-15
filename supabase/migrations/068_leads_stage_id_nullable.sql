-- ============================================================================
-- Migration 068: Reverter stage_id nullable (manter NOT NULL)
--
-- A exclusão de etapas com leads deve ser bloqueada no app, não pelo banco.
-- stage_id permanece NOT NULL — leads devem ser distribuídos antes de excluir.
-- (Esta migration foi revertida — stage_id continua NOT NULL como estava.)
-- ============================================================================

-- Noop — mantido para histórico. A coluna stage_id em leads permanece NOT NULL.
SELECT 1;
