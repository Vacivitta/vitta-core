-- Coluna mencoes em internal_channel_messages
ALTER TABLE internal_channel_messages
  ADD COLUMN IF NOT EXISTS mencoes JSONB DEFAULT '[]'::jsonb;

-- Trigger: ao inserir mensagem com menções no chat interno, cria notificação
CREATE OR REPLACE FUNCTION fn_notify_chat_interno_mentions()
RETURNS TRIGGER AS $$
DECLARE
  mentioned_id UUID;
  author_name TEXT;
  mentioned_unit_id UUID;
BEGIN
  IF NEW.mencoes IS NULL OR jsonb_array_length(NEW.mencoes) = 0 THEN
    RETURN NEW;
  END IF;

  SELECT full_name INTO author_name FROM profiles WHERE id = NEW.autor_id;

  FOR mentioned_id IN SELECT jsonb_array_elements_text(NEW.mencoes)::uuid
  LOOP
    IF mentioned_id != COALESCE(NEW.autor_id, '00000000-0000-0000-0000-000000000000'::uuid) THEN
      SELECT unit_id INTO mentioned_unit_id FROM profiles WHERE id = mentioned_id;

      INSERT INTO notifications (unit_id, user_id, type, title, body)
      VALUES (
        COALESCE(mentioned_unit_id, (SELECT unit_id FROM profiles WHERE id = NEW.autor_id)),
        mentioned_id,
        'mention_note',
        COALESCE(author_name, 'Alguém') || ' mencionou você no chat interno',
        LEFT(NEW.conteudo, 120)
      );
    END IF;
  END LOOP;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trg_chat_interno_mentions
  AFTER INSERT ON internal_channel_messages
  FOR EACH ROW
  EXECUTE FUNCTION fn_notify_chat_interno_mentions();
