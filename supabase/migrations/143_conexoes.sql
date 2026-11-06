-- 143_conexoes.sql
-- Conexões de WhatsApp (Fase 3·2, entrega 1): a conversa passa a pertencer a uma
-- conexão, e não ao "número da unidade".
--
-- Por quê: a CS vai conectar o número dela por QR Code (ADR 0002), e uma unidade
-- passa a ter mais de um número. Uma conexão pessoal mostra as conversas só para
-- a dona e para o admin da marca (ADR 0007). Hoje wa_config é uma linha por
-- unidade e a conversa é única por (unit_id, wa_phone).
--
-- O que faz:
--   1. conexoes: unit_id, tipo ('oficial' | 'qrcode'), nome, numero exibido,
--      pessoal + dona_id (só QR Code; a dona é da unidade), wa_config_id (oficial)
--      ou instancia (QR Code, entrega 2), status, ativo. No máximo uma oficial por
--      unidade, porque wa_config continua sendo uma por unidade. Sem segredo: o
--      token continua só em wa_config (service_role).
--   2. Backfill: uma conexão oficial por wa_config e, para unidade com conversa e
--      sem wa_config, uma oficial desconectada. Trigger em wa_config mantém a
--      conexão oficial da unidade em dia (número, ativo), sem mudar a tela de
--      configuração.
--   3. wa_conversations.conexao_id NOT NULL. Inserção sem conexão (o app de hoje)
--      recebe a oficial da unidade; conexão de outra unidade é recusada (23514).
--      Novo UNIQUE (conexao_id, wa_phone). O UNIQUE (unit_id, wa_phone) fica até a
--      entrega 2, porque o app de hoje faz upsert com onConflict unit_id,wa_phone.
--   4. RLS: conversa de conexão pessoal só para a dona e o admin da marca;
--      mensagens, notas internas e agendadas só se a conversa é visível (as
--      etiquetas da conversa já consultam wa_conversations sob RLS). conexoes:
--      membros da unidade e admin leem; escrita só pelo service_role.
--
-- Aplicar em produção é [H]: o Infra aplica, com aprovação e backup do dia, como
-- supabase_admin, com --single-transaction; depois registra a versão '143' e roda
-- notify pgrst, 'reload schema'. Sem BEGIN/COMMIT. Idempotente. Antes do deploy
-- do app desta versão (o webhook grava conexao_id e faz upsert pelo UNIQUE novo);
-- o app de hoje funciona com ela (o trigger preenche a conexão).
--
-- Reversão:
--   (recriar as regras de wa_conversations, wa_messages, wa_internal_notes e
--    wa_scheduled_messages como em 092/067, sem a checagem da conversa)
--   DROP TRIGGER IF EXISTS trg_conversa_conexao ON public.wa_conversations;
--   DROP FUNCTION IF EXISTS public.fn_conversa_conexao();
--   ALTER TABLE public.wa_conversations DROP COLUMN IF EXISTS conexao_id;
--   DROP TRIGGER IF EXISTS trg_wa_config_conexao ON public.wa_config;
--   DROP FUNCTION IF EXISTS public.fn_wa_config_conexao();
--   DROP TABLE IF EXISTS public.conexoes; DROP FUNCTION IF EXISTS public.fn_conexao_dona();

SET LOCAL lock_timeout = '5s';

DO $$
BEGIN
  IF current_setting('lock_timeout') <> '5s' THEN
    RAISE EXCEPTION '143: rode com --single-transaction (lock_timeout atual: %)', current_setting('lock_timeout');
  END IF;
  IF current_user <> 'supabase_admin' THEN
    RAISE EXCEPTION '143: rodar como supabase_admin (atual: %)', current_user;
  END IF;
END $$;

-- ── 1. Conexões ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.conexoes (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id      uuid        NOT NULL REFERENCES public.units (id) ON DELETE CASCADE,
  tipo         text        NOT NULL CHECK (tipo IN ('oficial', 'qrcode')),
  nome         text        NOT NULL CHECK (btrim(nome) <> ''),
  numero       text,
  pessoal      boolean     NOT NULL DEFAULT false,
  dona_id      uuid        REFERENCES public.profiles (id) ON DELETE RESTRICT,
  wa_config_id uuid        UNIQUE REFERENCES public.wa_config (id) ON DELETE SET NULL,
  instancia    text        UNIQUE,
  status       text        NOT NULL DEFAULT 'desconectada'
                           CHECK (status IN ('conectada', 'desconectada', 'aguardando_qr')),
  ativo        boolean     NOT NULL DEFAULT true,
  criado_em    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT conexoes_pessoal_check CHECK (NOT pessoal OR (tipo = 'qrcode' AND dona_id IS NOT NULL)),
  CONSTRAINT conexoes_oficial_check CHECK (tipo <> 'oficial' OR instancia IS NULL),
  CONSTRAINT conexoes_qrcode_check  CHECK (tipo <> 'qrcode' OR wa_config_id IS NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_conexoes_oficial_unidade ON public.conexoes (unit_id) WHERE tipo = 'oficial';
CREATE INDEX IF NOT EXISTS idx_conexoes_unit ON public.conexoes (unit_id);

CREATE OR REPLACE FUNCTION public.fn_conexao_dona()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO public
AS $function$
BEGIN
  IF NEW.dona_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.user_units uu WHERE uu.user_id = NEW.dona_id AND uu.unit_id = NEW.unit_id) THEN
    RAISE EXCEPTION 'A dona da conexão precisa estar na unidade' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.fn_conexao_dona() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_conexao_dona ON public.conexoes;
CREATE TRIGGER trg_conexao_dona BEFORE INSERT OR UPDATE OF dona_id, unit_id ON public.conexoes
  FOR EACH ROW EXECUTE FUNCTION public.fn_conexao_dona();

ALTER TABLE public.conexoes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.conexoes FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.conexoes FROM authenticated;
GRANT SELECT ON public.conexoes TO authenticated;
GRANT ALL ON public.conexoes TO service_role;

DROP POLICY IF EXISTS conexoes_select ON public.conexoes;
CREATE POLICY conexoes_select ON public.conexoes FOR SELECT TO authenticated USING (
  (SELECT public.is_global_admin())
  OR unit_id IN (SELECT uu.unit_id FROM public.user_units uu WHERE uu.user_id = (SELECT auth.uid()))
);

-- ── 2. Conexão oficial a partir de wa_config ─────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_wa_config_conexao()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO public
AS $function$
BEGIN
  UPDATE public.conexoes
     SET wa_config_id = NEW.id,
         numero       = coalesce(NEW.display_phone, numero),
         ativo        = NEW.is_active,
         status       = CASE WHEN NEW.is_active AND NEW.phone_number_id IS NOT NULL THEN 'conectada' ELSE 'desconectada' END
   WHERE unit_id = NEW.unit_id AND tipo = 'oficial';
  IF NOT FOUND THEN
    INSERT INTO public.conexoes (unit_id, tipo, nome, numero, wa_config_id, status, ativo)
    VALUES (NEW.unit_id, 'oficial', 'WhatsApp oficial', NEW.display_phone, NEW.id,
            CASE WHEN NEW.is_active AND NEW.phone_number_id IS NOT NULL THEN 'conectada' ELSE 'desconectada' END,
            NEW.is_active);
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.fn_wa_config_conexao() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_wa_config_conexao ON public.wa_config;
CREATE TRIGGER trg_wa_config_conexao AFTER INSERT OR UPDATE OF display_phone, is_active, phone_number_id
  ON public.wa_config FOR EACH ROW EXECUTE FUNCTION public.fn_wa_config_conexao();

INSERT INTO public.conexoes (unit_id, tipo, nome, numero, wa_config_id, status, ativo)
SELECT w.unit_id, 'oficial', 'WhatsApp oficial', w.display_phone, w.id,
       CASE WHEN w.is_active AND w.phone_number_id IS NOT NULL THEN 'conectada' ELSE 'desconectada' END,
       w.is_active
  FROM public.wa_config w
 WHERE NOT EXISTS (SELECT 1 FROM public.conexoes c WHERE c.unit_id = w.unit_id AND c.tipo = 'oficial');

INSERT INTO public.conexoes (unit_id, tipo, nome, status, ativo)
SELECT DISTINCT wc.unit_id, 'oficial', 'WhatsApp oficial', 'desconectada', false
  FROM public.wa_conversations wc
 WHERE NOT EXISTS (SELECT 1 FROM public.conexoes c WHERE c.unit_id = wc.unit_id AND c.tipo = 'oficial');

-- ── 3. Conversa da conexão ───────────────────────────────────────────────────
ALTER TABLE public.wa_conversations ADD COLUMN IF NOT EXISTS conexao_id uuid REFERENCES public.conexoes (id) ON DELETE RESTRICT;

UPDATE public.wa_conversations wc
   SET conexao_id = c.id
  FROM public.conexoes c
 WHERE wc.conexao_id IS NULL AND c.unit_id = wc.unit_id AND c.tipo = 'oficial';

ALTER TABLE public.wa_conversations ALTER COLUMN conexao_id SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_wa_conversations_conexao_phone ON public.wa_conversations (conexao_id, wa_phone);

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
  RETURN NEW;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.fn_conversa_conexao() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_conversa_conexao ON public.wa_conversations;
CREATE TRIGGER trg_conversa_conexao BEFORE INSERT OR UPDATE OF conexao_id, unit_id ON public.wa_conversations
  FOR EACH ROW EXECUTE FUNCTION public.fn_conversa_conexao();

-- ── 4. Quem vê a conversa ────────────────────────────────────────────────────
-- Conversa visível: admin da marca, ou membro da unidade quando a conexão não é
-- pessoal de outra pessoa. As tabelas filhas exigem a conversa visível (EXISTS
-- sob o RLS de wa_conversations, que só restringe).
DROP POLICY IF EXISTS unit_members_wa_conversations_select ON public.wa_conversations;
CREATE POLICY unit_members_wa_conversations_select ON public.wa_conversations FOR SELECT TO public USING (
  (SELECT public.is_global_admin())
  OR (unit_id IN (SELECT uu.unit_id FROM public.user_units uu WHERE uu.user_id = (SELECT auth.uid()))
      AND NOT EXISTS (SELECT 1 FROM public.conexoes c
                       WHERE c.id = wa_conversations.conexao_id AND c.pessoal AND c.dona_id <> (SELECT auth.uid())))
);

DROP POLICY IF EXISTS unit_members_wa_conversations_update ON public.wa_conversations;
CREATE POLICY unit_members_wa_conversations_update ON public.wa_conversations FOR UPDATE TO public USING (
  (SELECT public.is_global_admin())
  OR (unit_id IN (SELECT uu.unit_id FROM public.user_units uu WHERE uu.user_id = (SELECT auth.uid()))
      AND NOT EXISTS (SELECT 1 FROM public.conexoes c
                       WHERE c.id = wa_conversations.conexao_id AND c.pessoal AND c.dona_id <> (SELECT auth.uid())))
) WITH CHECK (
  (SELECT public.is_global_admin())
  OR (unit_id IN (SELECT uu.unit_id FROM public.user_units uu WHERE uu.user_id = (SELECT auth.uid()))
      AND NOT EXISTS (SELECT 1 FROM public.conexoes c
                       WHERE c.id = wa_conversations.conexao_id AND c.pessoal AND c.dona_id <> (SELECT auth.uid())))
);

DROP POLICY IF EXISTS wa_conv_insert ON public.wa_conversations;
CREATE POLICY wa_conv_insert ON public.wa_conversations FOR INSERT TO public WITH CHECK (
  unit_id IN (SELECT uu.unit_id FROM public.user_units uu WHERE uu.user_id = (SELECT auth.uid()))
  AND NOT EXISTS (SELECT 1 FROM public.conexoes c
                   WHERE c.id = wa_conversations.conexao_id AND c.pessoal AND c.dona_id <> (SELECT auth.uid()))
);

DROP POLICY IF EXISTS unit_members_wa_messages_select ON public.wa_messages;
CREATE POLICY unit_members_wa_messages_select ON public.wa_messages FOR SELECT TO public USING (
  (SELECT public.is_global_admin())
  OR (unit_id IN (SELECT uu.unit_id FROM public.user_units uu WHERE uu.user_id = (SELECT auth.uid()))
      AND EXISTS (SELECT 1 FROM public.wa_conversations wc WHERE wc.id = wa_messages.conversation_id))
);

DROP POLICY IF EXISTS unit_members_wa_messages_update ON public.wa_messages;
CREATE POLICY unit_members_wa_messages_update ON public.wa_messages FOR UPDATE TO public USING (
  (SELECT public.is_global_admin())
  OR (unit_id IN (SELECT uu.unit_id FROM public.user_units uu WHERE uu.user_id = (SELECT auth.uid()))
      AND EXISTS (SELECT 1 FROM public.wa_conversations wc WHERE wc.id = wa_messages.conversation_id))
) WITH CHECK (
  (SELECT public.is_global_admin())
  OR (unit_id IN (SELECT uu.unit_id FROM public.user_units uu WHERE uu.user_id = (SELECT auth.uid()))
      AND EXISTS (SELECT 1 FROM public.wa_conversations wc WHERE wc.id = wa_messages.conversation_id))
);

DROP POLICY IF EXISTS wa_msg_insert ON public.wa_messages;
CREATE POLICY wa_msg_insert ON public.wa_messages FOR INSERT TO public WITH CHECK (
  unit_id IN (SELECT uu.unit_id FROM public.user_units uu WHERE uu.user_id = (SELECT auth.uid()))
  AND EXISTS (SELECT 1 FROM public.wa_conversations wc WHERE wc.id = wa_messages.conversation_id)
);

DROP POLICY IF EXISTS unit_members_notes ON public.wa_internal_notes;
CREATE POLICY unit_members_notes ON public.wa_internal_notes FOR ALL TO public USING (
  (SELECT public.is_global_admin())
  OR (unit_id IN (SELECT uu.unit_id FROM public.user_units uu WHERE uu.user_id = (SELECT auth.uid()))
      AND EXISTS (SELECT 1 FROM public.wa_conversations wc WHERE wc.id = wa_internal_notes.conversation_id))
) WITH CHECK (
  (SELECT public.is_global_admin())
  OR (unit_id IN (SELECT uu.unit_id FROM public.user_units uu WHERE uu.user_id = (SELECT auth.uid()))
      AND EXISTS (SELECT 1 FROM public.wa_conversations wc WHERE wc.id = wa_internal_notes.conversation_id))
);

DROP POLICY IF EXISTS "unit members" ON public.wa_scheduled_messages;
CREATE POLICY "unit members" ON public.wa_scheduled_messages FOR ALL TO public USING (
  (SELECT public.is_global_admin())
  OR (unit_id IN (SELECT uu.unit_id FROM public.user_units uu WHERE uu.user_id = (SELECT auth.uid()))
      AND EXISTS (SELECT 1 FROM public.wa_conversations wc WHERE wc.id = wa_scheduled_messages.conversation_id))
) WITH CHECK (
  (SELECT public.is_global_admin())
  OR (unit_id IN (SELECT uu.unit_id FROM public.user_units uu WHERE uu.user_id = (SELECT auth.uid()))
      AND EXISTS (SELECT 1 FROM public.wa_conversations wc WHERE wc.id = wa_scheduled_messages.conversation_id))
);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.wa_conversations WHERE conexao_id IS NULL) THEN
    RAISE EXCEPTION '143: sobrou conversa sem conexão';
  END IF;
END $$;
