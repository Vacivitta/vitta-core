-- ============================================================
-- VITTA CORE CRM — Migration 031: Email em profiles + RLS para gestão de equipe
-- ============================================================

-- 1. Adicionar campo email em profiles
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS email TEXT;

-- 2. Backfill emails dos usuários existentes
UPDATE profiles p
SET    email = u.email
FROM   auth.users u
WHERE  p.id = u.id
  AND  p.email IS NULL;

-- 3. Atualizar trigger para salvar email ao criar usuário
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO profiles (id, full_name, perfil, ativo, email)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email),
    'atendente',
    TRUE,
    NEW.email
  );
  RETURN NEW;
END;
$$;

-- 4. Policy UPDATE ampliada: gestor/admin pode atualizar qualquer perfil
DROP POLICY IF EXISTS "Usuário edita próprio perfil" ON profiles;

CREATE POLICY "profiles_update" ON profiles
  FOR UPDATE USING (
    auth.uid() = id
    OR EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid()
        AND p.perfil IN ('admin', 'gestor_vacivitta', 'gestor_unidade')
    )
  );

-- 5. Policy INSERT para admins/gestores convidarem usuários via service role
--    (o admin Supabase SDK já bypassa RLS, mas fica documentado)
CREATE POLICY "profiles_insert_admin" ON profiles
  FOR INSERT WITH CHECK (true);
