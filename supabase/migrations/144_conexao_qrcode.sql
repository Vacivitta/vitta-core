-- 144_conexao_qrcode.sql
-- Conexão por QR Code (Fase 3·2, entrega 2): limite de envio por minuto e o fim
-- do UNIQUE da conversa por unidade.
--
-- Por quê: o canal por QR Code (Evolution API, ADR 0002) não é oficial e o número
-- pode ser bloqueado; envio em rajada é o que mais causa bloqueio. E a unidade
-- passa a ter dois números, então o mesmo cliente pode ter uma conversa em cada.
--
-- O que faz:
--   1. conexoes.limite_por_minuto (padrão 20, de 1 a 60).
--   2. conexao_envios + reservar_envio_conexao(conexao): reserva uma vaga de envio
--      no minuto corrente, travando a linha da conexão (FOR UPDATE), então dois
--      envios ao mesmo tempo não passam do limite. Devolve false sem vaga. Apaga as
--      reservas com mais de uma hora. SECURITY INVOKER, só para o service_role.
--   3. Sai o UNIQUE (unit_id, wa_phone) de wa_conversations; fica o
--      (conexao_id, wa_phone) da 143. O app da 143 já faz upsert por ele.
--
-- Campanha e disparo em massa não usam QR Code por construção: saem pelo
-- wa_config da unidade (getWaCredentials), que é sempre a conexão oficial.
--
-- Aplicar em produção é [H]: o Infra aplica, com aprovação e backup do dia, como
-- supabase_admin, com --single-transaction; depois registra a versão '144' e roda
-- notify pgrst, 'reload schema'. Sem BEGIN/COMMIT. Idempotente. Depois do deploy
-- da 143 (o app da 142 faz upsert pelo UNIQUE antigo) e antes do deploy do app
-- desta versão (que chama reservar_envio_conexao).
--
-- Reversão:
--   DROP FUNCTION IF EXISTS public.reservar_envio_conexao(uuid);
--   DROP TABLE IF EXISTS public.conexao_envios;
--   ALTER TABLE public.conexoes DROP COLUMN IF EXISTS limite_por_minuto;
--   ALTER TABLE public.wa_conversations ADD CONSTRAINT wa_conversations_unit_id_wa_phone_key UNIQUE (unit_id, wa_phone);
--     (falha se já houver o mesmo telefone em duas conexões da unidade)

SET LOCAL lock_timeout = '5s';

DO $$
BEGIN
  IF current_setting('lock_timeout') <> '5s' THEN
    RAISE EXCEPTION '144: rode com --single-transaction (lock_timeout atual: %)', current_setting('lock_timeout');
  END IF;
  IF current_user <> 'supabase_admin' THEN
    RAISE EXCEPTION '144: rodar como supabase_admin (atual: %)', current_user;
  END IF;
  IF to_regclass('public.conexoes') IS NULL THEN
    RAISE EXCEPTION '144: aplicar a 143 antes';
  END IF;
END $$;

-- ── 1. Limite por minuto ─────────────────────────────────────────────────────
ALTER TABLE public.conexoes ADD COLUMN IF NOT EXISTS limite_por_minuto integer NOT NULL DEFAULT 20;
ALTER TABLE public.conexoes DROP CONSTRAINT IF EXISTS conexoes_limite_por_minuto_check;
ALTER TABLE public.conexoes ADD CONSTRAINT conexoes_limite_por_minuto_check CHECK (limite_por_minuto BETWEEN 1 AND 60);

-- ── 2. Reserva de envio ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.conexao_envios (
  id          bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  conexao_id  uuid        NOT NULL REFERENCES public.conexoes (id) ON DELETE CASCADE,
  reservado_em timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_conexao_envios ON public.conexao_envios (conexao_id, reservado_em);

ALTER TABLE public.conexao_envios ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.conexao_envios FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.conexao_envios TO service_role;

CREATE OR REPLACE FUNCTION public.reservar_envio_conexao(p_conexao uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE
  v_limite integer;
BEGIN
  SELECT c.limite_por_minuto INTO v_limite FROM public.conexoes c WHERE c.id = p_conexao FOR UPDATE;
  IF v_limite IS NULL THEN
    RETURN false;
  END IF;
  DELETE FROM public.conexao_envios WHERE conexao_id = p_conexao AND reservado_em < now() - interval '1 hour';
  IF (SELECT count(*) FROM public.conexao_envios
       WHERE conexao_id = p_conexao AND reservado_em > now() - interval '1 minute') >= v_limite THEN
    RETURN false;
  END IF;
  INSERT INTO public.conexao_envios (conexao_id) VALUES (p_conexao);
  RETURN true;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.reservar_envio_conexao(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reservar_envio_conexao(uuid) TO service_role;

-- ── 3. Conversa única por conexão, não mais por unidade ──────────────────────
ALTER TABLE public.wa_conversations DROP CONSTRAINT IF EXISTS wa_conversations_unit_id_wa_phone_key;
