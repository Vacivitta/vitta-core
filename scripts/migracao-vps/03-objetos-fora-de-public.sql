-- Etapa 2b — objetos que o dump do schema public não leva.
-- Levantados no Supabase de origem em out/2026.

-- ── Trigger que cria o perfil ao cadastrar usuário ────────────────────────────
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ── Policies de storage.objects ───────────────────────────────────────────────
DROP POLICY IF EXISTS internal_chat_media_read   ON storage.objects;
DROP POLICY IF EXISTS internal_chat_media_upload ON storage.objects;
DROP POLICY IF EXISTS quote_templates_auth_delete   ON storage.objects;
DROP POLICY IF EXISTS quote_templates_auth_insert   ON storage.objects;
DROP POLICY IF EXISTS quote_templates_auth_update   ON storage.objects;
DROP POLICY IF EXISTS quote_templates_public_select ON storage.objects;
DROP POLICY IF EXISTS wa_avatars_public_select   ON storage.objects;
DROP POLICY IF EXISTS wa_avatars_service_insert  ON storage.objects;
DROP POLICY IF EXISTS wa_avatars_service_update  ON storage.objects;
DROP POLICY IF EXISTS wa_media_public_select     ON storage.objects;
DROP POLICY IF EXISTS wa_media_service_insert    ON storage.objects;
DROP POLICY IF EXISTS wa_media_service_update    ON storage.objects;

CREATE POLICY internal_chat_media_read   ON storage.objects FOR SELECT USING (bucket_id = 'internal-chat-media');
CREATE POLICY internal_chat_media_upload ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'internal-chat-media' AND (SELECT auth.role()) = 'authenticated');

CREATE POLICY quote_templates_public_select ON storage.objects FOR SELECT USING (bucket_id = 'quote-templates');
CREATE POLICY quote_templates_auth_insert   ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'quote-templates');
CREATE POLICY quote_templates_auth_update   ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'quote-templates') WITH CHECK (bucket_id = 'quote-templates');
CREATE POLICY quote_templates_auth_delete   ON storage.objects FOR DELETE TO authenticated USING (bucket_id = 'quote-templates');

CREATE POLICY wa_avatars_public_select  ON storage.objects FOR SELECT USING (bucket_id = 'wa-avatars');
CREATE POLICY wa_avatars_service_insert ON storage.objects FOR INSERT TO service_role WITH CHECK (bucket_id = 'wa-avatars');
CREATE POLICY wa_avatars_service_update ON storage.objects FOR UPDATE TO service_role
  USING (bucket_id = 'wa-avatars') WITH CHECK (bucket_id = 'wa-avatars');

CREATE POLICY wa_media_public_select  ON storage.objects FOR SELECT USING (bucket_id = 'wa-media');
CREATE POLICY wa_media_service_insert ON storage.objects FOR INSERT TO service_role WITH CHECK (bucket_id = 'wa-media');
CREATE POLICY wa_media_service_update ON storage.objects FOR UPDATE TO service_role
  USING (bucket_id = 'wa-media') WITH CHECK (bucket_id = 'wa-media');

-- ── Realtime: tabelas publicadas ─────────────────────────────────────────────
DO $$
DECLARE t text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    CREATE PUBLICATION supabase_realtime;
  END IF;
  FOREACH t IN ARRAY ARRAY['internal_messages','leads','notifications','wa_conversations',
                           'wa_internal_notes','wa_messages','wa_queues'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = t) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    END IF;
  END LOOP;
END $$;
