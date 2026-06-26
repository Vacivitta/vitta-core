-- Adiciona constraint unique em wa_message_templates para que o upsert
-- com onConflict: 'unit_id,name,category' funcione corretamente.
-- Sem esta constraint, o PostgreSQL rejeitava silenciosamente o ON CONFLICT.
ALTER TABLE wa_message_templates
  ADD CONSTRAINT wa_message_templates_unit_name_cat_key
  UNIQUE (unit_id, name, category);
