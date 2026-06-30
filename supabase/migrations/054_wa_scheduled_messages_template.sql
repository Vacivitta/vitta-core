-- Permite agendar mensagens do tipo template (não só texto livre)
ALTER TABLE wa_scheduled_messages
  ADD COLUMN IF NOT EXISTS template_name TEXT,
  ADD COLUMN IF NOT EXISTS language      TEXT,
  ADD COLUMN IF NOT EXISTS components    JSONB;
