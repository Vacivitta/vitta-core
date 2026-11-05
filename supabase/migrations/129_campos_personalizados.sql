-- 129_campos_personalizados.sql
-- Campos personalizados do lead, configurados pelo gestor da unidade.
--
-- Por quê: data de nascimento do paciente, convênio e vacinas de interesse (clínica)
-- ou cidade pretendida, capital disponível e prazo (comercial) hoje vão em
-- anotações, em texto livre: não dá para filtrar, exigir por etapa (item 8) nem
-- importar de planilha com mapeamento (item 12).
--
-- O que faz:
--   1. campos_lead: definição por unidade, opcionalmente só de um funil. A chave
--      (usada em leads.campos e no mapeamento de importação) é gerada do rótulo
--      no INSERT (slug ascii, com sufixo _2, _3... se repetir na unidade) e não
--      muda mais: renomear o rótulo não mexe nos valores gravados. Tipo e unidade
--      também não mudam depois de criado. Com funnel_id, a unidade é a do funil.
--      Não se apaga campo (sem DELETE para authenticated): desativa-se, para a
--      chave não voltar com outro tipo e os valores antigos continuarem legíveis.
--   2. leads.campos jsonb (chave → valor), validado pelo trigger fn_lead_campos:
--      cada chave que entra ou muda de valor tem de ser de um campo ativo da
--      unidade do lead (e, se o campo é de funil, do funil do lead) e o valor tem
--      de ser do tipo (campo_valor_valido, mesma regra de src/lib/campos.ts;
--      casos em tests/db/campos_casos.json). Erro 23514 com o rótulo do campo.
--      Chave com valor null sai do objeto (é assim que o app limpa um campo).
--      Valor igual ao que já estava passa sem validar: campo desativado, campo
--      de outro funil (lead que trocou de funil) ou de outra unidade (lead
--      transferido) mantém o valor guardado, mas não aceita valor novo.
--      Escritas feitas como supabase_admin não são validadas: é o papel de
--      mesclar_leads (SECURITY DEFINER), que junta valores já gravados, e o das
--      migrações. O app grava como authenticated ou service_role.
--   3. RLS em campos_lead: leitura para membros da unidade e admin global; criar
--      e alterar só gestor da unidade (is_gestor() + user_units) ou admin global,
--      como motivos_perda na 126.
--   4. mesclar_leads: corpo da 128 (status, lead_tags, lead_anexos) mais a fusão
--      de campos: o valor do lead mantido vence; as chaves que ele não tem vêm do
--      removido. Nenhuma FK nova para leads: a lista da trava não muda.
--   As views leads_kanban/leads_arquivados não mudam (a ficha lê leads.campos) e
--   não há índice GIN em leads.campos (nenhum filtro do servidor usa ainda).
--
-- Depende da 126, 127 e 128: mesclar_leads parte do corpo da 128, e a última
-- aplicada é a que vale. Aplicar em produção é [H]: o Infra aplica, com
-- aprovação e backup do dia, como supabase_admin, com --single-transaction;
-- depois registra a versão '129' e roda notify pgrst, 'reload schema'. Sem
-- BEGIN/COMMIT. Idempotente. ADD COLUMN com DEFAULT constante não reescreve
-- leads. Depois de um restore, reaplicar por último (depois de 118, 121, 126,
-- 127 e 128).
--
-- Reversão (só com aprovação; perde os valores gravados): reaplicar a 128
-- (mesclar_leads sem campos) e depois
--   DROP TRIGGER IF EXISTS trg_lead_campos ON public.leads;
--   ALTER TABLE public.leads DROP COLUMN IF EXISTS campos;
--   DROP TABLE IF EXISTS public.campos_lead;
--   DROP FUNCTION IF EXISTS public.fn_lead_campos(), public.fn_campo_lead(),
--     public.campo_valor_valido(text, jsonb, jsonb), public.campo_opcoes_validas(jsonb),
--     public.campo_chave_slug(text);

SET LOCAL lock_timeout = '5s';

DO $$
BEGIN
  IF current_setting('lock_timeout') <> '5s' THEN
    RAISE EXCEPTION '129: rode com --single-transaction (lock_timeout atual: %)', current_setting('lock_timeout');
  END IF;
  IF current_user <> 'supabase_admin' THEN
    RAISE EXCEPTION '129: rodar como supabase_admin (atual: %)', current_user;
  END IF;
  IF to_regprocedure('public.is_gestor()') IS NULL THEN
    RAISE EXCEPTION '129: depende da 113 (is_gestor)';
  END IF;
  IF to_regprocedure('public.mesclar_leads(uuid,uuid,uuid)') IS NULL THEN
    RAISE EXCEPTION '129: depende da 121 (mesclar_leads)';
  END IF;
  IF to_regclass('public.motivos_perda') IS NULL
     OR NOT EXISTS (SELECT 1 FROM pg_attribute
                     WHERE attrelid = 'public.leads'::regclass AND attname = 'status' AND NOT attisdropped) THEN
    RAISE EXCEPTION '129: depende da 126 (leads.status, motivos_perda): mesclar_leads parte do corpo dela';
  END IF;
  IF to_regclass('public.lead_tags') IS NULL THEN
    RAISE EXCEPTION '129: depende da 127 (lead_tags): mesclar_leads parte do corpo dela';
  END IF;
  IF to_regclass('public.lead_anexos') IS NULL THEN
    RAISE EXCEPTION '129: depende da 128 (lead_anexos): mesclar_leads parte do corpo dela';
  END IF;
END $$;

-- ── 1. Regras puras (as mesmas de src/lib/campos.ts) ─────────────────────────
-- translate em vez de lower/unaccent: dá o mesmo resultado em qualquer collation
-- e sem extensão, e o app reproduz a tabela letra a letra.
CREATE OR REPLACE FUNCTION public.campo_chave_slug(rotulo text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
 SET search_path TO ''
AS $function$
  SELECT coalesce(nullif(btrim(left(btrim(regexp_replace(
           translate(coalesce(rotulo, ''),
             'ÁÀÂÃÄÅáàâãäåªÉÈÊËéèêëÍÌÎÏíìîïÓÒÔÕÖóòôõöºÚÙÛÜúùûüÇçÑñÝýÿABCDEFGHIJKLMNOPQRSTUVWXYZ',
             'aaaaaaaaaaaaaeeeeeeeeiiiiiiiiooooooooooouuuuuuuuccnnyyyabcdefghijklmnopqrstuvwxyz'),
           '[^a-z0-9]+', '_', 'g'), '_'), 40), '_'), ''), 'campo');
$function$;

CREATE OR REPLACE FUNCTION public.campo_opcoes_validas(opcoes jsonb)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
 SET search_path TO ''
AS $function$
  SELECT coalesce(jsonb_typeof(opcoes) = 'array'
     AND jsonb_array_length(opcoes) BETWEEN 1 AND 100
     AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(opcoes) e
                      WHERE jsonb_typeof(e) <> 'string'
                         OR btrim(e #>> '{}') = ''
                         OR btrim(e #>> '{}') <> e #>> '{}'
                         OR char_length(e #>> '{}') > 100)
     AND (SELECT count(DISTINCT e) FROM jsonb_array_elements(opcoes) e) = jsonb_array_length(opcoes), false);
$function$;

CREATE OR REPLACE FUNCTION public.campo_valor_valido(tipo text, opcoes jsonb, valor jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 IMMUTABLE PARALLEL SAFE
 SET search_path TO ''
AS $function$
DECLARE
  t text := jsonb_typeof(valor);
  s text;
BEGIN
  IF valor IS NULL THEN
    RETURN false;
  END IF;
  s := CASE WHEN t = 'string' THEN valor #>> '{}' END;
  CASE tipo
    WHEN 'texto' THEN
      RETURN t = 'string' AND btrim(s) <> '' AND char_length(s) <= 2000;
    WHEN 'numero' THEN
      RETURN t = 'number';
    WHEN 'moeda' THEN
      RETURN t = 'number' AND valor::numeric = round(valor::numeric, 2);
    WHEN 'sim_nao' THEN
      RETURN t = 'boolean';
    WHEN 'data' THEN
      IF t <> 'string' OR s !~ '^(19|2[01])[0-9]{2}-[0-9]{2}-[0-9]{2}$' THEN
        RETURN false;
      END IF;
      BEGIN
        RETURN to_char(make_date(substr(s, 1, 4)::int, substr(s, 6, 2)::int, substr(s, 9, 2)::int), 'YYYY-MM-DD') = s;
      EXCEPTION WHEN OTHERS THEN
        RETURN false;
      END;
    WHEN 'selecao' THEN
      RETURN t = 'string' AND jsonb_typeof(opcoes) = 'array' AND opcoes ? s;
    WHEN 'multipla' THEN
      RETURN t = 'array' AND jsonb_typeof(opcoes) = 'array'
        AND jsonb_array_length(valor) > 0
        AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(valor) e
                         WHERE jsonb_typeof(e) <> 'string' OR NOT opcoes ? (e #>> '{}'))
        AND (SELECT count(DISTINCT e) FROM jsonb_array_elements(valor) e) = jsonb_array_length(valor);
    WHEN 'telefone' THEN
      RETURN t = 'string' AND s ~ '^[0-9 ()+.-]+$'
        AND char_length(regexp_replace(s, '[^0-9]', '', 'g')) BETWEEN 8 AND 15;
    WHEN 'email' THEN
      RETURN t = 'string' AND char_length(s) <= 254 AND s ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$';
    ELSE
      RETURN false;
  END CASE;
END;
$function$;

-- O trigger de leads roda como quem grava (authenticated/service_role) e chama estas
REVOKE EXECUTE ON FUNCTION
  public.campo_chave_slug(text),
  public.campo_opcoes_validas(jsonb),
  public.campo_valor_valido(text, jsonb, jsonb)
FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION
  public.campo_chave_slug(text),
  public.campo_opcoes_validas(jsonb),
  public.campo_valor_valido(text, jsonb, jsonb)
TO authenticated, service_role;

-- ── 2. campos_lead ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.campos_lead (
  id        uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id   uuid        NOT NULL REFERENCES public.units (id) ON DELETE CASCADE,
  funnel_id uuid        REFERENCES public.funnels (id) ON DELETE CASCADE,
  chave     text        NOT NULL CHECK (chave ~ '^[a-z0-9]+(_[a-z0-9]+)*$' AND char_length(chave) <= 40),
  rotulo    text        NOT NULL CHECK (btrim(rotulo) <> '' AND char_length(rotulo) <= 80),
  tipo      text        NOT NULL CHECK (tipo IN ('texto', 'numero', 'data', 'selecao', 'multipla',
                                                 'sim_nao', 'telefone', 'email', 'moeda')),
  opcoes    jsonb,
  ordem     integer     NOT NULL DEFAULT 0,
  ativo     boolean     NOT NULL DEFAULT true,
  criado_em timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT campos_lead_unit_chave_key UNIQUE (unit_id, chave),
  CONSTRAINT campos_lead_opcoes_check CHECK (
    CASE WHEN tipo IN ('selecao', 'multipla') THEN public.campo_opcoes_validas(opcoes) ELSE opcoes IS NULL END)
);

ALTER TABLE public.campos_lead OWNER TO postgres;

CREATE INDEX IF NOT EXISTS idx_campos_lead_funnel ON public.campos_lead (funnel_id) WHERE funnel_id IS NOT NULL;

-- As funções de trigger rodam como quem escreve e usam search_path 'public' (ver
-- a nota da 126: as policies que elas disparam chamam is_global_admin()).
CREATE OR REPLACE FUNCTION public.fn_campo_lead()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  unidade_funil uuid;
  base text;
  n integer := 1;
BEGIN
  NEW.rotulo := btrim(NEW.rotulo);

  IF TG_OP = 'UPDATE' THEN
    IF NEW.chave IS DISTINCT FROM OLD.chave THEN
      RAISE EXCEPTION 'A chave do campo "%" não muda (os valores gravados dependem dela)', OLD.rotulo
        USING ERRCODE = '23514';
    END IF;
    IF NEW.tipo IS DISTINCT FROM OLD.tipo THEN
      RAISE EXCEPTION 'O tipo do campo "%" não muda depois de criado: desative-o e crie outro', OLD.rotulo
        USING ERRCODE = '23514';
    END IF;
    IF NEW.unit_id IS DISTINCT FROM OLD.unit_id THEN
      RAISE EXCEPTION 'O campo "%" não muda de unidade', OLD.rotulo USING ERRCODE = '23514';
    END IF;
  END IF;

  IF NEW.funnel_id IS NOT NULL THEN
    SELECT f.unit_id INTO unidade_funil FROM public.funnels f WHERE f.id = NEW.funnel_id;
    IF NEW.unit_id IS NULL THEN
      NEW.unit_id := unidade_funil;
    ELSIF unidade_funil IS DISTINCT FROM NEW.unit_id THEN
      RAISE EXCEPTION 'O funil do campo "%" é de outra unidade', NEW.rotulo USING ERRCODE = '23514';
    END IF;
  END IF;

  IF TG_OP = 'INSERT' AND coalesce(NEW.chave, '') = '' THEN
    base := public.campo_chave_slug(NEW.rotulo);
    NEW.chave := base;
    WHILE EXISTS (SELECT 1 FROM public.campos_lead c WHERE c.unit_id = NEW.unit_id AND c.chave = NEW.chave) LOOP
      n := n + 1;
      NEW.chave := btrim(left(base, 39 - char_length(n::text)), '_') || '_' || n;
    END LOOP;
  END IF;

  IF NEW.tipo NOT IN ('selecao', 'multipla') THEN
    NEW.opcoes := NULL;
  ELSIF NOT public.campo_opcoes_validas(NEW.opcoes) THEN
    RAISE EXCEPTION 'O campo "%" precisa de 1 a 100 opções, sem repetir e sem espaços nas pontas', NEW.rotulo
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_campo_lead ON public.campos_lead;
CREATE TRIGGER trg_campo_lead
  BEFORE INSERT OR UPDATE ON public.campos_lead
  FOR EACH ROW EXECUTE FUNCTION public.fn_campo_lead();

ALTER TABLE public.campos_lead ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.campos_lead FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.campos_lead TO authenticated;
GRANT ALL ON public.campos_lead TO service_role;

DO $$
DECLARE
  regra_unidade constant text :=
    '(( SELECT is_global_admin() AS is_global_admin) OR (unit_id IN ( SELECT user_units.unit_id '
    'FROM user_units WHERE (user_units.user_id = ( SELECT auth.uid() AS uid)))))';
  regra_gestor constant text :=
    '(( SELECT is_global_admin() AS is_global_admin) OR (( SELECT is_gestor() AS is_gestor) AND '
    '(unit_id IN ( SELECT user_units.unit_id FROM user_units WHERE (user_units.user_id = ( SELECT auth.uid() AS uid))))))';
BEGIN
  DROP POLICY IF EXISTS unit_members_campos_lead_select ON public.campos_lead;
  DROP POLICY IF EXISTS gestores_campos_lead_insert ON public.campos_lead;
  DROP POLICY IF EXISTS gestores_campos_lead_update ON public.campos_lead;
  EXECUTE format('CREATE POLICY unit_members_campos_lead_select ON public.campos_lead AS PERMISSIVE FOR SELECT TO public USING (%s)',
                 regra_unidade);
  EXECUTE format('CREATE POLICY gestores_campos_lead_insert ON public.campos_lead AS PERMISSIVE FOR INSERT TO public WITH CHECK (%s)',
                 regra_gestor);
  EXECUTE format('CREATE POLICY gestores_campos_lead_update ON public.campos_lead AS PERMISSIVE FOR UPDATE TO public USING (%s) WITH CHECK (%s)',
                 regra_gestor, regra_gestor);
END $$;

-- Policies se somam (OR): sobrando outra PERMISSIVE de escrita, o atendente
-- continuaria configurando campos. Aborta nesse caso.
DO $$
DECLARE outras text;
BEGIN
  SELECT string_agg(policyname, ', ') INTO outras
    FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'campos_lead'
     AND cmd IN ('INSERT', 'UPDATE', 'DELETE', 'ALL') AND permissive = 'PERMISSIVE'
     AND policyname NOT IN ('gestores_campos_lead_insert', 'gestores_campos_lead_update');
  IF outras IS NOT NULL THEN
    RAISE EXCEPTION '129: outras policies de escrita em campos_lead anulariam a regra de gestor: %', outras;
  END IF;
END $$;

-- ── 3. leads.campos e validação ──────────────────────────────────────────────
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS campos jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE OR REPLACE FUNCTION public.fn_lead_campos()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  k text;
  v jsonb;
  c public.campos_lead%ROWTYPE;
BEGIN
  NEW.campos := coalesce(NEW.campos, '{}'::jsonb);
  IF jsonb_typeof(NEW.campos) <> 'object' THEN
    RAISE EXCEPTION 'leads.campos tem de ser um objeto {chave: valor}' USING ERRCODE = '23514';
  END IF;
  NEW.campos := (SELECT coalesce(jsonb_object_agg(e.key, e.value), '{}'::jsonb)
                   FROM jsonb_each(NEW.campos) e WHERE jsonb_typeof(e.value) <> 'null');

  IF current_user = 'supabase_admin' THEN
    RETURN NEW;
  END IF;

  FOR k, v IN SELECT e.key, e.value FROM jsonb_each(NEW.campos) e LOOP
    IF TG_OP = 'UPDATE' AND OLD.campos -> k = v THEN
      CONTINUE;
    END IF;
    SELECT * INTO c FROM public.campos_lead WHERE unit_id = NEW.unit_id AND chave = k;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Campo desconhecido nesta unidade: %', k USING ERRCODE = '23514';
    END IF;
    IF NOT c.ativo THEN
      RAISE EXCEPTION 'O campo "%" está desativado: o valor guardado não pode mudar', c.rotulo USING ERRCODE = '23514';
    END IF;
    IF c.funnel_id IS NOT NULL AND c.funnel_id IS DISTINCT FROM NEW.funnel_id THEN
      RAISE EXCEPTION 'O campo "%" é de outro funil', c.rotulo USING ERRCODE = '23514';
    END IF;
    IF NOT public.campo_valor_valido(c.tipo, c.opcoes, v) THEN
      RAISE EXCEPTION 'Valor inválido para o campo "%" (%): %', c.rotulo, c.tipo, left(v::text, 100)
        USING ERRCODE = '23514';
    END IF;
  END LOOP;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_lead_campos ON public.leads;
CREATE TRIGGER trg_lead_campos
  BEFORE INSERT OR UPDATE OF campos ON public.leads
  FOR EACH ROW EXECUTE FUNCTION public.fn_lead_campos();

REVOKE EXECUTE ON FUNCTION public.fn_campo_lead(), public.fn_lead_campos() FROM PUBLIC, anon, authenticated;

-- ── 4. mesclar_leads com campos ──────────────────────────────────────────────
-- Corpo da 128 (= 127 + lead_anexos), mais campos no UPDATE de `manter`.
CREATE OR REPLACE FUNCTION public.mesclar_leads(manter uuid, remover uuid, por uuid DEFAULT NULL)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  lm public.leads%ROWTYPE;
  lr public.leads%ROWTYPE;
  nr public.lead_negotiation%ROWTYPE;
  sem_tratamento text;
  status_final text;
  motivo_de_lr boolean;
BEGIN
  -- Depois de um restore o EXECUTE volta para authenticated (ver CLAUDE.md); a
  -- função não pode depender só do GRANT, porque apaga lead de qualquer unidade.
  IF coalesce(auth.role(), '') IN ('anon', 'authenticated') THEN
    RAISE EXCEPTION 'mesclar_leads: só o servidor mescla leads (api/leads/mesclar)' USING ERRCODE = '42501';
  END IF;
  IF manter IS NULL OR remover IS NULL THEN
    RAISE EXCEPTION 'mesclar_leads: informe os dois leads' USING ERRCODE = '22004';
  END IF;
  IF manter = remover THEN
    RAISE EXCEPTION 'mesclar_leads: o lead a manter e o lead a remover são o mesmo' USING ERRCODE = '22023';
  END IF;

  PERFORM 1 FROM public.leads WHERE id IN (manter, remover) ORDER BY id FOR UPDATE;
  SELECT * INTO lm FROM public.leads WHERE id = manter;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'mesclar_leads: lead % não existe', manter USING ERRCODE = 'P0002';
  END IF;
  SELECT * INTO lr FROM public.leads WHERE id = remover;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'mesclar_leads: lead % não existe', remover USING ERRCODE = 'P0002';
  END IF;
  IF lm.unit_id IS DISTINCT FROM lr.unit_id THEN
    RAISE EXCEPTION 'mesclar_leads: os leads são de unidades diferentes' USING ERRCODE = '22023';
  END IF;

  SELECT string_agg(format('%s.%s', c.conrelid::regclass, a.attname), ', ') INTO sem_tratamento
    FROM pg_catalog.pg_constraint c
    JOIN pg_catalog.pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
   WHERE c.contype = 'f'
     AND c.confrelid = 'public.leads'::regclass
     AND format('%s.%s', c.conrelid::regclass, a.attname) <> ALL (ARRAY[
       'public.lead_contacts.lead_id', 'public.lead_notes.lead_id', 'public.lead_tasks.lead_id',
       'public.lead_responsible_history.lead_id', 'public.lead_stage_history.lead_id',
       'public.notifications.lead_id', 'public.wa_conversations.lead_id',
       'public.wa_campaign_recipients.lead_id', 'public.wa_timed_automation_log.lead_id',
       'public.quotes.lead_id', 'public.lead_negotiation.lead_id', 'public.automation_runs.lead_id',
       'public.lead_tags.lead_id', 'public.lead_anexos.lead_id']);
  IF sem_tratamento IS NOT NULL THEN
    RAISE EXCEPTION 'mesclar_leads: chave estrangeira para leads sem tratamento: %', sem_tratamento;
  END IF;

  UPDATE public.lead_contacts            SET lead_id = manter WHERE lead_id = remover;
  UPDATE public.lead_notes               SET lead_id = manter WHERE lead_id = remover;
  UPDATE public.lead_tasks               SET lead_id = manter WHERE lead_id = remover;
  UPDATE public.lead_responsible_history SET lead_id = manter WHERE lead_id = remover;
  UPDATE public.lead_stage_history       SET lead_id = manter WHERE lead_id = remover;
  UPDATE public.notifications            SET lead_id = manter WHERE lead_id = remover;
  UPDATE public.wa_conversations         SET lead_id = manter WHERE lead_id = remover;
  UPDATE public.wa_campaign_recipients   SET lead_id = manter WHERE lead_id = remover;
  UPDATE public.wa_timed_automation_log  SET lead_id = manter WHERE lead_id = remover;
  UPDATE public.quotes                   SET lead_id = manter WHERE lead_id = remover;
  UPDATE public.automation_runs          SET lead_id = manter WHERE lead_id = remover;
  UPDATE public.lead_anexos              SET lead_id = manter WHERE lead_id = remover;

  -- Os dois podem ter a mesma tag (chave primária lead_id, tag_id)
  INSERT INTO public.lead_tags (lead_id, tag_id, unit_id, criado_em, criado_por)
  SELECT manter, tag_id, unit_id, criado_em, criado_por FROM public.lead_tags WHERE lead_id = remover
  ON CONFLICT (lead_id, tag_id) DO NOTHING;
  DELETE FROM public.lead_tags WHERE lead_id = remover;

  SELECT * INTO nr FROM public.lead_negotiation WHERE lead_id = remover;
  IF FOUND THEN
    IF EXISTS (SELECT 1 FROM public.lead_negotiation WHERE lead_id = manter) THEN
      UPDATE public.lead_negotiation
         SET valor_proposta  = coalesce(valor_proposta, nr.valor_proposta),
             modelo          = coalesce(modelo, nr.modelo),
             valor_negociado = coalesce(valor_negociado, nr.valor_negociado)
       WHERE lead_id = manter;
      DELETE FROM public.lead_negotiation WHERE lead_id = remover;
    ELSE
      UPDATE public.lead_negotiation SET lead_id = manter WHERE lead_id = remover;
    END IF;
  END IF;

  -- Negócio: ganho em qualquer um vale; senão, aberto em qualquer um vale
  status_final := CASE
    WHEN 'ganho'  IN (lm.status, lr.status) THEN 'ganho'
    WHEN 'aberto' IN (lm.status, lr.status) THEN 'aberto'
    ELSE 'perdido'
  END;
  -- Os dois perdidos: fica o motivo da perda mais recente
  motivo_de_lr := lr.status = 'perdido'
    AND (lm.status <> 'perdido'
         OR (lr.perdido_em IS NOT NULL AND (lm.perdido_em IS NULL OR lr.perdido_em > lm.perdido_em)));

  -- Apaga antes de completar `manter`: com o índice único da 122, copiar o
  -- telefone de `remover` para `manter` com os dois ainda vivos daria 23505
  DELETE FROM public.leads WHERE id = remover;

  UPDATE public.leads
     SET telefone        = coalesce(lm.telefone, lr.telefone),
         email           = coalesce(lm.email, lr.email),
         cpf             = coalesce(lm.cpf, lr.cpf),
         data_nascimento = coalesce(lm.data_nascimento, lr.data_nascimento),
         sobrenome       = coalesce(lm.sobrenome, lr.sobrenome),
         observacoes_cli = coalesce(lm.observacoes_cli, lr.observacoes_cli),
         origem          = coalesce(lm.origem, lr.origem),
         campanha_id     = coalesce(lm.campanha_id, lr.campanha_id),
         -- `||` fica com o valor da direita: o do lead mantido vence
         campos          = lr.campos || lm.campos,
         is_converted    = lm.is_converted OR lr.is_converted,
         status          = status_final,
         ganho_em        = greatest(lm.ganho_em, lr.ganho_em),
         perdido_em      = greatest(lm.perdido_em, lr.perdido_em),
         motivo_perda_id = CASE WHEN status_final <> 'perdido' THEN NULL
                                WHEN motivo_de_lr THEN lr.motivo_perda_id ELSE lm.motivo_perda_id END,
         motivo_perda    = CASE WHEN status_final <> 'perdido' THEN NULL
                                WHEN motivo_de_lr THEN lr.motivo_perda ELSE lm.motivo_perda END,
         wa_optin_at     = least(lm.wa_optin_at, lr.wa_optin_at),
         -- opt-out é obrigação legal: basta um dos dois ter pedido
         wa_optout_at    = coalesce(lm.wa_optout_at, lr.wa_optout_at),
         created_at      = least(lm.created_at, lr.created_at)
   WHERE id = manter;

  INSERT INTO public.lead_notes (lead_id, unit_id, autor_id, conteudo)
  VALUES (manter, lm.unit_id, por,
          format('Lead mesclado com %s em %s',
                 concat_ws(' ', lr.nome, lr.sobrenome),
                 to_char(now() AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI')));
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.mesclar_leads(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.mesclar_leads(uuid, uuid, uuid) TO service_role;

-- ── Conferência ──────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.campos_lead'::regclass) THEN
    RAISE EXCEPTION '129: RLS desligado em campos_lead';
  END IF;
  IF has_table_privilege('anon', 'public.campos_lead', 'SELECT')
     OR has_table_privilege('authenticated', 'public.campos_lead', 'DELETE,TRUNCATE') THEN
    RAISE EXCEPTION '129: privilégios inesperados em campos_lead para anon/authenticated';
  END IF;
  IF (SELECT pg_get_userbyid(proowner) FROM pg_proc WHERE oid = 'public.mesclar_leads(uuid,uuid,uuid)'::regprocedure)
     <> 'supabase_admin' THEN
    RAISE EXCEPTION '129: mesclar_leads deveria ser de supabase_admin (fn_lead_campos não valida o que ela junta)';
  END IF;
  IF has_function_privilege('authenticated', 'public.mesclar_leads(uuid,uuid,uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.mesclar_leads(uuid,uuid,uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.fn_lead_campos()', 'EXECUTE')
     OR has_function_privilege('anon', 'public.campo_valor_valido(text,jsonb,jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION '129: funções executáveis por anon/authenticated';
  END IF;
END $$;
