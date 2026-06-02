-- ============================================================
-- VITTA CORE CRM — Migration 027: Histórico de stage via app code
-- Abandona o trigger (complexo de depurar) e deixa o app registrar
-- o histórico diretamente. Política INSERT aberta para autenticados.
-- ============================================================

-- Remover trigger e função (não são mais necessários)
DROP TRIGGER  IF EXISTS leads_track_stage_change ON leads;
DROP FUNCTION IF EXISTS record_lead_stage_change();

-- Permitir INSERT para authenticated e anon (automações via SECURITY DEFINER)
CREATE POLICY "lead_stage_history_insert" ON lead_stage_history
  FOR INSERT WITH CHECK (true);

-- Atualizar execute_quote_automation para também registrar histórico de stage
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
  v_action        TEXT;
  v_stage_id      UUID;
  v_old_stage_id  UUID;
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
    SELECT stage_id INTO v_old_stage_id FROM leads WHERE id = p_lead_id;
    UPDATE leads SET stage_id = v_stage_id WHERE id = p_lead_id;

    -- Registrar movimentação no histórico
    IF v_old_stage_id IS DISTINCT FROM v_stage_id THEN
      INSERT INTO lead_stage_history (lead_id, de_stage_id, para_stage_id, movido_por)
      VALUES (p_lead_id, v_old_stage_id, v_stage_id, NULL); -- NULL = automação
    END IF;

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
