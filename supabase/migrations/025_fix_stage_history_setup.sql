-- ============================================================
-- VITTA CORE CRM — Migration 025: Completa setup do histórico de stage
-- A migration 023 falhou no CREATE TABLE (já existia) e não criou
-- o trigger nem as policies. Esta migration é totalmente idempotente.
-- ============================================================

-- Garantir RLS ativo
ALTER TABLE lead_stage_history ENABLE ROW LEVEL SECURITY;

-- Policy de leitura (ignora se já existir)
DO $$ BEGIN
  CREATE POLICY "lead_stage_history_read" ON lead_stage_history
    FOR SELECT USING (
      EXISTS (
        SELECT 1 FROM leads l
        JOIN  profiles p ON p.unit_id = l.unit_id
        WHERE l.id = lead_stage_history.lead_id
          AND p.id = auth.uid()
      )
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Index (ignora se já existir)
CREATE INDEX IF NOT EXISTS idx_lead_stage_history_lead
  ON lead_stage_history(lead_id, criado_em DESC);

-- Trigger (recria sempre para garantir que aponta para a função correta)
DROP TRIGGER IF EXISTS leads_track_stage_change ON leads;
CREATE TRIGGER leads_track_stage_change
  AFTER UPDATE ON leads
  FOR EACH ROW
  EXECUTE FUNCTION record_lead_stage_change();
