-- Adiciona suporte a cabeçalho IMAGE em wa_message_templates
ALTER TABLE wa_message_templates
  ADD COLUMN IF NOT EXISTS header_type      TEXT,
  ADD COLUMN IF NOT EXISTS header_image_url TEXT;
