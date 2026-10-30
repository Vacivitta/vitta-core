-- 115_units_tipo_trava_troca.sql
-- Trava a troca de units.tipo (clínica/comercial).
--
-- Por quê: recomendação do Revisor antes da F0-F (criar a unidade comercial).
-- Trocar o tipo de uma unidade que já tem pacientes, conversas ou orçamentos
-- mudaria de lado dados da clínica sem passar por nenhuma transferência. Regra:
--   1. só admin global troca o tipo pelo navegador (anon/authenticated);
--   2. NINGUÉM troca o tipo de unidade que já tenha leads, conversas de WhatsApp
--      ou orçamentos — nem o servidor (service_role). Se for mesmo preciso, é uma
--      operação de banco aprovada pelo Pedro, com o trigger desligado na mesma
--      transação e registrada.
-- Criar unidade nova já como 'comercial' (INSERT) continua livre.
--
-- Depende da 093 (units.tipo). Aplicar em produção é [H]: o Infra aplica, com
-- aprovação e backup do dia, como supabase_admin, com --single-transaction;
-- depois registra a versão 115. Sem BEGIN/COMMIT. Idempotente.
-- Reversão (só com aprovação):
--   DROP TRIGGER IF EXISTS trg_guard_unit_tipo ON public.units;
--   DROP FUNCTION IF EXISTS public.fn_guard_unit_tipo();

SET LOCAL lock_timeout = '5s';

DO $$
BEGIN
  IF current_setting('lock_timeout') <> '5s' THEN
    RAISE EXCEPTION '115: rode com --single-transaction (lock_timeout atual: %)', current_setting('lock_timeout');
  END IF;
  IF current_user <> 'supabase_admin' THEN
    RAISE EXCEPTION '115: rodar como supabase_admin (atual: %)', current_user;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'units' AND column_name = 'tipo') THEN
    RAISE EXCEPTION '115: depende da 093 (coluna units.tipo não existe)';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.fn_guard_unit_tipo()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.tipo IS NOT DISTINCT FROM OLD.tipo THEN
    RETURN NEW;
  END IF;

  IF COALESCE(auth.role(), '') IN ('anon', 'authenticated') AND NOT is_global_admin() THEN
    RAISE EXCEPTION 'Só um administrador global muda o tipo da unidade'
      USING ERRCODE = '42501';
  END IF;

  IF EXISTS (SELECT 1 FROM leads            WHERE unit_id = OLD.id)
     OR EXISTS (SELECT 1 FROM wa_conversations WHERE unit_id = OLD.id)
     OR EXISTS (SELECT 1 FROM quotes           WHERE unit_id = OLD.id) THEN
    RAISE EXCEPTION 'A unidade já tem leads, conversas ou orçamentos; o tipo não pode mudar'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$function$;

-- Função de trigger: o EXECUTE só é checado ao criar o trigger
REVOKE EXECUTE ON FUNCTION public.fn_guard_unit_tipo() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.fn_guard_unit_tipo() TO service_role;

DROP TRIGGER IF EXISTS trg_guard_unit_tipo ON public.units;
CREATE TRIGGER trg_guard_unit_tipo
  BEFORE UPDATE OF tipo ON public.units
  FOR EACH ROW EXECUTE FUNCTION public.fn_guard_unit_tipo();

-- Guarda
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger
                  WHERE tgrelid = 'public.units'::regclass AND tgname = 'trg_guard_unit_tipo' AND NOT tgisinternal) THEN
    RAISE EXCEPTION '115: trigger trg_guard_unit_tipo não foi criado';
  END IF;
  IF has_function_privilege('authenticated', 'public.fn_guard_unit_tipo()', 'EXECUTE')
     OR has_function_privilege('anon', 'public.fn_guard_unit_tipo()', 'EXECUTE') THEN
    RAISE EXCEPTION '115: fn_guard_unit_tipo com EXECUTE indevido';
  END IF;
END $$;
