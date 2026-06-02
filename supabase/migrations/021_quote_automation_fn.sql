-- ============================================================
-- VITTA CORE CRM — Migration 021: Função de automação de funil
-- Adiciona trigger 'criado' e função SECURITY DEFINER que
-- executa automações sem precisar de service-role key.
-- ============================================================

-- 1. Adicionar 'criado' ao CHECK do quote_automations
ALTER TABLE quote_automations
  DROP CONSTRAINT IF EXISTS quote_automations_quote_status_check;

ALTER TABLE quote_automations
  ADD CONSTRAINT quote_automations_quote_status_check
  CHECK (quote_status IN (
    'criado', 'enviado', 'visualizado', 'aceito', 'recusado', 'em_negociacao', 'expirado'
  ));

-- 2. Função SECURITY DEFINER — roda com privilégios do owner,
--    bypassa RLS sem precisar de service-role key no backend.
CREATE OR REPLACE FUNCTION execute_quote_automation(
  p_unit_id      UUID,
  p_lead_id      UUID,
  p_quote_status TEXT,
  p_motivo       TEXT DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_action   TEXT;
  v_stage_id UUID;
BEGIN
  SELECT action, stage_id
    INTO v_action, v_stage_id
    FROM quote_automations
   WHERE unit_id      = p_unit_id
     AND quote_status = p_quote_status
     AND ativo        = TRUE
   LIMIT 1;

  IF v_action IS NULL OR v_action = 'none' THEN
    RETURN;
  END IF;

  IF v_action = 'move_stage' AND v_stage_id IS NOT NULL THEN
    UPDATE leads SET stage_id = v_stage_id WHERE id = p_lead_id;

  ELSIF v_action = 'archive' THEN
    UPDATE leads
       SET arquivado    = TRUE,
           motivo_perda = CASE
             WHEN p_quote_status = 'recusado'
             THEN CONCAT('Orçamento recusado: ', COALESCE(p_motivo, '—'))
             ELSE 'Arquivado por automação de orçamento'
           END
     WHERE id = p_lead_id;
  END IF;
END;
$$;

-- Permite chamada por qualquer role (anon incluso — paciente aceitando via link público)
GRANT EXECUTE ON FUNCTION execute_quote_automation(UUID, UUID, TEXT, TEXT) TO anon, authenticated;
