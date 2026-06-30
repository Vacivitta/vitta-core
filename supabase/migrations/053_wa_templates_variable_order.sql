-- Guarda a ordem das variáveis nomeadas (nome_cliente, nome_atendente, data, horario)
-- escolhidas na criação do template, para preencher automaticamente {{N}} ao enviar pelo chat.
ALTER TABLE wa_message_templates
  ADD COLUMN IF NOT EXISTS variable_order JSONB NOT NULL DEFAULT '[]'::jsonb;
