-- Resolution fields on wa_conversations
ALTER TABLE wa_conversations
  ADD COLUMN IF NOT EXISTS resolved_reason text,
  ADD COLUMN IF NOT EXISTS resolved_note   text,
  ADD COLUMN IF NOT EXISTS resolved_at     timestamptz;

-- Quick replies
CREATE TABLE IF NOT EXISTS wa_quick_replies (
  id         uuid        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  unit_id    uuid        NOT NULL REFERENCES units(id) ON DELETE CASCADE,
  shortcut   text        NOT NULL,
  content    text        NOT NULL,
  ativo      boolean     NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE wa_quick_replies ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='wa_quick_replies' AND policyname='unit members') THEN
    CREATE POLICY "unit members" ON wa_quick_replies FOR ALL USING (
      unit_id IN (SELECT unit_id FROM profiles WHERE id = auth.uid())
    );
  END IF;
END $$;

-- Message templates (custom text or Meta API)
CREATE TABLE IF NOT EXISTS wa_message_templates (
  id            uuid        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  unit_id       uuid        NOT NULL REFERENCES units(id) ON DELETE CASCADE,
  name          text        NOT NULL,
  content       text        NOT NULL,
  category      text        NOT NULL DEFAULT 'custom',
  template_name text,
  language      text                 DEFAULT 'pt_BR',
  ativo         boolean     NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE wa_message_templates ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='wa_message_templates' AND policyname='unit members') THEN
    CREATE POLICY "unit members" ON wa_message_templates FOR ALL USING (
      unit_id IN (SELECT unit_id FROM profiles WHERE id = auth.uid())
    );
  END IF;
END $$;

-- Scheduled messages
CREATE TABLE IF NOT EXISTS wa_scheduled_messages (
  id              uuid        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  conversation_id uuid        NOT NULL REFERENCES wa_conversations(id) ON DELETE CASCADE,
  unit_id         uuid        NOT NULL REFERENCES units(id) ON DELETE CASCADE,
  content         text,
  type            text        NOT NULL DEFAULT 'text',
  scheduled_for   timestamptz NOT NULL,
  status          text        NOT NULL DEFAULT 'pending',
  sent_at         timestamptz,
  created_by      uuid        REFERENCES profiles(id),
  created_at      timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE wa_scheduled_messages ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='wa_scheduled_messages' AND policyname='unit members') THEN
    CREATE POLICY "unit members" ON wa_scheduled_messages FOR ALL USING (
      unit_id IN (SELECT unit_id FROM profiles WHERE id = auth.uid())
    );
  END IF;
END $$;
