-- ============================================================
-- VITTA CORE CRM — Migration 028: Função SECURITY DEFINER para histórico
-- O INSERT direto via browser client é bloqueado por RLS.
-- Esta função bypassa RLS igual ao execute_quote_automation.
-- ============================================================

CREATE OR REPLACE FUNCTION record_stage_history(
  p_lead_id    UUID,
  p_de_stage   UUID,
  p_para_stage UUID,
  p_movido_por UUID DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO lead_stage_history (lead_id, de_stage_id, para_stage_id, movido_por)
  VALUES (p_lead_id, p_de_stage, p_para_stage, p_movido_por);
END;
$$;

GRANT EXECUTE ON FUNCTION record_stage_history(UUID, UUID, UUID, UUID) TO anon, authenticated;
