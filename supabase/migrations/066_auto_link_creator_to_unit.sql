-- ============================================================================
-- Migration 066: Auto-vincular criador à nova unidade em user_units
--
-- Ao criar uma unidade, o RLS de SELECT exige que o usuário tenha entrada
-- em user_units para aquela unit_id. Sem o vínculo, o .select() após o
-- INSERT retorna vazio e o frontend falha silenciosamente.
-- Este trigger cria o vínculo automaticamente no AFTER INSERT.
-- ============================================================================

CREATE OR REPLACE FUNCTION fn_auto_link_creator_to_unit()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO user_units (user_id, unit_id)
  VALUES (auth.uid(), NEW.id)
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_auto_link_creator_to_unit ON units;
CREATE TRIGGER trg_auto_link_creator_to_unit
  AFTER INSERT ON units
  FOR EACH ROW EXECUTE FUNCTION fn_auto_link_creator_to_unit();
