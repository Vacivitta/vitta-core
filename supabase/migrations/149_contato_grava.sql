-- 149_contato_grava.sql
-- Contato separado do Negócio, etapa 5c1: o app grava a pessoa no contato (Fase 3·2,
-- entrega 5; ADR 0001).
--
-- Por quê: na 5b o app passou a ler a pessoa de contatos. Para um contato ter vários
-- negócios (5c2), a pessoa precisa ser gravada num lugar só, o contato, e cada
-- negócio dele acompanhar. Até a 5d remover as colunas de pessoa de leads, os dois
-- lados ficam iguais nos dois sentidos.
--
-- O que faz:
--   1. O app (authenticated) pode alterar a pessoa do contato titular da própria
--      unidade: só as colunas de pessoa (GRANT por coluna). Unidade, cliente,
--      responsável e relação continuam só do banco; dependentes continuam sendo
--      gravados em lead_contacts (espelho da 148) até a 5c2.
--   2. Espelho contato → leads: mudar a pessoa do contato atualiza todos os negócios
--      dele (as colunas de pessoa; não a unidade nem is_converted).
--   3. Espelho lead → contato (148) passa a gravar só quando algo mudou. Com os dois
--      sentidos filtrando "mudou de fato", a volta não acha diferença e para: o lead
--      alterado atualiza o contato, o contato atualiza os outros negócios dele, e
--      esses não acham mais nada a copiar.
--
-- Aplicar em produção é [H]: o Infra aplica, com aprovação e backup do dia, como
-- supabase_admin, com --single-transaction; depois registra a versão '149' e roda
-- notify pgrst, 'reload schema'. Sem BEGIN/COMMIT. Idempotente. Antes do deploy do
-- app: o app novo grava em contatos.
--
-- Reversão:
--   DROP TRIGGER IF EXISTS trg_contato_espelho ON public.contatos;
--   DROP TRIGGER IF EXISTS trg_contato_atualizado ON public.contatos;
--   DROP FUNCTION IF EXISTS public.fn_contato_espelho(), public.fn_contato_atualizado();
--   DROP POLICY IF EXISTS contatos_update ON public.contatos;
--   REVOKE UPDATE ON public.contatos FROM authenticated;
--   (e reaplicar a 148 para voltar fn_lead_contato_espelho sem o filtro)

SET LOCAL lock_timeout = '5s';

DO $$
BEGIN
  IF current_setting('lock_timeout') <> '5s' THEN
    RAISE EXCEPTION '149: rode com --single-transaction (lock_timeout atual: %)', current_setting('lock_timeout');
  END IF;
  IF current_user <> 'supabase_admin' THEN
    RAISE EXCEPTION '149: rodar como supabase_admin (atual: %)', current_user;
  END IF;
END $$;

-- ── 1. O app altera a pessoa do contato titular ──────────────────────────────
REVOKE UPDATE ON public.contatos FROM authenticated;
GRANT UPDATE (nome, sobrenome, telefone, email, cpf, data_nascimento, profissao, cidade, estado, pais,
              instagram, site, observacoes, wa_optin_at, wa_optout_at)
  ON public.contatos TO authenticated;

DROP POLICY IF EXISTS contatos_update ON public.contatos;
CREATE POLICY contatos_update ON public.contatos FOR UPDATE TO authenticated
  USING (
    responsavel_id IS NULL
    AND ((SELECT public.is_global_admin())
         OR unit_id IN (SELECT uu.unit_id FROM public.user_units uu WHERE uu.user_id = (SELECT auth.uid())))
  )
  WITH CHECK (
    responsavel_id IS NULL
    AND ((SELECT public.is_global_admin())
         OR unit_id IN (SELECT uu.unit_id FROM public.user_units uu WHERE uu.user_id = (SELECT auth.uid())))
  );

-- ── 2. Espelho contato → negócios ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_contato_espelho()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  IF NEW.responsavel_id IS NOT NULL THEN
    RETURN NULL;
  END IF;
  UPDATE public.leads l
     SET nome = NEW.nome, sobrenome = NEW.sobrenome, telefone = NEW.telefone, email = NEW.email, cpf = NEW.cpf,
         data_nascimento = NEW.data_nascimento, profissao = NEW.profissao, cidade = NEW.cidade,
         estado = NEW.estado, pais = NEW.pais, instagram = NEW.instagram, site = NEW.site,
         observacoes_cli = NEW.observacoes, wa_optin_at = NEW.wa_optin_at, wa_optout_at = NEW.wa_optout_at
   WHERE l.contato_id = NEW.id
     AND (l.nome, l.sobrenome, l.telefone, l.email, l.cpf, l.data_nascimento, l.profissao, l.cidade, l.estado,
          l.pais, l.instagram, l.site, l.observacoes_cli, l.wa_optin_at, l.wa_optout_at)
         IS DISTINCT FROM
         (NEW.nome, NEW.sobrenome, NEW.telefone, NEW.email, NEW.cpf, NEW.data_nascimento, NEW.profissao,
          NEW.cidade, NEW.estado, NEW.pais, NEW.instagram, NEW.site, NEW.observacoes, NEW.wa_optin_at,
          NEW.wa_optout_at);
  RETURN NULL;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.fn_contato_espelho() FROM PUBLIC, anon, authenticated;

-- AFTER: quando o espelho do lead (abaixo) compara, o contato já tem os valores
-- novos e não há diferença para voltar. Num BEFORE ele veria o contato antigo e
-- tentaria alterar a linha que está sendo alterada.
DROP TRIGGER IF EXISTS trg_contato_espelho ON public.contatos;
CREATE TRIGGER trg_contato_espelho AFTER UPDATE OF nome, sobrenome, telefone, email, cpf, data_nascimento,
  profissao, cidade, estado, pais, instagram, site, observacoes, wa_optin_at, wa_optout_at
  ON public.contatos FOR EACH ROW EXECUTE FUNCTION public.fn_contato_espelho();

-- atualizado_em de qualquer alteração (o app passa a alterar contatos)
CREATE OR REPLACE FUNCTION public.fn_contato_atualizado()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
BEGIN
  NEW.atualizado_em := now();
  RETURN NEW;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.fn_contato_atualizado() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_contato_atualizado ON public.contatos;
CREATE TRIGGER trg_contato_atualizado BEFORE UPDATE ON public.contatos
  FOR EACH ROW EXECUTE FUNCTION public.fn_contato_atualizado();

-- ── 3. Espelho lead → contato só quando algo mudou ───────────────────────────
CREATE OR REPLACE FUNCTION public.fn_lead_contato_espelho()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  UPDATE public.contatos c
     SET unit_id = NEW.unit_id, nome = NEW.nome, sobrenome = NEW.sobrenome, telefone = NEW.telefone,
         email = NEW.email, cpf = NEW.cpf, data_nascimento = NEW.data_nascimento, profissao = NEW.profissao,
         cidade = NEW.cidade, estado = NEW.estado, pais = NEW.pais, instagram = NEW.instagram, site = NEW.site,
         observacoes = NEW.observacoes_cli, cliente = coalesce(NEW.is_converted, false),
         wa_optin_at = NEW.wa_optin_at, wa_optout_at = NEW.wa_optout_at, atualizado_em = now()
   WHERE c.id = NEW.contato_id
     AND (c.unit_id, c.nome, c.sobrenome, c.telefone, c.email, c.cpf, c.data_nascimento, c.profissao, c.cidade,
          c.estado, c.pais, c.instagram, c.site, c.observacoes, c.cliente, c.wa_optin_at, c.wa_optout_at)
         IS DISTINCT FROM
         (NEW.unit_id, NEW.nome, NEW.sobrenome, NEW.telefone, NEW.email, NEW.cpf, NEW.data_nascimento,
          NEW.profissao, NEW.cidade, NEW.estado, NEW.pais, NEW.instagram, NEW.site, NEW.observacoes_cli,
          coalesce(NEW.is_converted, false), NEW.wa_optin_at, NEW.wa_optout_at);
  IF NEW.unit_id IS DISTINCT FROM OLD.unit_id THEN
    UPDATE public.contatos SET unit_id = NEW.unit_id, atualizado_em = now() WHERE responsavel_id = NEW.contato_id;
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.fn_lead_contato_espelho() FROM PUBLIC, anon, authenticated;

-- ── Conferência ──────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF has_table_privilege('authenticated', 'public.contatos', 'INSERT')
     OR has_table_privilege('authenticated', 'public.contatos', 'DELETE')
     OR has_column_privilege('authenticated', 'public.contatos', 'unit_id', 'UPDATE')
     OR has_column_privilege('authenticated', 'public.contatos', 'responsavel_id', 'UPDATE')
     OR has_column_privilege('authenticated', 'public.contatos', 'cliente', 'UPDATE')
     OR NOT has_column_privilege('authenticated', 'public.contatos', 'telefone', 'UPDATE') THEN
    RAISE EXCEPTION '149: privilégios de contatos para authenticated não ficaram como o esperado';
  END IF;
END $$;
