-- ============================================================
-- VITTA CORE CRM — Migration 024: Corrige trigger de histórico de stage
-- A função precisa de SECURITY DEFINER para conseguir inserir em
-- lead_stage_history independente de quem originou o UPDATE no lead
-- (usuário autenticado via kanban/modal, ou automação via SECURITY DEFINER).
-- ============================================================

CREATE OR REPLACE FUNCTION record_lead_stage_change()
RETURNS TRIGGER LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.stage_id IS DISTINCT FROM NEW.stage_id AND NEW.stage_id IS NOT NULL THEN
    INSERT INTO lead_stage_history (lead_id, de_stage_id, para_stage_id, movido_por)
    VALUES (NEW.id, OLD.stage_id, NEW.stage_id, auth.uid());
  END IF;
  RETURN NEW;
END;
$$;
