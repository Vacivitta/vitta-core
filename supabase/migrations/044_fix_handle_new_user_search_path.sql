-- ── Migration 044: corrige handle_new_user (search_path) ──────────────────────
-- O trigger on_auth_user_created → handle_new_user falhava com
-- "relation \"profiles\" does not exist" ao convidar/registrar usuário.
--
-- Causa: a função é SECURITY DEFINER mas não fixava search_path e referenciava
-- "profiles" sem qualificar o schema. Quando o GoTrue (auth) executa o trigger
-- (ex.: POST /invite), o search_path não inclui "public", então o nome não
-- resolve. Erro: "Database error saving new user" (HTTP 500).
--
-- Correção: qualifica public.profiles e fixa search_path na função.

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  INSERT INTO public.profiles (id, full_name, perfil, ativo, email)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email),
    'atendente',
    TRUE,
    NEW.email
  );
  RETURN NEW;
END;
$function$;
