-- Tabela de tags configuráveis por unidade
CREATE TABLE IF NOT EXISTS wa_tags (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id    uuid REFERENCES units(id) ON DELETE CASCADE NOT NULL,
  name       text NOT NULL,
  color      text NOT NULL DEFAULT '#6B7280',
  created_at timestamptz DEFAULT now()
);

ALTER TABLE wa_tags ENABLE ROW LEVEL SECURITY;

CREATE POLICY "unit members can manage their tags"
  ON wa_tags FOR ALL
  USING (
    unit_id IN (
      SELECT unit_id FROM profiles WHERE id = auth.uid()
    )
  );

-- Tabela de atribuição de tags a conversas
CREATE TABLE IF NOT EXISTS wa_conversation_tags (
  conversation_id uuid REFERENCES wa_conversations(id) ON DELETE CASCADE NOT NULL,
  tag_id          uuid REFERENCES wa_tags(id) ON DELETE CASCADE NOT NULL,
  PRIMARY KEY (conversation_id, tag_id)
);

ALTER TABLE wa_conversation_tags ENABLE ROW LEVEL SECURITY;

CREATE POLICY "unit members can manage conversation tags"
  ON wa_conversation_tags FOR ALL
  USING (
    tag_id IN (
      SELECT t.id FROM wa_tags t
      JOIN profiles p ON p.unit_id = t.unit_id
      WHERE p.id = auth.uid()
    )
  );
