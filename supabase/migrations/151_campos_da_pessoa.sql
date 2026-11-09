-- 151_campos_da_pessoa.sql
-- Campos personalizados da pessoa (contato) e do negócio (lead). Fase 3·2,
-- entrega 6 (ADR 0001).
--
-- Por quê: com vários negócios por contato (150), o que é da pessoa (convênio,
-- data de nascimento do filho, alergias) não pode ficar repetido em cada negócio;
-- o que é da oportunidade (vacinas de interesse, valor pretendido) continua no
-- negócio. Produção em 09/11: nenhum campo personalizado criado e nenhum valor
-- gravado, então nada muda de lugar.
--
-- O que faz:
--   1. campos_lead.objeto ('negocio' padrão | 'contato'). Campo da pessoa vale
--      para a unidade inteira (sem funil). objeto não muda depois de criado.
--   2. contatos.campos jsonb, validado por fn_contato_campos com a mesma regra de
--      leads.campos (campo ativo da unidade, objeto 'contato', valor do tipo).
--      O app grava (GRANT UPDATE (campos) para authenticated; a policy da 149 só
--      deixa o titular da própria unidade).
--   3. fn_lead_campos recusa campo da pessoa em leads.campos, menos no INSERT:
--      um lead novo (importação) pode trazer campos da pessoa, e fn_lead_contato
--      os leva ao contato (criado ou achado pelo telefone, 150) antes da checagem
--      dos obrigatórios. Com contato existente, o valor que ele já tem vence.
--   4. fn_lead_obrigatorios: campo da pessoa exigido pela etapa é procurado no
--      contato do negócio.
--   5. leads_kanban.campos = campos do negócio || campos da pessoa: o quadro e os
--      filtros por campo veem os dois (as chaves são únicas na unidade).
--
-- Aplicar em produção é [H]: o Infra aplica, com aprovação e backup do dia, como
-- supabase_admin, com --single-transaction; depois registra a versão '151' e roda
-- notify pgrst, 'reload schema'. Sem BEGIN/COMMIT. Idempotente. Antes do deploy
-- do app (o app novo grava contatos.campos e lê campos_lead.objeto).
-- Depois de um restore: reaplicar depois da 130, da 134 e da 150 (ordem
-- pós-restore). A 132 ou a 134 reaplicadas depois desta tiram os campos da pessoa
-- da view: reaplicar a 151 em seguida.
--
-- Reversão (só com aprovação; perde os valores da pessoa): reaplicar 129, 130,
-- 134 e 150, e depois
--   DROP TRIGGER IF EXISTS trg_contato_campos ON public.contatos;
--   DROP FUNCTION IF EXISTS public.fn_contato_campos();
--   ALTER TABLE public.contatos DROP COLUMN IF EXISTS campos;
--   ALTER TABLE public.campos_lead DROP COLUMN IF EXISTS objeto;

SET LOCAL lock_timeout = '5s';

DO $$
BEGIN
  IF current_setting('lock_timeout') <> '5s' THEN
    RAISE EXCEPTION '151: rode com --single-transaction (lock_timeout atual: %)', current_setting('lock_timeout');
  END IF;
  IF current_user <> 'supabase_admin' THEN
    RAISE EXCEPTION '151: rodar como supabase_admin (atual: %)', current_user;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'leads_kanban' AND column_name = 'campos') THEN
    RAISE EXCEPTION '151: depende da 134 (leads_kanban com campos; depois de reaplicar a 132, reaplique a 134 antes)';
  END IF;
  IF to_regclass('public.contatos') IS NULL THEN
    RAISE EXCEPTION '151: depende da 148 (contatos)';
  END IF;
END $$;

-- ── 1. Campo da pessoa ou do negócio ─────────────────────────────────────────
ALTER TABLE public.campos_lead ADD COLUMN IF NOT EXISTS objeto text NOT NULL DEFAULT 'negocio';
ALTER TABLE public.campos_lead DROP CONSTRAINT IF EXISTS campos_lead_objeto_check;
ALTER TABLE public.campos_lead ADD CONSTRAINT campos_lead_objeto_check
  CHECK (objeto IN ('negocio', 'contato') AND (objeto = 'negocio' OR funnel_id IS NULL));

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
    IF NEW.objeto IS DISTINCT FROM OLD.objeto THEN
      RAISE EXCEPTION 'O campo "%" não muda entre pessoa e negócio depois de criado: desative-o e crie outro', OLD.rotulo
        USING ERRCODE = '23514';
    END IF;
  END IF;

  IF NEW.objeto = 'contato' AND NEW.funnel_id IS NOT NULL THEN
    RAISE EXCEPTION 'O campo "%" é da pessoa: vale para todos os funis', NEW.rotulo USING ERRCODE = '23514';
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

-- ── 2. contatos.campos ───────────────────────────────────────────────────────
ALTER TABLE public.contatos ADD COLUMN IF NOT EXISTS campos jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE OR REPLACE FUNCTION public.fn_contato_campos()
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
    RAISE EXCEPTION 'contatos.campos tem de ser um objeto {chave: valor}' USING ERRCODE = '23514';
  END IF;
  NEW.campos := (SELECT coalesce(jsonb_object_agg(e.key, e.value), '{}'::jsonb)
                   FROM jsonb_each(NEW.campos) e WHERE jsonb_typeof(e.value) <> 'null');

  -- Gravação do banco (espelhos SECURITY DEFINER, migrações) junta valores já validados
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
    IF c.objeto <> 'contato' THEN
      RAISE EXCEPTION 'O campo "%" é do negócio: grave no negócio', c.rotulo USING ERRCODE = '23514';
    END IF;
    IF NOT c.ativo THEN
      RAISE EXCEPTION 'O campo "%" está desativado: o valor guardado não pode mudar', c.rotulo USING ERRCODE = '23514';
    END IF;
    IF NOT public.campo_valor_valido(c.tipo, c.opcoes, v) THEN
      RAISE EXCEPTION 'Valor inválido para o campo "%" (%): %', c.rotulo, c.tipo, left(v::text, 100)
        USING ERRCODE = '23514';
    END IF;
  END LOOP;
  RETURN NEW;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.fn_contato_campos() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_contato_campos ON public.contatos;
CREATE TRIGGER trg_contato_campos
  BEFORE INSERT OR UPDATE OF campos ON public.contatos
  FOR EACH ROW EXECUTE FUNCTION public.fn_contato_campos();

GRANT UPDATE (campos) ON public.contatos TO authenticated;

-- ── 3. leads.campos só com campos do negócio ─────────────────────────────────
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
    -- No INSERT o campo da pessoa é validado aqui e fn_lead_contato o leva ao contato
    -- (a importação traz tudo numa linha); depois, só pelo contato
    IF c.objeto = 'contato' AND TG_OP = 'UPDATE' THEN
      RAISE EXCEPTION 'O campo "%" é da pessoa: grave no contato', c.rotulo USING ERRCODE = '23514';
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

-- Lead novo: a pessoa vem do contato (150) e os campos da pessoa vão para ele
CREATE OR REPLACE FUNCTION public.fn_lead_contato()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_contato public.contatos%ROWTYPE;
  v_pessoa jsonb;
BEGIN
  -- Campos da pessoa (já validados por fn_lead_campos) saem do negócio
  SELECT coalesce(jsonb_object_agg(e.key, e.value), '{}'::jsonb) INTO v_pessoa
    FROM jsonb_each(coalesce(NEW.campos, '{}'::jsonb)) e
    JOIN public.campos_lead cl ON cl.unit_id = NEW.unit_id AND cl.chave = e.key AND cl.objeto = 'contato';
  NEW.campos := coalesce(NEW.campos, '{}'::jsonb) - ARRAY(SELECT jsonb_object_keys(v_pessoa));

  IF NEW.contato_id IS NULL AND public.normalizar_telefone(NEW.telefone) IS NOT NULL THEN
    SELECT c.id INTO NEW.contato_id
      FROM public.contatos c
     WHERE c.unit_id = NEW.unit_id
       AND c.responsavel_id IS NULL
       AND c.telefone_norm = public.normalizar_telefone(NEW.telefone);
  END IF;

  IF NEW.contato_id IS NULL THEN
    INSERT INTO public.contatos (id, unit_id, nome, sobrenome, telefone, email, cpf, data_nascimento, profissao,
                                 cidade, estado, pais, instagram, site, observacoes, cliente, wa_optin_at, wa_optout_at,
                                 campos)
    VALUES (NEW.id, NEW.unit_id, NEW.nome, NEW.sobrenome, NEW.telefone, NEW.email, NEW.cpf, NEW.data_nascimento,
            NEW.profissao, NEW.cidade, NEW.estado, NEW.pais, NEW.instagram, NEW.site, NEW.observacoes_cli,
            coalesce(NEW.is_converted, false), NEW.wa_optin_at, NEW.wa_optout_at, v_pessoa);
    NEW.contato_id := NEW.id;
    RETURN NEW;
  END IF;

  SELECT * INTO v_contato FROM public.contatos WHERE id = NEW.contato_id;
  IF NOT FOUND OR v_contato.unit_id IS DISTINCT FROM NEW.unit_id OR v_contato.responsavel_id IS NOT NULL THEN
    RAISE EXCEPTION 'contato % não é um titular da unidade do negócio', NEW.contato_id USING ERRCODE = '23514';
  END IF;

  -- O contato ganha o que ainda não tem; o negócio fica com a pessoa do contato
  UPDATE public.contatos c
     SET sobrenome = coalesce(c.sobrenome, NEW.sobrenome), email = coalesce(c.email, NEW.email),
         cpf = coalesce(c.cpf, NEW.cpf), data_nascimento = coalesce(c.data_nascimento, NEW.data_nascimento),
         profissao = coalesce(c.profissao, NEW.profissao), cidade = coalesce(c.cidade, NEW.cidade),
         estado = coalesce(c.estado, NEW.estado), pais = coalesce(c.pais, NEW.pais),
         instagram = coalesce(c.instagram, NEW.instagram), site = coalesce(c.site, NEW.site),
         observacoes = coalesce(c.observacoes, NEW.observacoes_cli),
         wa_optin_at = coalesce(c.wa_optin_at, NEW.wa_optin_at), wa_optout_at = coalesce(c.wa_optout_at, NEW.wa_optout_at),
         cliente = c.cliente OR coalesce(NEW.is_converted, false),
         campos = v_pessoa || c.campos
   WHERE c.id = NEW.contato_id
  RETURNING * INTO v_contato;

  NEW.nome := v_contato.nome; NEW.sobrenome := v_contato.sobrenome; NEW.telefone := v_contato.telefone;
  NEW.email := v_contato.email; NEW.cpf := v_contato.cpf; NEW.data_nascimento := v_contato.data_nascimento;
  NEW.profissao := v_contato.profissao; NEW.cidade := v_contato.cidade; NEW.estado := v_contato.estado;
  NEW.pais := v_contato.pais; NEW.instagram := v_contato.instagram; NEW.site := v_contato.site;
  NEW.observacoes_cli := v_contato.observacoes;
  NEW.wa_optin_at := v_contato.wa_optin_at; NEW.wa_optout_at := v_contato.wa_optout_at;
  RETURN NEW;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.fn_lead_contato() FROM PUBLIC, anon, authenticated;

-- ── 4. Obrigatórios por etapa: campo da pessoa vem do contato ────────────────
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
  campos_pessoa jsonb;
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
      IF c.objeto = 'contato' THEN
        IF campos_pessoa IS NULL THEN
          SELECT ct.campos INTO campos_pessoa FROM public.contatos ct WHERE ct.id = NEW.contato_id;
          campos_pessoa := coalesce(campos_pessoa, '{}'::jsonb);
        END IF;
        vazio := coalesce(jsonb_typeof(campos_pessoa -> item), 'null') = 'null';
      ELSE
        vazio := coalesce(jsonb_typeof(NEW.campos -> item), 'null') = 'null';
      END IF;
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

REVOKE EXECUTE ON FUNCTION public.fn_campo_lead(), public.fn_lead_campos(), public.fn_lead_obrigatorios()
  FROM PUBLIC, anon, authenticated;

-- ── 5. O quadro vê os campos do negócio e da pessoa ──────────────────────────
-- Definição EXATA da 134, com campos = negócio || pessoa e o contato no FROM
CREATE OR REPLACE VIEW public.leads_kanban WITH (security_invoker = true) AS
 SELECT l.id, l.nome, l.sobrenome, l.profissao, l.cidade, l.estado, l.pais,
    l.instagram, l.site, l.email, l.telefone, l.responsavel_id, l.arquivado,
    l.motivo_perda, l.ordem, l.created_at, l.updated_at, l.funnel_id, l.stage_id,
    l.origem, l.stage_changed_at, l.unit_id, l.is_converted,
    COALESCE(NULLIF(TRIM(p.apelido), ''), split_part(p.full_name, ' ', 1)) AS responsavel_nome,
    p.avatar_url AS responsavel_avatar,
    fs.nome AS stage_nome, fs.cor AS stage_cor, fs.ordem AS stage_ordem,
    fs.alerta_horas AS stage_alerta_horas,
    fs.sla_mensal AS stage_sla_mensal,
    f.nome AS funnel_nome,
    ln.valor_proposta, ln.modelo, ln.valor_negociado,
    (SELECT COALESCE(SUM(q.total_calculado), 0) FROM quotes q
     WHERE q.lead_id = l.id AND q.status IN ('enviado','visualizado','em_negociacao','aceito')
    )::numeric(12,2) AS valor_orcamentos,
    (SELECT MIN(t2.data_limite) FROM lead_tasks t2
     WHERE t2.lead_id = l.id AND t2.concluida = false AND t2.data_limite IS NOT NULL
    ) AS proxima_tarefa_data,
    ((SELECT count(*) FROM lead_tasks t WHERE t.lead_id = l.id AND t.concluida = false))::integer AS tarefas_pendentes,
    ((SELECT count(*) FROM lead_notes n WHERE n.lead_id = l.id))::integer AS total_notas,
    ((SELECT count(*) FROM lead_contacts c WHERE c.lead_id = l.id))::integer AS total_contatos,
    l.status, l.ganho_em, l.perdido_em, l.motivo_perda_id,
    mp.nome AS motivo_perda_nome,
    fs.resultado AS stage_resultado,
    l.arquivado_em, l.arquivado_motivo, l.arquivado_por,
    l.campos || COALESCE(ct.campos, '{}'::jsonb) AS campos
   FROM leads l
     LEFT JOIN profiles p ON p.id = l.responsavel_id
     LEFT JOIN funnel_stages fs ON fs.id = l.stage_id
     LEFT JOIN funnels f ON f.id = l.funnel_id
     LEFT JOIN lead_negotiation ln ON ln.lead_id = l.id
     LEFT JOIN motivos_perda mp ON mp.id = l.motivo_perda_id
     LEFT JOIN contatos ct ON ct.id = l.contato_id
  WHERE NOT l.arquivado
  ORDER BY fs.ordem, l.ordem, l.created_at;

REVOKE ALL ON public.leads_kanban FROM anon;
GRANT SELECT ON public.leads_kanban TO authenticated, service_role;

-- ── Conferência ──────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT has_column_privilege('authenticated', 'public.contatos', 'campos', 'UPDATE')
     OR has_column_privilege('authenticated', 'public.contatos', 'unit_id', 'UPDATE') THEN
    RAISE EXCEPTION '151: privilégios de contatos.campos não ficaram como o esperado';
  END IF;
  IF has_table_privilege('anon', 'public.leads_kanban', 'SELECT')
     OR NOT coalesce((SELECT 'security_invoker=true' = ANY (reloptions) FROM pg_class
                       WHERE oid = 'public.leads_kanban'::regclass), false) THEN
    RAISE EXCEPTION '151: leads_kanban perdeu security_invoker ou abriu para anon';
  END IF;
  IF has_function_privilege('authenticated', 'public.fn_contato_campos()', 'EXECUTE') THEN
    RAISE EXCEPTION '151: fn_contato_campos executável por authenticated';
  END IF;
END $$;
