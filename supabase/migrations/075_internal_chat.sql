-- Canais de conversa interna entre unidades
CREATE TABLE internal_channels (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_a_id  UUID NOT NULL REFERENCES units(id),
  unit_b_id  UUID NOT NULL REFERENCES units(id),
  ativo      BOOLEAN DEFAULT true,
  criado_em  TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT unique_channel UNIQUE (unit_a_id, unit_b_id),
  CONSTRAINT different_units CHECK (unit_a_id <> unit_b_id)
);

ALTER TABLE internal_channels ENABLE ROW LEVEL SECURITY;

CREATE POLICY "internal_channels_access" ON internal_channels
  FOR ALL USING (
    unit_a_id IN (SELECT unit_id FROM profiles WHERE id = auth.uid())
    OR unit_b_id IN (SELECT unit_id FROM profiles WHERE id = auth.uid())
  );

-- Mensagens de canais internos (separado do DM existente em internal_messages)
CREATE TABLE internal_channel_messages (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id  UUID NOT NULL REFERENCES internal_channels(id) ON DELETE CASCADE,
  autor_id    UUID NOT NULL REFERENCES profiles(id),
  conteudo    TEXT NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE internal_channel_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "internal_channel_messages_access" ON internal_channel_messages
  FOR ALL USING (
    channel_id IN (
      SELECT id FROM internal_channels
      WHERE unit_a_id IN (SELECT unit_id FROM profiles WHERE id = auth.uid())
         OR unit_b_id IN (SELECT unit_id FROM profiles WHERE id = auth.uid())
    )
  );

CREATE INDEX idx_icm_channel ON internal_channel_messages(channel_id, created_at DESC);
CREATE INDEX idx_internal_channels_units ON internal_channels(unit_a_id, unit_b_id);
