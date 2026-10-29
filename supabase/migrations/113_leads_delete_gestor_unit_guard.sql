-- 113_leads_delete_gestor_unit_guard.sql
-- RLS de leads: só gestor/admin apaga lead; troca de unit_id só pelo servidor.
--
-- Por quê: as rotas do app (api/leads/delete, api/leads/transfer) já exigem
-- gestor/admin, mas o RLS da 067 deixava QUALQUER membro da unidade apagar lead e
-- mudar unit_id direto pelo PostgREST (chave pública + sessão de atendente).
--
-- O que faz:
--   1. is_gestor(): SECURITY DEFINER no padrão de is_global_admin() (lê profiles
--      sem recursão de RLS). EXECUTE só para authenticated/service_role.
--   2. DELETE em leads: admin global, ou gestor (admin, gestor_vacivitta,
--      gestor_unidade) vinculado à unidade do lead em user_units. service_role
--      ignora RLS e continua apagando (api/leads/delete).
--   3. Trigger BEFORE UPDATE OF unit_id: bloqueia troca de unidade vinda do
--      navegador (anon/authenticated), salvo admin global. service_role (a rota
--      api/leads/transfer) e o próprio banco passam.
--   SELECT, INSERT e UPDATE de outras colunas não mudam.
--
-- Aplicar em produção é [H]: o Infra aplica, com aprovação e backup do dia, como
-- supabase_admin, com --single-transaction; depois registra a versão '113'.
-- Sem BEGIN/COMMIT. Idempotente. Reversão no fim do arquivo (comentada).

SET LOCAL lock_timeout = '5s';

DO $$
BEGIN
  IF current_setting('lock_timeout') <> '5s' THEN
    RAISE EXCEPTION '113: rode com --single-transaction (lock_timeout atual: %)', current_setting('lock_timeout');
  END IF;
  IF current_user <> 'supabase_admin' THEN
    RAISE EXCEPTION '113: rodar como supabase_admin (atual: %)', current_user;
  END IF;
END $$;

-- ── 1. is_gestor() ───────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.is_gestor()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM profiles
    WHERE id = auth.uid()
      AND perfil IN ('admin', 'gestor_vacivitta', 'gestor_unidade')
  );
$function$;

REVOKE EXECUTE ON FUNCTION public.is_gestor() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.is_gestor() TO authenticated, service_role;

-- ── 2. DELETE em leads ───────────────────────────────────────────────────────
DROP POLICY IF EXISTS "unit_members_leads_delete" ON public.leads;
DROP POLICY IF EXISTS "gestores_leads_delete"     ON public.leads;
CREATE POLICY "gestores_leads_delete" ON public.leads AS PERMISSIVE FOR DELETE TO public
  USING (
    (SELECT is_global_admin())
    OR ((SELECT is_gestor())
        AND unit_id IN (SELECT unit_id FROM user_units WHERE user_id = (SELECT auth.uid())))
  );

-- ── 3. Troca de unit_id só pelo servidor ─────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_guard_lead_unit_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.unit_id IS DISTINCT FROM OLD.unit_id
     AND COALESCE(auth.role(), '') IN ('anon', 'authenticated')
     AND NOT is_global_admin() THEN
    RAISE EXCEPTION 'Troca de unidade do lead só pela transferência (api/leads/transfer)'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$function$;

-- Função de trigger: o EXECUTE só é checado ao criar o trigger
REVOKE EXECUTE ON FUNCTION public.fn_guard_lead_unit_change() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.fn_guard_lead_unit_change() TO service_role;

DROP TRIGGER IF EXISTS trg_guard_lead_unit_change ON public.leads;
CREATE TRIGGER trg_guard_lead_unit_change
  BEFORE UPDATE OF unit_id ON public.leads
  FOR EACH ROW EXECUTE FUNCTION public.fn_guard_lead_unit_change();

-- ── Guarda ───────────────────────────────────────────────────────────────────
-- Policies são somadas (OR): se existir qualquer outra policy PERMISSIVE de
-- DELETE/ALL em leads (por exemplo, criada fora das migrações), a regra nova não
-- vale. Aborta nesse caso.
DO $$
DECLARE outras text;
BEGIN
  SELECT string_agg(policyname, ', ') INTO outras
    FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'leads'
     AND cmd IN ('DELETE', 'ALL') AND permissive = 'PERMISSIVE'
     AND policyname <> 'gestores_leads_delete';
  IF outras IS NOT NULL THEN
    RAISE EXCEPTION '113: outras policies de DELETE/ALL em leads anulariam a regra: %', outras;
  END IF;
  IF has_function_privilege('anon', 'public.is_gestor()', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.is_gestor()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.fn_guard_lead_unit_change()', 'EXECUTE') THEN
    RAISE EXCEPTION '113: privilégios inesperados em is_gestor/fn_guard_lead_unit_change';
  END IF;
END $$;

-- ── Reversão (só com aprovação; como supabase_admin, --single-transaction) ────
-- DROP TRIGGER IF EXISTS trg_guard_lead_unit_change ON public.leads;
-- DROP FUNCTION IF EXISTS public.fn_guard_lead_unit_change();
-- DROP POLICY IF EXISTS "gestores_leads_delete" ON public.leads;
-- CREATE POLICY "unit_members_leads_delete" ON public.leads FOR DELETE
--   USING ((SELECT is_global_admin()) OR unit_id IN (SELECT unit_id FROM user_units WHERE user_id = (SELECT auth.uid())));
-- DROP FUNCTION IF EXISTS public.is_gestor();
