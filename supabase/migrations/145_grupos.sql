-- 145_grupos.sql
-- Grupos de WhatsApp no Atendimento (Fase 3·2, entrega 3) e limite por minuto só
-- no QR Code.
--
-- Por quê: a CS atende os licenciados em grupos (ADR 0002). A conversa passa a ser
-- individual ou de grupo, e a mensagem de grupo guarda quem escreveu. Participante
-- de grupo não vira contato sozinho: só por ação do atendente (decisão de
-- 05/11/2026). E o limite por minuto (144) só vale para o QR Code: na API oficial
-- não há risco de bloqueio, então o valor 20 que as conexões oficiais ganharam só
-- confundia.
--
-- O que faz:
--   1. wa_conversations.tipo ('individual' | 'grupo', padrão individual). Grupo só
--      em conexão QR Code (23514); wa_phone guarda o id do grupo (parte antes do
--      @g.us) e wa_contact_name, o nome do grupo.
--   2. wa_messages.autor_telefone e autor_nome: quem escreveu no grupo (nulos nas
--      conversas individuais).
--   3. auto_link_wa_conversation(): grupo não é ligado a lead pelo telefone.
--   4. conexoes.limite_por_minuto: nulo nas oficiais e obrigatório no QR Code
--      (padrão 20 ao criar sem valor). reservar_envio_conexao já devolve false sem
--      limite, então nada muda no envio.
--
-- Aplicar em produção é [H]: o Infra aplica, com aprovação e backup do dia, como
-- supabase_admin, com --single-transaction; depois registra a versão '145' e roda
-- notify pgrst, 'reload schema'. Sem BEGIN/COMMIT. Idempotente. Antes do deploy do
-- app desta versão (o webhook grava tipo e autor); o app de hoje a ignora.
--
-- Reversão:
--   (reaplicar a função auto_link_wa_conversation da 121)
--   DROP TRIGGER IF EXISTS trg_conexao_limite ON public.conexoes; DROP FUNCTION IF EXISTS public.fn_conexao_limite();
--   ALTER TABLE public.conexoes DROP CONSTRAINT IF EXISTS conexoes_limite_tipo_check;
--   UPDATE public.conexoes SET limite_por_minuto = 20 WHERE limite_por_minuto IS NULL;
--   ALTER TABLE public.conexoes ALTER COLUMN limite_por_minuto SET NOT NULL, ALTER COLUMN limite_por_minuto SET DEFAULT 20;
--   ALTER TABLE public.wa_messages DROP COLUMN IF EXISTS autor_telefone, DROP COLUMN IF EXISTS autor_nome;
--   ALTER TABLE public.wa_conversations DROP COLUMN IF EXISTS tipo;
--   (e a checagem de grupo em fn_conversa_conexao, como na 143)

SET LOCAL lock_timeout = '5s';

DO $$
BEGIN
  IF current_setting('lock_timeout') <> '5s' THEN
    RAISE EXCEPTION '145: rode com --single-transaction (lock_timeout atual: %)', current_setting('lock_timeout');
  END IF;
  IF current_user <> 'supabase_admin' THEN
    RAISE EXCEPTION '145: rodar como supabase_admin (atual: %)', current_user;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'conexoes' AND column_name = 'limite_por_minuto') THEN
    RAISE EXCEPTION '145: aplicar a 144 antes';
  END IF;
END $$;

-- ── 1. Conversa de grupo ─────────────────────────────────────────────────────
ALTER TABLE public.wa_conversations ADD COLUMN IF NOT EXISTS tipo text NOT NULL DEFAULT 'individual';
ALTER TABLE public.wa_conversations DROP CONSTRAINT IF EXISTS wa_conversations_tipo_check;
ALTER TABLE public.wa_conversations ADD CONSTRAINT wa_conversations_tipo_check CHECK (tipo IN ('individual', 'grupo'));

CREATE OR REPLACE FUNCTION public.fn_conversa_conexao()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO public
AS $function$
BEGIN
  IF NEW.conexao_id IS NULL THEN
    SELECT c.id INTO NEW.conexao_id FROM public.conexoes c WHERE c.unit_id = NEW.unit_id AND c.tipo = 'oficial';
    IF NEW.conexao_id IS NULL THEN
      INSERT INTO public.conexoes (unit_id, tipo, nome, status, ativo)
      VALUES (NEW.unit_id, 'oficial', 'WhatsApp oficial', 'desconectada', false)
      RETURNING id INTO NEW.conexao_id;
    END IF;
  ELSIF NOT EXISTS (SELECT 1 FROM public.conexoes c WHERE c.id = NEW.conexao_id AND c.unit_id = NEW.unit_id) THEN
    RAISE EXCEPTION 'A conexão da conversa é de outra unidade' USING ERRCODE = '23514';
  END IF;
  IF NEW.tipo = 'grupo'
     AND NOT EXISTS (SELECT 1 FROM public.conexoes c WHERE c.id = NEW.conexao_id AND c.tipo = 'qrcode') THEN
    RAISE EXCEPTION 'Conversa de grupo só em conexão por QR Code' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.fn_conversa_conexao() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_conversa_conexao ON public.wa_conversations;
CREATE TRIGGER trg_conversa_conexao BEFORE INSERT OR UPDATE OF conexao_id, unit_id, tipo ON public.wa_conversations
  FOR EACH ROW EXECUTE FUNCTION public.fn_conversa_conexao();

-- ── 2. Autor da mensagem de grupo ────────────────────────────────────────────
ALTER TABLE public.wa_messages ADD COLUMN IF NOT EXISTS autor_telefone text;
ALTER TABLE public.wa_messages ADD COLUMN IF NOT EXISTS autor_nome text;

-- ── 3. Grupo não liga a lead pelo telefone ───────────────────────────────────
CREATE OR REPLACE FUNCTION public.auto_link_wa_conversation()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE
  v_lead_id uuid;
BEGIN
  IF NEW.lead_id IS NOT NULL OR NEW.tipo = 'grupo' THEN
    RETURN NEW;
  END IF;

  SELECT id INTO v_lead_id
    FROM public.leads
   WHERE unit_id = NEW.unit_id
     AND NOT arquivado
     AND telefone_norm = public.normalizar_telefone('+' || NEW.wa_phone)
   ORDER BY created_at DESC
   LIMIT 1;

  IF v_lead_id IS NOT NULL THEN
    NEW.lead_id := v_lead_id;
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.auto_link_wa_conversation() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.auto_link_wa_conversation() TO service_role;

-- ── 4. Limite por minuto só no QR Code ───────────────────────────────────────
ALTER TABLE public.conexoes ALTER COLUMN limite_por_minuto DROP DEFAULT;
ALTER TABLE public.conexoes ALTER COLUMN limite_por_minuto DROP NOT NULL;
UPDATE public.conexoes SET limite_por_minuto = NULL WHERE tipo = 'oficial' AND limite_por_minuto IS NOT NULL;

CREATE OR REPLACE FUNCTION public.fn_conexao_limite()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
BEGIN
  IF NEW.tipo = 'qrcode' AND NEW.limite_por_minuto IS NULL THEN
    NEW.limite_por_minuto := 20;
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.fn_conexao_limite() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_conexao_limite ON public.conexoes;
CREATE TRIGGER trg_conexao_limite BEFORE INSERT OR UPDATE OF tipo, limite_por_minuto ON public.conexoes
  FOR EACH ROW EXECUTE FUNCTION public.fn_conexao_limite();

ALTER TABLE public.conexoes DROP CONSTRAINT IF EXISTS conexoes_limite_tipo_check;
ALTER TABLE public.conexoes ADD CONSTRAINT conexoes_limite_tipo_check
  CHECK ((tipo = 'qrcode') = (limite_por_minuto IS NOT NULL));
