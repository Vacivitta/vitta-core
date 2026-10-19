-- 087_wa_conversations_status.sql
-- A constraint wa_conversations_status_check (criada fora das migrações) só aceitava
-- 'open' | 'waiting' | 'closed', mas o sistema usa 'open' | 'pending' | 'resolved'.
-- Resolver ou marcar como pendente falhava no banco e toda conversa ficava "aberta".

ALTER TABLE wa_conversations DROP CONSTRAINT IF EXISTS wa_conversations_status_check;

UPDATE wa_conversations SET status = 'resolved' WHERE status = 'closed';
UPDATE wa_conversations SET status = 'pending'  WHERE status = 'waiting';

ALTER TABLE wa_conversations
  ADD CONSTRAINT wa_conversations_status_check
  CHECK (status IN ('open', 'pending', 'resolved'));
