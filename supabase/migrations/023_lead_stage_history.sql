-- ============================================================
-- VITTA CORE CRM — Migration 023: Histórico de movimentação de stage
-- Trigger automático que registra toda mudança de stage do lead,
-- capturando de onde veio, para onde foi e quem moveu.
-- ============================================================

CREATE TABLE lead_stage_history (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id       UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  de_stage_id   UUID          REFERENCES funnel_stages(id) ON DELETE SET NULL,
  para_stage_id UUID NOT NULL REFERENCES funnel_stages(id) ON DELETE CASCADE,
  movido_por    UUID          REFERENCES profiles(id) ON DELETE SET NULL,
  criado_em     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_lead_stage_history_lead ON lead_stage_history(lead_id, criado_em DESC);

ALTER TABLE lead_stage_history ENABLE ROW LEVEL SECURITY;

-- Leitura: usuário autenticado da mesma unidade do lead
CREATE POLICY "lead_stage_history_read" ON lead_stage_history
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM leads l
      JOIN  profiles p ON p.unit_id = l.unit_id
      WHERE l.id    = lead_stage_history.lead_id
        AND p.id    = auth.uid()
    )
  );

-- ── Trigger: grava automaticamente ao atualizar stage_id ─────────────────────
-- auth.uid() retorna o usuário autenticado quando vem via PostgREST (kanban/modal).
-- Retorna NULL quando vem de SECURITY DEFINER (automação) — exibido como "Automação".
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

CREATE TRIGGER leads_track_stage_change
  AFTER UPDATE ON leads
  FOR EACH ROW
  EXECUTE FUNCTION record_lead_stage_change();
