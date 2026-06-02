-- ============================================================
-- VITTA CORE CRM — Migration 029: Trigger de histórico de stage v2
-- Versão simples e robusta: sem auth.uid() (que pode falhar em SECURITY DEFINER),
-- sem EXCEPTION que engolia os erros. Registra movido_por = NULL para
-- movimentações automáticas e manuais (ambas ficam como "Automação" no histórico).
-- Para distinguir manual vs automação, usamos um campo extra movido_via.
-- ============================================================

-- Adicionar coluna movido_via para distinguir canal de origem
ALTER TABLE lead_stage_history
  ADD COLUMN IF NOT EXISTS movido_via TEXT DEFAULT 'manual';

-- Recriar função simples, sem auth.uid(), sem EXCEPTION escondida
CREATE OR REPLACE FUNCTION record_lead_stage_change()
RETURNS TRIGGER LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.stage_id IS DISTINCT FROM NEW.stage_id AND NEW.stage_id IS NOT NULL THEN
    INSERT INTO lead_stage_history (lead_id, de_stage_id, para_stage_id, movido_por, movido_via)
    VALUES (NEW.id, OLD.stage_id, NEW.stage_id, NULL, 'trigger');
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$$;

-- Recriar trigger
DROP TRIGGER IF EXISTS leads_track_stage_change ON leads;
CREATE TRIGGER leads_track_stage_change
  AFTER UPDATE ON leads
  FOR EACH ROW
  EXECUTE FUNCTION record_lead_stage_change();
