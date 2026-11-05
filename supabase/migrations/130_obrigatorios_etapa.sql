-- 130_obrigatorios_etapa.sql
-- Campos obrigatórios por etapa do funil: o que o lead precisa ter para ENTRAR nela.
--
-- Por quê: o dashboard e o comercial dependem de dados que hoje ficam em branco
-- (ex.: "Orçamento enviado" sem e-mail, "Contrato assinado" sem cidade pretendida
-- e capital disponível). O gestor passa a definir, por etapa, o que é exigido.
--
-- O que faz:
--   1. funnel_stages.campos_obrigatorios text[] (padrão '{}'): chaves de campos
--      personalizados (campos_lead.chave, migração 129) e/ou campos fixos do
--      lead, prefixados com 'lead:' para não colidir com as chaves (que só têm
--      [a-z0-9_]). Os fixos são a lista de campos_fixos_lead(), a mesma de
--      src/lib/obrigatorios.ts (tests/db/obrigatorios_fixos.json confere as duas).
--      Trigger fn_etapa_obrigatorios ao gravar a etapa (23514): tira repetidos;
--      cada item tem de ser fixo conhecido ou chave de campo da unidade do funil
--      (da unidade toda ou deste funil); item novo não pode ser de campo
--      desativado (o que já estava pode ficar, para renomear a etapa não falhar);
--      etapa com resultado 'perdido' não exige nada (perder um negócio não pode
--      ser barrado por cadastro incompleto): a gravação é recusada, e o trigger
--      de leads também ignora essas etapas.
--   2. Trigger fn_lead_obrigatorios em leads, BEFORE INSERT OR UPDATE OF stage_id:
--      só quando quem grava é humano (auth.role() 'authenticated', como
--      fn_guard_lead_unit_change da 113) e o lead ENTRA na etapa (INSERT ou
--      stage_id mudou). Editar outro campo de um lead já na etapa não revalida.
--      Automações, webhook, importação pelo servidor e mesclar_leads gravam como
--      service_role/supabase_admin e não são barrados: um lead novo do WhatsApp
--      não pode falhar por falta de e-mail. Falta algo → SQLSTATE 'VC001',
--      mensagem com os rótulos e HINT em JSON {"etapa_id", "faltando": [chaves]},
--      que o app lê (faltandoDoErro em src/lib/obrigatorios.ts).
--      Campo personalizado desativado, de outro funil ou inexistente sai da
--      verificação: ninguém conseguiria preenchê-lo (fn_lead_campos recusa).
--      "Vazio": texto nulo ou só espaços; data/responsável nulos; campo
--      personalizado sem a chave em leads.campos.
--      Ordem: triggers BEFORE da mesma tabela rodam em ordem alfabética do nome.
--      trg_lead_obrigatorios roda depois de trg_lead_campos (vê leads.campos já
--      validado e sem nulos, inclusive quando o mesmo UPDATE preenche e move) e
--      antes de trg_lead_status, de que não depende (lê o resultado da etapa
--      direto de funnel_stages). Renomear um desses triggers muda a ordem.
--   mesclar_leads não muda stage_id e não é recriada. marcarGanho só muda o
--   status (nenhum trigger move a etapa), então não passa por aqui.
--
-- Depende da 126 (funnel_stages.resultado) e da 129 (campos_lead, leads.campos).
-- Aplicar em produção é [H]: o Infra aplica, com aprovação e backup do dia,
-- como supabase_admin, com --single-transaction; depois registra a versão '130'
-- e roda notify pgrst, 'reload schema'. Sem BEGIN/COMMIT. Idempotente. ADD COLUMN
-- com DEFAULT constante não reescreve funnel_stages. Depois de um restore,
-- reaplicar depois da 129.
--
-- Reversão (só com aprovação; perde a configuração das etapas):
--   DROP TRIGGER IF EXISTS trg_lead_obrigatorios ON public.leads;
--   DROP TRIGGER IF EXISTS trg_etapa_obrigatorios ON public.funnel_stages;
--   ALTER TABLE public.funnel_stages DROP COLUMN IF EXISTS campos_obrigatorios;
--   DROP FUNCTION IF EXISTS public.fn_lead_obrigatorios(), public.fn_etapa_obrigatorios(),
--     public.campos_fixos_lead();

SET LOCAL lock_timeout = '5s';

DO $$
BEGIN
  IF current_setting('lock_timeout') <> '5s' THEN
    RAISE EXCEPTION '130: rode com --single-transaction (lock_timeout atual: %)', current_setting('lock_timeout');
  END IF;
  IF current_user <> 'supabase_admin' THEN
    RAISE EXCEPTION '130: rodar como supabase_admin (atual: %)', current_user;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_attribute
                  WHERE attrelid = 'public.funnel_stages'::regclass AND attname = 'resultado' AND NOT attisdropped) THEN
    RAISE EXCEPTION '130: depende da 126 (funnel_stages.resultado)';
  END IF;
  IF to_regclass('public.campos_lead') IS NULL
     OR NOT EXISTS (SELECT 1 FROM pg_attribute
                     WHERE attrelid = 'public.leads'::regclass AND attname = 'campos' AND NOT attisdropped) THEN
    RAISE EXCEPTION '130: depende da 129 (campos_lead, leads.campos)';
  END IF;
END $$;

-- ── 1. Campos fixos que uma etapa pode exigir ────────────────────────────────
CREATE OR REPLACE FUNCTION public.campos_fixos_lead()
 RETURNS TABLE (chave text, rotulo text, ordem integer)
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
 SET search_path TO ''
AS $function$
  SELECT * FROM (VALUES
    ('lead:email',           'E-mail',             1),
    ('lead:telefone',        'Telefone',           2),
    ('lead:sobrenome',       'Sobrenome',          3),
    ('lead:cpf',             'CPF',                4),
    ('lead:data_nascimento', 'Data de nascimento', 5),
    ('lead:profissao',       'Profissão',          6),
    ('lead:cidade',          'Cidade',             7),
    ('lead:estado',          'Estado',             8),
    ('lead:origem',          'Origem',             9),
    ('lead:responsavel_id',  'Responsável',        10)
  ) AS f (chave, rotulo, ordem);
$function$;

-- Os triggers rodam como quem grava (authenticated/service_role) e chamam esta
REVOKE EXECUTE ON FUNCTION public.campos_fixos_lead() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.campos_fixos_lead() TO authenticated, service_role;

-- ── 2. funnel_stages.campos_obrigatorios ─────────────────────────────────────
ALTER TABLE public.funnel_stages ADD COLUMN IF NOT EXISTS campos_obrigatorios text[] NOT NULL DEFAULT '{}';

CREATE OR REPLACE FUNCTION public.fn_etapa_obrigatorios()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  item text;
  unidade uuid;
  c public.campos_lead%ROWTYPE;
BEGIN
  NEW.campos_obrigatorios := ARRAY(
    SELECT x FROM unnest(NEW.campos_obrigatorios) WITH ORDINALITY AS u (x, o)
     WHERE x IS NOT NULL GROUP BY x ORDER BY min(o));
  IF cardinality(NEW.campos_obrigatorios) = 0 THEN
    RETURN NEW;
  END IF;

  IF NEW.resultado = 'perdido' THEN
    RAISE EXCEPTION 'A etapa "%" é de perda e não pode exigir campos: perder um negócio não depende de cadastro completo', NEW.nome
      USING ERRCODE = '23514';
  END IF;

  SELECT f.unit_id INTO unidade FROM public.funnels f WHERE f.id = NEW.funnel_id;

  FOREACH item IN ARRAY NEW.campos_obrigatorios LOOP
    IF item LIKE 'lead:%' THEN
      IF NOT EXISTS (SELECT 1 FROM public.campos_fixos_lead() f WHERE f.chave = item) THEN
        RAISE EXCEPTION 'Campo fixo desconhecido: %', item USING ERRCODE = '23514';
      END IF;
      CONTINUE;
    END IF;
    SELECT * INTO c FROM public.campos_lead WHERE unit_id = unidade AND chave = item;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Campo desconhecido nesta unidade: %', item USING ERRCODE = '23514';
    END IF;
    IF c.funnel_id IS NOT NULL AND c.funnel_id IS DISTINCT FROM NEW.funnel_id THEN
      RAISE EXCEPTION 'O campo "%" é de outro funil', c.rotulo USING ERRCODE = '23514';
    END IF;
    IF NOT c.ativo AND (TG_OP = 'INSERT' OR NOT item = ANY (OLD.campos_obrigatorios)) THEN
      RAISE EXCEPTION 'O campo "%" está desativado', c.rotulo USING ERRCODE = '23514';
    END IF;
  END LOOP;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_etapa_obrigatorios ON public.funnel_stages;
CREATE TRIGGER trg_etapa_obrigatorios
  BEFORE INSERT OR UPDATE OF campos_obrigatorios, resultado, funnel_id ON public.funnel_stages
  FOR EACH ROW EXECUTE FUNCTION public.fn_etapa_obrigatorios();

-- ── 3. Verificação ao entrar na etapa ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_lead_obrigatorios()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  etapa_nome text;
  etapa_resultado text;
  exigidos text[];
  item text;
  vazio boolean;
  rotulo text;
  c public.campos_lead%ROWTYPE;
  faltando text[] := '{}';
  rotulos text[] := '{}';
BEGIN
  IF coalesce(auth.role(), '') NOT IN ('anon', 'authenticated') THEN
    RETURN NEW;
  END IF;
  IF NEW.stage_id IS NULL OR (TG_OP = 'UPDATE' AND NEW.stage_id IS NOT DISTINCT FROM OLD.stage_id) THEN
    RETURN NEW;
  END IF;

  SELECT fs.nome, fs.resultado, fs.campos_obrigatorios INTO etapa_nome, etapa_resultado, exigidos
    FROM public.funnel_stages fs WHERE fs.id = NEW.stage_id;
  IF NOT FOUND OR etapa_resultado = 'perdido' OR cardinality(exigidos) = 0 THEN
    RETURN NEW;
  END IF;

  FOREACH item IN ARRAY exigidos LOOP
    IF item LIKE 'lead:%' THEN
      vazio := CASE item
        WHEN 'lead:email'           THEN coalesce(btrim(NEW.email), '') = ''
        WHEN 'lead:telefone'        THEN coalesce(btrim(NEW.telefone), '') = ''
        WHEN 'lead:sobrenome'       THEN coalesce(btrim(NEW.sobrenome), '') = ''
        WHEN 'lead:cpf'             THEN coalesce(btrim(NEW.cpf), '') = ''
        WHEN 'lead:data_nascimento' THEN NEW.data_nascimento IS NULL
        WHEN 'lead:profissao'       THEN coalesce(btrim(NEW.profissao), '') = ''
        WHEN 'lead:cidade'          THEN coalesce(btrim(NEW.cidade), '') = ''
        WHEN 'lead:estado'          THEN coalesce(btrim(NEW.estado), '') = ''
        WHEN 'lead:origem'          THEN coalesce(btrim(NEW.origem), '') = ''
        WHEN 'lead:responsavel_id'  THEN NEW.responsavel_id IS NULL
      END;
      SELECT f.rotulo INTO rotulo FROM public.campos_fixos_lead() f WHERE f.chave = item;
    ELSE
      SELECT * INTO c FROM public.campos_lead WHERE unit_id = NEW.unit_id AND chave = item;
      IF NOT FOUND OR NOT c.ativo OR (c.funnel_id IS NOT NULL AND c.funnel_id IS DISTINCT FROM NEW.funnel_id) THEN
        CONTINUE;
      END IF;
      vazio := coalesce(jsonb_typeof(NEW.campos -> item), 'null') = 'null';
      rotulo := c.rotulo;
    END IF;
    IF vazio THEN
      faltando := faltando || item;
      rotulos  := rotulos || rotulo;
    END IF;
  END LOOP;

  IF cardinality(faltando) > 0 THEN
    RAISE EXCEPTION 'Para entrar na etapa "%", preencha: %', etapa_nome, array_to_string(rotulos, ', ')
      USING ERRCODE = 'VC001',
            HINT = jsonb_build_object('etapa_id', NEW.stage_id, 'faltando', to_jsonb(faltando))::text;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_lead_obrigatorios ON public.leads;
CREATE TRIGGER trg_lead_obrigatorios
  BEFORE INSERT OR UPDATE OF stage_id ON public.leads
  FOR EACH ROW EXECUTE FUNCTION public.fn_lead_obrigatorios();

REVOKE EXECUTE ON FUNCTION public.fn_etapa_obrigatorios(), public.fn_lead_obrigatorios() FROM PUBLIC, anon, authenticated;

-- ── Conferência ──────────────────────────────────────────────────────────────
DO $$
DECLARE ordem text;
BEGIN
  -- A verificação precisa ver leads.campos já normalizado por trg_lead_campos
  SELECT string_agg(tgname, ' ' ORDER BY tgname) INTO ordem
    FROM pg_trigger
   WHERE tgrelid = 'public.leads'::regclass
     AND tgname IN ('trg_lead_campos', 'trg_lead_obrigatorios');
  IF ordem IS DISTINCT FROM 'trg_lead_campos trg_lead_obrigatorios' THEN
    RAISE EXCEPTION '130: triggers de leads fora da ordem esperada: %', ordem;
  END IF;
  IF has_function_privilege('authenticated', 'public.fn_lead_obrigatorios()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.fn_etapa_obrigatorios()', 'EXECUTE')
     OR has_function_privilege('anon', 'public.campos_fixos_lead()', 'EXECUTE') THEN
    RAISE EXCEPTION '130: funções executáveis por anon/authenticated';
  END IF;
END $$;
