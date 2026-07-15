-- ============================================================================
-- Migration 064: Bucket para mídia do WhatsApp (imagens, áudios, vídeos, docs)
--
-- Media IDs do Meta expiram em ~30 dias. O webhook agora faz download
-- imediato e persiste no Supabase Storage para acesso permanente.
-- ============================================================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'wa-media',
  'wa-media',
  true,
  52428800,
  ARRAY[
    'image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif',
    'audio/ogg', 'audio/ogg; codecs=opus', 'audio/mpeg', 'audio/mp4', 'audio/aac', 'audio/amr',
    'video/mp4', 'video/3gpp',
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/octet-stream'
  ]
)
ON CONFLICT (id) DO UPDATE SET
  public             = true,
  file_size_limit    = 52428800,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Leitura pública (mídia exibida no chat)
DROP POLICY IF EXISTS "wa_media_public_select" ON storage.objects;
CREATE POLICY "wa_media_public_select"
  ON storage.objects FOR SELECT
  TO public
  USING (bucket_id = 'wa-media');

-- Upload via service role (webhook)
DROP POLICY IF EXISTS "wa_media_service_insert" ON storage.objects;
CREATE POLICY "wa_media_service_insert"
  ON storage.objects FOR INSERT
  TO service_role
  WITH CHECK (bucket_id = 'wa-media');

-- Upsert via service role
DROP POLICY IF EXISTS "wa_media_service_update" ON storage.objects;
CREATE POLICY "wa_media_service_update"
  ON storage.objects FOR UPDATE
  TO service_role
  USING  (bucket_id = 'wa-media')
  WITH CHECK (bucket_id = 'wa-media');
