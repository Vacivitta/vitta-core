-- Garante que tabelas de WhatsApp estão na publicação do Supabase Realtime
-- (podem já ter sido adicionadas via Dashboard)

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'wa_messages'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE wa_messages;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'wa_conversations'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE wa_conversations;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'wa_internal_notes'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE wa_internal_notes;
  END IF;
END $$;
