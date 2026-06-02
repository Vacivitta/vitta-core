-- ============================================================
-- VITTA CORE CRM — Migration 030: Corrige unit_id em leads e histórico de stage
--
-- Problemas resolvidos:
-- 1. Trigger recriado na 029 gerava entradas duplicadas (trigger + RPC do app).
--    A arquitetura correta (desde 027) é o app registrar o histórico via RPC.
-- 2. Leads criados com unit_id = NULL ficavam invisíveis na policy de leitura
--    do lead_stage_history, que faz JOIN leads.unit_id = profiles.unit_id.
-- ============================================================

-- 1. Remover trigger e função recriados indevidamente pela migration 029
DROP TRIGGER  IF EXISTS leads_track_stage_change ON leads;
DROP FUNCTION IF EXISTS record_lead_stage_change();

-- 2. Backfill: atribuir unit_id nos leads que ainda estão NULL,
--    usando o unit_id do responsável do lead.
UPDATE leads l
SET    unit_id = p.unit_id
FROM   profiles p
WHERE  l.responsavel_id = p.id
  AND  l.unit_id IS NULL
  AND  p.unit_id IS NOT NULL;
