-- Coluna para armazenar IDs dos usuários mencionados na nota
ALTER TABLE lead_notes
  ADD COLUMN mencoes JSONB DEFAULT '[]'::jsonb;

-- Trigger: ao inserir/atualizar nota com menções, cria notificação para cada mencionado
CREATE OR REPLACE FUNCTION fn_notify_note_mentions()
RETURNS TRIGGER AS $$
DECLARE
  mentioned_id UUID;
  lead_name TEXT;
  author_name TEXT;
BEGIN
  -- Só processa se há menções
  IF NEW.mencoes IS NULL OR jsonb_array_length(NEW.mencoes) = 0 THEN
    RETURN NEW;
  END IF;

  -- Busca nome do lead
  SELECT nome INTO lead_name FROM leads WHERE id = NEW.lead_id;

  -- Busca nome do autor
  SELECT full_name INTO author_name FROM profiles WHERE id = NEW.autor_id;

  -- Para cada mencionado, cria notificação (exceto o próprio autor)
  FOR mentioned_id IN SELECT jsonb_array_elements_text(NEW.mencoes)::uuid
  LOOP
    IF mentioned_id != COALESCE(NEW.autor_id, '00000000-0000-0000-0000-000000000000'::uuid) THEN
      INSERT INTO notifications (unit_id, user_id, type, title, body, lead_id)
      VALUES (
        NEW.unit_id,
        mentioned_id,
        'mention_note',
        COALESCE(author_name, 'Alguém') || ' mencionou você',
        LEFT(NEW.conteudo, 120),
        NEW.lead_id
      );
    END IF;
  END LOOP;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trg_note_mentions
  AFTER INSERT ON lead_notes
  FOR EACH ROW
  EXECUTE FUNCTION fn_notify_note_mentions();
