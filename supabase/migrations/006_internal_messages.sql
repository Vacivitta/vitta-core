-- Migration 006: Internal team chat
-- Creates internal_messages table for operator-to-operator messaging

CREATE TABLE internal_messages (
  id         UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  de_id      UUID        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  para_id    UUID        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  conteudo   TEXT        NOT NULL CHECK (char_length(conteudo) > 0),
  lido       BOOLEAN     NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX internal_messages_para_id_idx ON internal_messages(para_id);
CREATE INDEX internal_messages_de_id_idx   ON internal_messages(de_id);

ALTER TABLE internal_messages ENABLE ROW LEVEL SECURITY;

-- Users can read messages where they are sender or recipient
CREATE POLICY "users_see_own_messages" ON internal_messages
  FOR SELECT USING (auth.uid() = de_id OR auth.uid() = para_id);

-- Users can insert messages where they are the sender
CREATE POLICY "users_send_messages" ON internal_messages
  FOR INSERT WITH CHECK (auth.uid() = de_id);

-- Users can update (mark as read) messages where they are the recipient
CREATE POLICY "users_mark_read" ON internal_messages
  FOR UPDATE USING (auth.uid() = para_id);

-- Enable Realtime for this table
ALTER PUBLICATION supabase_realtime ADD TABLE internal_messages;
