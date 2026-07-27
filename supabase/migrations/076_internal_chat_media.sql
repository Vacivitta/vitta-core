-- Adicionar suporte a mídia no chat interno
ALTER TABLE internal_channel_messages
  ADD COLUMN media_url TEXT,
  ADD COLUMN media_type TEXT,
  ALTER COLUMN conteudo DROP NOT NULL;

-- Bucket para mídia do chat interno
INSERT INTO storage.buckets (id, name, public)
VALUES ('internal-chat-media', 'internal-chat-media', true)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "internal_chat_media_upload" ON storage.objects
  FOR INSERT WITH CHECK (bucket_id = 'internal-chat-media' AND auth.role() = 'authenticated');

CREATE POLICY "internal_chat_media_read" ON storage.objects
  FOR SELECT USING (bucket_id = 'internal-chat-media');
