-- 146_modulos.sql
-- Módulos ligáveis por unidade (Fase 3·2, entrega 4).
--
-- Por quê: Empresas, Tickets, Orçamentos, Catálogo, Campanhas e QR Code valem
-- para algumas unidades e não para outras (decisão de 05/11/2026: "ligáveis em
-- qualquer unidade e somem da tela quando desligados"). Uma clínica não usa
-- Empresas; o comercial de licenças não usa Catálogo de vacinas.
--
-- O que faz:
--   1. unidade_modulos (unit_id, modulo, ativo): só a exceção ao padrão. Sem
--      linha, vale o padrão: Orçamentos, Catálogo e Campanhas ligados (já existem
--      em todas as unidades); QR Code, Empresas e Tickets desligados (novos).
--   2. modulo_ativo(unidade, modulo): a regra num lugar só (SECURITY INVOKER).
--   3. fn_exige_modulo(modulo): trigger BEFORE INSERT que recusa (23514) criar
--      orçamento, item de catálogo, campanha ou conexão por QR Code numa unidade
--      com o módulo desligado. Só INSERT: o que já existe continua editável e
--      visível, e desligar não apaga nada. Empresas e Tickets ganham o mesmo
--      trigger nas próprias migrações.
--   4. RLS: quem está na unidade lê; só a marca (is_global_admin) liga e desliga.
--
-- Aplicar em produção é [H]: o Infra aplica, com aprovação e backup do dia, como
-- supabase_admin, com --single-transaction; depois registra a versão '146' e roda
-- notify pgrst, 'reload schema'. Sem BEGIN/COMMIT. Idempotente. Antes do deploy
-- do app desta versão (o menu lê unidade_modulos). Não muda nada para as unidades
-- de hoje: os módulos em uso nascem ligados.
--
-- Reversão:
--   DROP TRIGGER IF EXISTS trg_modulo_orcamentos ON public.quotes;
--   DROP TRIGGER IF EXISTS trg_modulo_catalogo ON public.products;
--   DROP TRIGGER IF EXISTS trg_modulo_campanhas ON public.wa_campaigns;
--   DROP TRIGGER IF EXISTS trg_modulo_qrcode ON public.conexoes;
--   DROP FUNCTION IF EXISTS public.fn_exige_modulo(), public.modulo_ativo(uuid, text);
--   DROP TABLE IF EXISTS public.unidade_modulos;

SET LOCAL lock_timeout = '5s';

DO $$
BEGIN
  IF current_setting('lock_timeout') <> '5s' THEN
    RAISE EXCEPTION '146: rode com --single-transaction (lock_timeout atual: %)', current_setting('lock_timeout');
  END IF;
  IF current_user <> 'supabase_admin' THEN
    RAISE EXCEPTION '146: rodar como supabase_admin (atual: %)', current_user;
  END IF;
END $$;

-- ── 1. Exceções ao padrão ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.unidade_modulos (
  unit_id       uuid        NOT NULL REFERENCES public.units (id) ON DELETE CASCADE,
  modulo        text        NOT NULL CHECK (modulo IN ('orcamentos', 'catalogo', 'campanhas', 'qrcode', 'empresas', 'tickets')),
  ativo         boolean     NOT NULL,
  alterado_em   timestamptz NOT NULL DEFAULT now(),
  alterado_por  uuid        REFERENCES public.profiles (id) ON DELETE SET NULL,
  PRIMARY KEY (unit_id, modulo)
);

ALTER TABLE public.unidade_modulos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.unidade_modulos FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.unidade_modulos TO authenticated;
GRANT ALL ON public.unidade_modulos TO service_role;

DROP POLICY IF EXISTS unidade_modulos_select ON public.unidade_modulos;
CREATE POLICY unidade_modulos_select ON public.unidade_modulos FOR SELECT TO authenticated USING (
  (SELECT public.is_global_admin())
  OR unit_id IN (SELECT uu.unit_id FROM public.user_units uu WHERE uu.user_id = (SELECT auth.uid()))
);
DROP POLICY IF EXISTS unidade_modulos_marca ON public.unidade_modulos;
CREATE POLICY unidade_modulos_marca ON public.unidade_modulos FOR ALL TO authenticated
  USING ((SELECT public.is_global_admin())) WITH CHECK ((SELECT public.is_global_admin()));

-- ── 2. A regra ───────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.modulo_ativo(p_unit uuid, p_modulo text)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO public
AS $function$
  SELECT coalesce(
    (SELECT um.ativo FROM public.unidade_modulos um WHERE um.unit_id = p_unit AND um.modulo = p_modulo),
    p_modulo IN ('orcamentos', 'catalogo', 'campanhas')
  )
$function$;

REVOKE EXECUTE ON FUNCTION public.modulo_ativo(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.modulo_ativo(uuid, text) TO authenticated, service_role;

-- ── 3. Criar só com o módulo ligado ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_exige_modulo()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO public
AS $function$
BEGIN
  IF NOT public.modulo_ativo(NEW.unit_id, TG_ARGV[0]) THEN
    RAISE EXCEPTION 'O módulo % está desligado nesta unidade', TG_ARGV[0] USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.fn_exige_modulo() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_modulo_orcamentos ON public.quotes;
CREATE TRIGGER trg_modulo_orcamentos BEFORE INSERT ON public.quotes
  FOR EACH ROW EXECUTE FUNCTION public.fn_exige_modulo('orcamentos');

DROP TRIGGER IF EXISTS trg_modulo_catalogo ON public.products;
CREATE TRIGGER trg_modulo_catalogo BEFORE INSERT ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.fn_exige_modulo('catalogo');

DROP TRIGGER IF EXISTS trg_modulo_campanhas ON public.wa_campaigns;
CREATE TRIGGER trg_modulo_campanhas BEFORE INSERT ON public.wa_campaigns
  FOR EACH ROW EXECUTE FUNCTION public.fn_exige_modulo('campanhas');

DROP TRIGGER IF EXISTS trg_modulo_qrcode ON public.conexoes;
CREATE TRIGGER trg_modulo_qrcode BEFORE INSERT ON public.conexoes
  FOR EACH ROW WHEN (NEW.tipo = 'qrcode') EXECUTE FUNCTION public.fn_exige_modulo('qrcode');
