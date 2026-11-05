-- 133_tags_por_tipo.sql
-- Tags separadas por tipo: do cliente (aplicadas no lead) ou da conversa.
--
-- Por quê: desde a 127 o catálogo wa_tags serve ao lead e à conversa, e a mesma
-- lista aparece nos dois lugares. O pedido é manter catálogos separados: na ficha
-- do cliente só tags de cliente, no atendimento só tags de conversa. Em produção
-- (04/11/2026) há 17 tags, todas da unidade Itu, com 39 aplicações em conversas e
-- 39 em leads (as da conversa copiadas pela 127).
--
-- O que faz:
--   1. wa_tags.tipo text NOT NULL DEFAULT 'conversa', CHECK (tipo IN ('lead',
--      'conversa')). Rótulo na tela: "Cliente" / "Conversa". O DEFAULT existe
--      para o app anterior (que não manda tipo) continuar criando tags entre esta
--      migração e o deploy; o app novo sempre manda o tipo.
--   2. Uma vez só (na aplicação que cria a coluna): toda tag existente vira
--      'conversa'. A tag aplicada em leads E em conversas ganha uma cópia 'lead'
--      (mesma unidade, nome, cor e created_at) e as lead_tags dela passam para a
--      cópia; a aplicada só em leads vira 'lead' (sem cópia, para não deixar uma
--      tag de conversa repetida e sem uso). As aplicações em conversas não mudam.
--      Tag sem aplicação fica 'conversa' (troque o tipo na tela, se for o caso).
--      NOTICE com as contagens.
--      wa_tags não tem UNIQUE de nome (058/092), então a cópia com o mesmo nome
--      não colide; se alguém tiver criado um, a guarda aborta antes de copiar.
--   3. Trigger tag_aplicada_tipo (BEFORE INSERT/UPDATE) em lead_tags e em
--      wa_conversation_tags: recusa (23514) tag do tipo errado. É SECURITY
--      DEFINER para enxergar a tag mesmo sem RLS (quem pode aplicar continua
--      sendo decidido pelas policies). Função separada da lead_tags_unidade da
--      127 de propósito: reaplicar a 127 recria aquela função e não pode apagar
--      esta regra.
--   4. Trigger wa_tags_troca_tipo (BEFORE UPDATE OF tipo em wa_tags): recusa
--      (23514) trocar o tipo de uma tag que já está aplicada em algum lead ou
--      conversa. Sem aplicações, pode trocar.
--
-- Ordem com o deploy: aplicar ANTES do deploy do app novo (que lê e grava
-- wa_tags.tipo; sem a coluna, as telas de tag dão erro). Entre a migração e o
-- deploy, o app anterior mostra as duas listas juntas (as cópias 'lead' aparecem
-- como nomes repetidos) e aplicar tag do tipo errado dá erro; deploy logo depois.
--
-- Aplicar em produção é [H]: o Infra aplica, com aprovação e backup do dia, como
-- supabase_admin, com --single-transaction; depois registra a versão '133' e roda
-- notify pgrst, 'reload schema'. Sem BEGIN/COMMIT. Idempotente: reaplicar não
-- refaz as cópias. Depende da 127 (lead_tags). Reaplicar a 127 ou a 092 não
-- afeta os triggers desta. Depois de um restore, reaplicar esta antes da 118 (a
-- guarda da 118 recusa as funções desta abertas para authenticated).
-- Conferir depois: has_function_privilege('authenticated',
-- 'public.tag_aplicada_tipo()', 'EXECUTE') = false (idem wa_tags_troca_tipo).
--
-- Reversão (só com aprovação): repontar as lead_tags das cópias para a tag
-- 'conversa' de mesmo nome e unidade, apagar as cópias 'lead', DROP dos triggers
-- trg_lead_tags_tipo, trg_wa_conversation_tags_tipo, trg_wa_tags_troca_tipo, das
-- funções tag_aplicada_tipo e wa_tags_troca_tipo, e DROP COLUMN wa_tags.tipo.

SET LOCAL lock_timeout = '5s';

DO $$
BEGIN
  IF current_setting('lock_timeout') <> '5s' THEN
    RAISE EXCEPTION '133: rode com --single-transaction (lock_timeout atual: %)', current_setting('lock_timeout');
  END IF;
  IF current_user <> 'supabase_admin' THEN
    RAISE EXCEPTION '133: rodar como supabase_admin (atual: %)', current_user;
  END IF;
  IF to_regclass('public.lead_tags') IS NULL OR to_regprocedure('public.lead_tags_unidade()') IS NULL THEN
    RAISE EXCEPTION '133: depende da 127 (lead_tags)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_attribute
                  WHERE attrelid = 'public.leads'::regclass AND attname = 'arquivado_em' AND NOT attisdropped) THEN
    RAISE EXCEPTION '133: depende da 132 (leads.arquivado_em)';
  END IF;
  PERFORM set_config('vc133.migrar_dados',
    (NOT EXISTS (SELECT 1 FROM pg_attribute
                  WHERE attrelid = 'public.wa_tags'::regclass AND attname = 'tipo' AND NOT attisdropped))::text,
    true);
END $$;

-- ── 1. Coluna tipo ───────────────────────────────────────────────────────────
ALTER TABLE public.wa_tags ADD COLUMN IF NOT EXISTS tipo text NOT NULL DEFAULT 'conversa';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'public.wa_tags'::regclass AND conname = 'wa_tags_tipo_check') THEN
    ALTER TABLE public.wa_tags ADD CONSTRAINT wa_tags_tipo_check CHECK (tipo IN ('lead', 'conversa'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_wa_tags_unit_tipo ON public.wa_tags (unit_id, tipo);

-- ── 2. Uma vez só: cópia 'lead' das tags aplicadas em leads ──────────────────
DO $$
DECLARE
  unicos     text;
  t          record;
  nova       uuid;
  copias     integer := 0;
  viradas    integer := 0;
  repontadas integer := 0;
  n          integer;
BEGIN
  IF current_setting('vc133.migrar_dados') <> 'true' THEN
    RETURN;
  END IF;

  -- Um UNIQUE de nome por unidade faria a cópia colidir com a original
  SELECT string_agg(c.conname, ', ') INTO unicos
    FROM pg_constraint c
   WHERE c.conrelid = 'public.wa_tags'::regclass AND c.contype = 'u';
  IF unicos IS NULL THEN
    SELECT string_agg(i.indexrelid::regclass::text, ', ') INTO unicos
      FROM pg_index i
     WHERE i.indrelid = 'public.wa_tags'::regclass AND i.indisunique AND NOT i.indisprimary;
  END IF;
  IF unicos IS NOT NULL THEN
    RAISE EXCEPTION '133: wa_tags tem restrição única (%); trocar por (unit_id, tipo, name) antes', unicos;
  END IF;

  FOR t IN
    SELECT w.id, w.unit_id, w.name, w.color, w.created_at
      FROM public.wa_tags w
     WHERE EXISTS (SELECT 1 FROM public.lead_tags lt WHERE lt.tag_id = w.id)
     ORDER BY w.unit_id, w.name, w.id
  LOOP
    IF EXISTS (SELECT 1 FROM public.wa_conversation_tags ct WHERE ct.tag_id = t.id) THEN
      INSERT INTO public.wa_tags (unit_id, name, color, created_at, tipo)
      VALUES (t.unit_id, t.name, t.color, t.created_at, 'lead')
      RETURNING id INTO nova;
      UPDATE public.lead_tags SET tag_id = nova WHERE tag_id = t.id;
      GET DIAGNOSTICS n = ROW_COUNT;
      copias := copias + 1;
      repontadas := repontadas + n;
    ELSE
      UPDATE public.wa_tags SET tipo = 'lead' WHERE id = t.id;
      viradas := viradas + 1;
    END IF;
  END LOOP;

  RAISE NOTICE '133: % tag(s) de conversa; % cópia(s) de cliente criada(s), com % aplicação(ões) em leads repontada(s); % tag(s) usada(s) só em leads passou(aram) a ser de cliente; % aplicação(ões) em conversas sem mudança',
    (SELECT count(*) FROM public.wa_tags WHERE tipo = 'conversa'), copias, repontadas, viradas,
    (SELECT count(*) FROM public.wa_conversation_tags);
END $$;

-- ── 3. Tag do tipo certo em cada aplicação ───────────────────────────────────
CREATE OR REPLACE FUNCTION public.tag_aplicada_tipo()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  esperado text := CASE TG_TABLE_NAME WHEN 'lead_tags' THEN 'lead' ELSE 'conversa' END;
  tipo_tag text;
BEGIN
  SELECT tipo INTO tipo_tag FROM public.wa_tags WHERE id = NEW.tag_id;
  -- Tag inexistente: a FK (ou o trigger de unidade da 127) responde
  IF tipo_tag IS NOT NULL AND tipo_tag <> esperado THEN
    IF esperado = 'lead' THEN
      RAISE EXCEPTION 'lead_tags: a tag é de conversa; no cliente só entram tags do tipo Cliente' USING ERRCODE = '23514';
    END IF;
    RAISE EXCEPTION 'wa_conversation_tags: a tag é de cliente; na conversa só entram tags do tipo Conversa' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.tag_aplicada_tipo() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.tag_aplicada_tipo() TO service_role;

DROP TRIGGER IF EXISTS trg_lead_tags_tipo ON public.lead_tags;
CREATE TRIGGER trg_lead_tags_tipo
  BEFORE INSERT OR UPDATE OF tag_id ON public.lead_tags
  FOR EACH ROW EXECUTE FUNCTION public.tag_aplicada_tipo();

DROP TRIGGER IF EXISTS trg_wa_conversation_tags_tipo ON public.wa_conversation_tags;
CREATE TRIGGER trg_wa_conversation_tags_tipo
  BEFORE INSERT OR UPDATE OF tag_id ON public.wa_conversation_tags
  FOR EACH ROW EXECUTE FUNCTION public.tag_aplicada_tipo();

-- ── 4. Tipo só muda em tag sem aplicações ────────────────────────────────────
CREATE OR REPLACE FUNCTION public.wa_tags_troca_tipo()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  IF EXISTS (SELECT 1 FROM public.lead_tags WHERE tag_id = NEW.id)
     OR EXISTS (SELECT 1 FROM public.wa_conversation_tags WHERE tag_id = NEW.id) THEN
    RAISE EXCEPTION 'wa_tags: a tag já está aplicada; para trocar o tipo, remova-a dos clientes e conversas ou crie outra'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.wa_tags_troca_tipo() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.wa_tags_troca_tipo() TO service_role;

DROP TRIGGER IF EXISTS trg_wa_tags_troca_tipo ON public.wa_tags;
CREATE TRIGGER trg_wa_tags_troca_tipo
  BEFORE UPDATE OF tipo ON public.wa_tags
  FOR EACH ROW WHEN (NEW.tipo IS DISTINCT FROM OLD.tipo)
  EXECUTE FUNCTION public.wa_tags_troca_tipo();

-- ── Conferência ──────────────────────────────────────────────────────────────
DO $$
DECLARE
  errados bigint;
BEGIN
  IF has_function_privilege('authenticated', 'public.tag_aplicada_tipo()', 'EXECUTE')
     OR has_function_privilege('anon', 'public.tag_aplicada_tipo()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.wa_tags_troca_tipo()', 'EXECUTE')
     OR has_function_privilege('anon', 'public.wa_tags_troca_tipo()', 'EXECUTE') THEN
    RAISE EXCEPTION '133: funções de trigger de tags executáveis por authenticated/anon';
  END IF;
  SELECT (SELECT count(*) FROM public.lead_tags lt JOIN public.wa_tags t ON t.id = lt.tag_id WHERE t.tipo <> 'lead')
       + (SELECT count(*) FROM public.wa_conversation_tags ct JOIN public.wa_tags t ON t.id = ct.tag_id WHERE t.tipo <> 'conversa')
    INTO errados;
  IF errados > 0 THEN
    RAISE EXCEPTION '133: % aplicação(ões) com tag do tipo errado', errados;
  END IF;
END $$;
