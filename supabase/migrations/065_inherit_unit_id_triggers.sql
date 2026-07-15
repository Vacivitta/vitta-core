-- ============================================================================
-- Migration 065: Trigger para herdar unit_id do lead pai
--
-- Tabelas filhas (lead_notes, lead_tasks, lead_contacts, lead_responsible_history)
-- nem sempre recebem unit_id do frontend. Este trigger preenche automaticamente
-- a partir do lead pai no INSERT, garantindo que o RLS funcione corretamente.
-- ============================================================================

CREATE OR REPLACE FUNCTION fn_inherit_unit_from_lead()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.unit_id IS NULL AND NEW.lead_id IS NOT NULL THEN
    SELECT unit_id INTO NEW.unit_id FROM leads WHERE id = NEW.lead_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_lead_notes_inherit_unit ON lead_notes;
CREATE TRIGGER trg_lead_notes_inherit_unit
  BEFORE INSERT ON lead_notes
  FOR EACH ROW EXECUTE FUNCTION fn_inherit_unit_from_lead();

DROP TRIGGER IF EXISTS trg_lead_tasks_inherit_unit ON lead_tasks;
CREATE TRIGGER trg_lead_tasks_inherit_unit
  BEFORE INSERT ON lead_tasks
  FOR EACH ROW EXECUTE FUNCTION fn_inherit_unit_from_lead();

DROP TRIGGER IF EXISTS trg_lead_contacts_inherit_unit ON lead_contacts;
CREATE TRIGGER trg_lead_contacts_inherit_unit
  BEFORE INSERT ON lead_contacts
  FOR EACH ROW EXECUTE FUNCTION fn_inherit_unit_from_lead();

DROP TRIGGER IF EXISTS trg_lead_responsible_history_inherit_unit ON lead_responsible_history;
CREATE TRIGGER trg_lead_responsible_history_inherit_unit
  BEFORE INSERT ON lead_responsible_history
  FOR EACH ROW EXECUTE FUNCTION fn_inherit_unit_from_lead();
