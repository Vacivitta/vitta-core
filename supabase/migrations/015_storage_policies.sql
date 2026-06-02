-- ============================================================
-- VITTA CORE CRM — Migration 015: Políticas de Storage
-- Cria o bucket quote-templates e configura RLS para upload
-- ============================================================

-- Criar bucket (ou atualizar se já existir)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'quote-templates',
  'quote-templates',
  true,
  10485760,  -- 10 MB por arquivo
  ARRAY['image/jpeg', 'image/jpg', 'image/png']
)
ON CONFLICT (id) DO UPDATE SET
  public             = true,
  file_size_limit    = 10485760,
  allowed_mime_types = ARRAY['image/jpeg', 'image/jpg', 'image/png'];

-- Limpar políticas anteriores (idempotente)
DROP POLICY IF EXISTS "quote_templates_public_select"      ON storage.objects;
DROP POLICY IF EXISTS "quote_templates_auth_insert"        ON storage.objects;
DROP POLICY IF EXISTS "quote_templates_auth_update"        ON storage.objects;
DROP POLICY IF EXISTS "quote_templates_auth_delete"        ON storage.objects;

-- Leitura pública (URLs públicas funcionam para qualquer pessoa)
CREATE POLICY "quote_templates_public_select"
  ON storage.objects FOR SELECT
  TO public
  USING (bucket_id = 'quote-templates');

-- Upload: qualquer usuário autenticado
CREATE POLICY "quote_templates_auth_insert"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'quote-templates');

-- Substituir arquivo existente (upsert)
CREATE POLICY "quote_templates_auth_update"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING  (bucket_id = 'quote-templates')
  WITH CHECK (bucket_id = 'quote-templates');

-- Remover arquivo
CREATE POLICY "quote_templates_auth_delete"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id = 'quote-templates');
