-- Armazena prévia da última mensagem na conversa para exibir na lista
ALTER TABLE wa_conversations
  ADD COLUMN IF NOT EXISTS last_message_content   text,
  ADD COLUMN IF NOT EXISTS last_message_direction text CHECK (last_message_direction IN ('inbound', 'outbound'));
