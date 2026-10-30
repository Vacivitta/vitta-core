-- 117_profiles_update_sem_recursao.sql
-- RLS de profiles: a policy de UPDATE deixa de consultar a própria tabela.
--
-- Por quê: a profiles_update (031) testava "é gestor?" com um EXISTS em
-- profiles dentro da policy de profiles. O Postgres recusa isso com
-- "infinite recursion detected in policy for relation profiles", e TODO UPDATE
-- de profiles pelo navegador falhava. O sintoma visível: o seletor de unidade
-- (ProfileContext.switchUnit) não troca a unidade ativa. Confirmado em 30/10 na
-- produção e numa cópia do backup anterior às migrações 091–116 (não é efeito
-- delas).
--
-- O que faz: recria a policy com a mesma regra (o próprio usuário, ou perfil
-- admin/gestor_vacivitta/gestor_unidade), usando is_gestor() da 113, que é
-- SECURITY DEFINER e lê profiles sem passar pelo RLS. As colunas que cada um
-- pode mudar continuam travadas pelo trigger trg_guard_profile_privileges (085).
--
-- Aplicar em produção é [H]: o Infra aplica, com aprovação e backup do dia, como
-- supabase_admin, com --single-transaction; depois registra a versão '117'.
-- Sem BEGIN/COMMIT. Idempotente. Reversão no fim do arquivo (comentada).

SET LOCAL lock_timeout = '5s';

DO $$
BEGIN
  IF current_setting('lock_timeout') <> '5s' THEN
    RAISE EXCEPTION '117: rode com --single-transaction (lock_timeout atual: %)', current_setting('lock_timeout');
  END IF;
  IF current_user <> 'supabase_admin' THEN
    RAISE EXCEPTION '117: rodar como supabase_admin (atual: %)', current_user;
  END IF;
  IF to_regprocedure('public.is_gestor()') IS NULL THEN
    RAISE EXCEPTION '117: depende da 113 (is_gestor)';
  END IF;
END $$;

DROP POLICY IF EXISTS "profiles_update" ON public.profiles;
CREATE POLICY "profiles_update" ON public.profiles AS PERMISSIVE FOR UPDATE TO public
  USING (
    (SELECT auth.uid()) = id
    OR (SELECT is_gestor())
  );

-- ── Guarda ───────────────────────────────────────────────────────────────────
-- A policy nova não pode consultar profiles (era a causa da recursão), e não
-- pode sobrar outra policy PERMISSIVE de UPDATE/ALL que reabra a regra.
DO $$
DECLARE outras text;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies
              WHERE schemaname = 'public' AND tablename = 'profiles' AND policyname = 'profiles_update'
                AND qual ~* 'from\s+profiles') THEN
    RAISE EXCEPTION '117: profiles_update ainda consulta profiles';
  END IF;
  SELECT string_agg(policyname, ', ') INTO outras
    FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'profiles'
     AND cmd IN ('UPDATE', 'ALL') AND permissive = 'PERMISSIVE'
     AND policyname <> 'profiles_update';
  IF outras IS NOT NULL THEN
    RAISE EXCEPTION '117: outras policies de UPDATE/ALL em profiles: %', outras;
  END IF;
END $$;

-- ── Reversão (só com aprovação; como supabase_admin, --single-transaction) ────
-- Volta a policy da 031 (com a recursão; o UPDATE pelo navegador volta a falhar):
-- DROP POLICY IF EXISTS "profiles_update" ON public.profiles;
-- CREATE POLICY "profiles_update" ON public.profiles FOR UPDATE USING (
--   (SELECT auth.uid()) = id
--   OR EXISTS (SELECT 1 FROM profiles p WHERE p.id = (SELECT auth.uid())
--              AND p.perfil = ANY (ARRAY['admin', 'gestor_vacivitta', 'gestor_unidade'])));
