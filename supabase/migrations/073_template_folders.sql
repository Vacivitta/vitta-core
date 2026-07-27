-- Pastas para organização visual de templates WhatsApp
CREATE TABLE wa_template_folders (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id    UUID NOT NULL REFERENCES units(id),
  nome       TEXT NOT NULL,
  ordem      INT NOT NULL DEFAULT 0,
  criado_em  TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE wa_template_folders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "wa_template_folders_unit" ON wa_template_folders
  FOR ALL USING (unit_id IN (
    SELECT unit_id FROM profiles WHERE id = auth.uid()
  ));

-- Coluna folder_id em wa_message_templates (nullable = sem pasta / "Geral")
ALTER TABLE wa_message_templates
  ADD COLUMN folder_id UUID REFERENCES wa_template_folders(id) ON DELETE SET NULL;
