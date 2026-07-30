-- Coluna mencoes na wa_internal_notes para armazenar IDs dos mencionados
ALTER TABLE wa_internal_notes
  ADD COLUMN IF NOT EXISTS mencoes JSONB DEFAULT '[]'::jsonb;

-- Trigger: ao inserir nota interna com menções, cria notificação para cada mencionado
CREATE OR REPLACE FUNCTION fn_notify_wa_note_mentions()
RETURNS TRIGGER AS $$
DECLARE
  mentioned_id UUID;
  author_name TEXT;
  lead_id_val UUID;
BEGIN
  IF NEW.mencoes IS NULL OR jsonb_array_length(NEW.mencoes) = 0 THEN
    RETURN NEW;
  END IF;

  SELECT full_name INTO author_name FROM profiles WHERE id = NEW.author_id;

  SELECT c.lead_id INTO lead_id_val
    FROM wa_conversations c WHERE c.id = NEW.conversation_id;

  FOR mentioned_id IN SELECT jsonb_array_elements_text(NEW.mencoes)::uuid
  LOOP
    IF mentioned_id != COALESCE(NEW.author_id, '00000000-0000-0000-0000-000000000000'::uuid) THEN
      INSERT INTO notifications (unit_id, user_id, type, title, body, lead_id)
      VALUES (
        NEW.unit_id,
        mentioned_id,
        'mention_note',
        COALESCE(author_name, 'Alguém') || ' mencionou você',
        LEFT(NEW.content, 120),
        lead_id_val
      );
    END IF;
  END LOOP;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trg_wa_note_mentions
  AFTER INSERT ON wa_internal_notes
  FOR EACH ROW
  EXECUTE FUNCTION fn_notify_wa_note_mentions();
