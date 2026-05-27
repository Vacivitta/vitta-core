-- Migration 005: User roles
-- Adds role column to profiles table

ALTER TABLE profiles
  ADD COLUMN role TEXT NOT NULL DEFAULT 'operador'
  CHECK (role IN ('gestor', 'operador'));

-- Set Pedro Araújo as gestor
UPDATE profiles
  SET role = 'gestor'
  WHERE id = (
    SELECT id FROM auth.users
    WHERE email = 'pedro.araujo@vacivitta.com.br'
  );
