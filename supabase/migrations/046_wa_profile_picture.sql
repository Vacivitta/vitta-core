-- Armazena URL permanente da foto de perfil do contato WhatsApp
ALTER TABLE wa_conversations ADD COLUMN IF NOT EXISTS profile_picture_url text;

-- Bucket público para avatares de contatos WhatsApp
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'wa-avatars',
  'wa-avatars',
  true,
  2097152,
  ARRAY['image/jpeg', 'image/jpg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO UPDATE SET
  public             = true,
  file_size_limit    = 2097152,
  allowed_mime_types = ARRAY['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];

DROP POLICY IF EXISTS "wa_avatars_public_select" ON storage.objects;
DROP POLICY IF EXISTS "wa_avatars_service_insert" ON storage.objects;
DROP POLICY IF EXISTS "wa_avatars_service_update" ON storage.objects;

CREATE POLICY "wa_avatars_public_select"
  ON storage.objects FOR SELECT
  TO public
  USING (bucket_id = 'wa-avatars');

CREATE POLICY "wa_avatars_service_insert"
  ON storage.objects FOR INSERT
  TO service_role
  WITH CHECK (bucket_id = 'wa-avatars');

CREATE POLICY "wa_avatars_service_update"
  ON storage.objects FOR UPDATE
  TO service_role
  USING  (bucket_id = 'wa-avatars')
  WITH CHECK (bucket_id = 'wa-avatars');
