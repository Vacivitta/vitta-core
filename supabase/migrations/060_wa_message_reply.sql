-- Adiciona coluna para armazenar o wa_message_id da mensagem citada (reply/quote)
ALTER TABLE wa_messages
  ADD COLUMN IF NOT EXISTS reply_to_wa_message_id TEXT;
