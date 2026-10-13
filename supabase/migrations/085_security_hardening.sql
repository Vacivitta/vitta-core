-- 085_security_hardening.sql
-- Fecha acessos que a chave pública (anon), exposta no navegador, permitia.
--
-- 1. quotes / quote_items: a 018 criou policies USING (true) para SELECT/UPDATE.
--    Qualquer pessoa lia orçamentos de todas as unidades (com nomes de pacientes)
--    e alterava valores/status. O link público agora é servido só pelo servidor
--    (service-role filtrando por token_publico): page.tsx e /api/orcamento/respond.
-- 2. RPCs SECURITY DEFINER executáveis por anon: permitiam mover/arquivar leads de
--    qualquer unidade e criar notificações falsas.
-- 3. profiles: qualquer usuário podia mudar o próprio perfil para 'admin', e
--    qualquer pessoa podia inserir perfis.

-- ── 1. Orçamentos ───────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "quotes_public_read"          ON quotes;
DROP POLICY IF EXISTS "quotes_public_update_status" ON quotes;
DROP POLICY IF EXISTS "quote_items_public_read"     ON quote_items;

-- ── 2. RPCs ─────────────────────────────────────────────────────────────────
-- Só o servidor (service_role) chama estas
REVOKE EXECUTE ON FUNCTION execute_quote_automation(uuid, uuid, text, text)                  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION create_quote_notification(uuid, uuid, text, text, text, uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION increment_wa_unread(uuid)                                          FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION execute_quote_automation(uuid, uuid, text, text)                  TO service_role;
GRANT  EXECUTE ON FUNCTION create_quote_notification(uuid, uuid, text, text, text, uuid, uuid) TO service_role;
GRANT  EXECUTE ON FUNCTION increment_wa_unread(uuid)                                          TO service_role;

-- Chamadas por usuários logados (navegador / server components) — só remove anon
REVOKE EXECUTE ON FUNCTION record_stage_history(uuid, uuid, uuid, uuid)       FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION record_stage_history(uuid, uuid, uuid, uuid, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION get_agent_stats(uuid)                              FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION record_stage_history(uuid, uuid, uuid, uuid)       TO authenticated, service_role;
GRANT  EXECUTE ON FUNCTION record_stage_history(uuid, uuid, uuid, uuid, text) TO authenticated, service_role;
GRANT  EXECUTE ON FUNCTION get_agent_stats(uuid)                              TO authenticated, service_role;

-- ── 3. Perfis ───────────────────────────────────────────────────────────────
-- Perfis são criados pelo trigger handle_new_user (SECURITY DEFINER) e pela
-- API de admin (service-role); nenhum cliente precisa inserir direto.
DROP POLICY IF EXISTS "profiles_insert_admin" ON profiles;

-- A policy profiles_update não restringe colunas. Este trigger bloqueia mudança
-- de campos de privilégio vinda do navegador; a API /api/admin/users (service-role)
-- continua podendo alterá-los.
CREATE OR REPLACE FUNCTION fn_guard_profile_privileges()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Só restringe requisições do PostgREST com JWT de cliente
  IF COALESCE(auth.role(), '') NOT IN ('anon', 'authenticated') THEN
    RETURN NEW;
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.email IS DISTINCT FROM OLD.email
     OR ((NEW.perfil IS DISTINCT FROM OLD.perfil OR NEW.ativo IS DISTINCT FROM OLD.ativo)
         AND NOT is_global_admin()) THEN
    RAISE EXCEPTION 'Alteração de perfil, status ou e-mail não permitida' USING ERRCODE = '42501';
  END IF;

  -- Troca de unidade ativa: só para unidades às quais o usuário está vinculado
  IF NEW.unit_id IS DISTINCT FROM OLD.unit_id
     AND NEW.unit_id IS NOT NULL
     AND NOT is_global_admin()
     AND NOT EXISTS (SELECT 1 FROM user_units WHERE user_id = NEW.id AND unit_id = NEW.unit_id) THEN
    RAISE EXCEPTION 'Unidade não vinculada ao usuário' USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION fn_guard_profile_privileges() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_guard_profile_privileges ON profiles;
CREATE TRIGGER trg_guard_profile_privileges
  BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION fn_guard_profile_privileges();
