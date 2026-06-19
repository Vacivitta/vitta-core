-- ── Migration 032b: Core WhatsApp tables ─────────────────────────────────────
-- Fundação das tabelas WA que as migrações 033+ dependem.
-- Usa CREATE TABLE IF NOT EXISTS para ser idempotente.

-- ─── 1. wa_queues ────────────────────────────────────────────────────────────
-- Criada antes de wa_conversations para evitar FK pendente.
CREATE TABLE IF NOT EXISTS wa_queues (
  id                  uuid        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  unit_id             uuid        NOT NULL REFERENCES units(id) ON DELETE CASCADE,
  nome                text        NOT NULL,
  cor                 text        NOT NULL DEFAULT '#6b7280',
  ativo               boolean     NOT NULL DEFAULT true,
  -- Colunas que a migração 036 adicionaria via ALTER — já incluídas aqui:
  auto_assign         boolean     NOT NULL DEFAULT false,
  distribution_method text        NOT NULL DEFAULT 'round_robin',
  max_per_agent       int         NOT NULL DEFAULT 10,
  last_assigned_agent uuid        REFERENCES profiles(id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE wa_queues ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'wa_queues' AND policyname = 'unit members'
  ) THEN
    CREATE POLICY "unit members" ON wa_queues FOR ALL USING (
      unit_id IN (SELECT unit_id FROM profiles WHERE id = auth.uid())
    );
  END IF;
END $$;

-- ─── 2. wa_conversations ─────────────────────────────────────────────────────
-- Inclui as colunas que a migração 033 adicionaria via ALTER.
CREATE TABLE IF NOT EXISTS wa_conversations (
  id              uuid        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  unit_id         uuid        NOT NULL REFERENCES units(id) ON DELETE CASCADE,
  wa_phone        text        NOT NULL,
  wa_contact_name text,
  status          text        NOT NULL DEFAULT 'open',
  unread_count    int         NOT NULL DEFAULT 0,
  last_message_at timestamptz,
  assigned_to     uuid        REFERENCES profiles(id) ON DELETE SET NULL,
  queue_id        uuid        REFERENCES wa_queues(id) ON DELETE SET NULL,
  lead_id         uuid        REFERENCES leads(id) ON DELETE SET NULL,
  -- Colunas que a migração 033 adicionaria via ALTER:
  resolved_reason text,
  resolved_note   text,
  resolved_at     timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (unit_id, wa_phone)
);
ALTER TABLE wa_conversations ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'wa_conversations' AND policyname = 'unit members'
  ) THEN
    CREATE POLICY "unit members" ON wa_conversations FOR ALL USING (
      unit_id IN (SELECT unit_id FROM profiles WHERE id = auth.uid())
    );
  END IF;
END $$;

-- ─── 3. wa_messages ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS wa_messages (
  id              uuid        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  conversation_id uuid        NOT NULL REFERENCES wa_conversations(id) ON DELETE CASCADE,
  unit_id         uuid        NOT NULL REFERENCES units(id) ON DELETE CASCADE,
  wa_message_id   text        UNIQUE,
  direction       text        NOT NULL,
  type            text        NOT NULL DEFAULT 'text',
  content         text,
  media_url       text,
  media_mime_type text,
  template_name   text,
  status          text        NOT NULL DEFAULT 'pending',
  sent_by         uuid        REFERENCES profiles(id) ON DELETE SET NULL,
  error_data      jsonb,
  created_at      timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE wa_messages ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'wa_messages' AND policyname = 'unit members'
  ) THEN
    CREATE POLICY "unit members" ON wa_messages FOR ALL USING (
      unit_id IN (SELECT unit_id FROM profiles WHERE id = auth.uid())
    );
  END IF;
END $$;

-- ─── 4. wa_automations ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS wa_automations (
  id         uuid        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  unit_id    uuid        NOT NULL REFERENCES units(id) ON DELETE CASCADE,
  trigger    text        NOT NULL,
  action     text        NOT NULL,
  stage_id   uuid        REFERENCES funnel_stages(id) ON DELETE SET NULL,
  ativo      boolean     NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE wa_automations ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'wa_automations' AND policyname = 'unit members'
  ) THEN
    CREATE POLICY "unit members" ON wa_automations FOR ALL USING (
      unit_id IN (SELECT unit_id FROM profiles WHERE id = auth.uid())
    );
  END IF;
END $$;

-- ─── 5. wa_internal_notes ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS wa_internal_notes (
  id              uuid        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  conversation_id uuid        NOT NULL REFERENCES wa_conversations(id) ON DELETE CASCADE,
  unit_id         uuid        NOT NULL REFERENCES units(id) ON DELETE CASCADE,
  content         text        NOT NULL,
  author_id       uuid        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_at      timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE wa_internal_notes ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'wa_internal_notes' AND policyname = 'unit members'
  ) THEN
    CREATE POLICY "unit members" ON wa_internal_notes FOR ALL USING (
      unit_id IN (SELECT unit_id FROM profiles WHERE id = auth.uid())
    );
  END IF;
END $$;

-- ─── 6. RPC: increment_wa_unread ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION increment_wa_unread(p_conversation_id UUID)
RETURNS void LANGUAGE sql SECURITY DEFINER AS $$
  UPDATE wa_conversations
  SET unread_count = unread_count + 1
  WHERE id = p_conversation_id;
$$;
