-- ============================================================
-- VITTA CORE CRM — Migration 026: Trigger de stage robusto
-- O trigger não pode jamais cancelar o UPDATE do lead.
-- EXCEPTION WHEN OTHERS garante que falhas internas são silenciosas.
-- ============================================================

CREATE OR REPLACE FUNCTION record_lead_stage_change()
RETURNS TRIGGER LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.stage_id IS DISTINCT FROM NEW.stage_id AND NEW.stage_id IS NOT NULL THEN
    BEGIN
      INSERT INTO lead_stage_history (lead_id, de_stage_id, para_stage_id, movido_por)
      VALUES (NEW.id, OLD.stage_id, NEW.stage_id, auth.uid());
    EXCEPTION WHEN OTHERS THEN
      NULL; -- nunca cancela o UPDATE do lead
    END;
  END IF;
  RETURN NEW;
END;
$$;

-- Recriar o trigger para garantir que aponta para a versão atual
DROP TRIGGER IF EXISTS leads_track_stage_change ON leads;
CREATE TRIGGER leads_track_stage_change
  AFTER UPDATE ON leads
  FOR EACH ROW
  EXECUTE FUNCTION record_lead_stage_change();
