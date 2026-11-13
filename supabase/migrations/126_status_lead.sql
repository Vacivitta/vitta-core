-- 126_status_lead.sql
-- Status do negócio do lead (aberto | ganho | perdido), motivos de perda por funil
-- e configuração de funis só para gestor.
--
-- Por quê: hoje "perdido" é leads.arquivado (com motivo_perda em texto livre e uma
-- lista fixa no app) ou estar na etapa "Perdido" (117 leads ativos em produção em
-- 04/11/2026); "ganho" é is_converted, que também quer dizer "é cliente" e nunca
-- volta. Não dá para contar negócios ganhos/perdidos por período nem exigir motivo.
-- Além disso qualquer atendente edita funis e etapas (policy FOR ALL da 067/092).
--
-- O que faz:
--   1. leads.status ('aberto' padrão), ganho_em, perdido_em, motivo_perda_id.
--      motivo_perda (texto) fica para o detalhe de "Outro" e para o legado.
--   2. motivos_perda (por funil): leitura para membros da unidade, escrita só
--      gestor da unidade ou admin global. unit_id vem sempre do funil (trigger).
--      Funil novo já nasce com a lista padrão do tipo da unidade (trigger em
--      funnels). Apagar um motivo copia o nome para leads.motivo_perda dos leads
--      que o usavam, para a FK (ON DELETE SET NULL) não violar o CHECK de motivo.
--   3. funnel_stages.resultado (NULL | 'ganho' | 'perdido').
--   4. Trigger em leads (fn_lead_status): entrar numa etapa com resultado muda o
--      status (etapa 'perdido' sem motivo grava 'Movido para a etapa <nome>');
--      sair de uma etapa com resultado para uma sem resultado volta para
--      'aberto'; mudar o status preenche ganho_em/perdido_em, 'ganho' marca
--      is_converted (cliente para sempre) e sair de 'perdido' limpa o motivo.
--      Vale para navegador, service_role e funções (automações que movem para
--      "Perdido" perdem o lead).
--   5. Uma vez só (enquanto leads.arquivado ainda é coluna comum): marca as etapas
--      "Perdido"/"Contrato assinado" e migra os dados (ver regra abaixo); depois
--      troca arquivado por coluna GERADA (status = 'perdido'), para que nenhuma
--      escrita em arquivado sobreviva e as leituras antigas continuem certas.
--   6. Recria leads_kanban (status <> 'perdido') e leads_arquivados (perdidos)
--      com as colunas novas, security_invoker e sem anon (como a 086).
--   7. execute_quote_automation: ramo 'archive' grava status 'perdido'.
--      mesclar_leads: consolida status (ganho > aberto > perdido).
--   8. funnels e funnel_stages: SELECT para membros; INSERT/UPDATE/DELETE só
--      gestor da unidade (is_gestor() + user_units) ou admin global.
--
-- Migração de dados (só na primeira aplicação; reaplicar não mexe em leads):
--   - arquivado → 'perdido', perdido_em = updated_at; motivo casado pelo nome com
--     os motivos do funil do lead ("Outro: x" vira Outro com detalhe "x"; texto
--     sem par vira Outro com o texto inteiro como detalhe);
--   - ativo numa etapa de resultado 'perdido' → 'perdido', motivo Outro com
--     detalhe 'Estava na etapa Perdido', perdido_em = stage_changed_at;
--   - ativo numa etapa de resultado 'ganho' → 'ganho', ganho_em = stage_changed_at;
--   - is_converted e ativo (fora dos casos acima) → 'ganho' com ganho_em NULL:
--     a data da conversão não foi gravada e updated_at muda a cada edição ou
--     mensagem; NULL deixa esses leads fora de "ganhos no período" em vez de
--     inventar uma data;
--   - o resto (inclusive "Finalizados" sem conversão) fica 'aberto'.
--   Ao final imprime (NOTICE) as contagens por status.
--
-- Aplicar em produção é [H]: o Infra aplica, com aprovação e backup do dia, como
-- supabase_admin, com --single-transaction; depois registra a versão '126' e roda
-- notify pgrst, 'reload schema'. Sem BEGIN/COMMIT. Idempotente. Reescreve leads
-- (DROP/ADD COLUMN STORED), rápido com ~3 mil linhas. Se algo fora das migrações
-- depender de leads.arquivado (view, policy), o DROP COLUMN falha e nada muda.
-- Deploy do app logo depois: o app antigo escreve arquivado, que passa a ser
-- gerado (erro 428C9 ao arquivar/restaurar até o deploy).
-- Depois de um restore, seguir a ordem do CLAUDE.md (Database migrations): 118,
-- 121, esta e as seguintes que recriam mesclar_leads, terminando na mais nova
-- delas (a 121 recria mesclar_leads sem o status; parar nesta perde tags, anexos
-- e campos na mesclagem).
--
-- Reversão (só com aprovação, perde status/datas/motivos estruturados): recriar
-- arquivado como coluna comum a partir de status, o CHECK antigo, as views da 084
-- (+086), a policy FOR ALL da 067/092 em funnels e funnel_stages, as funções da
-- 027/121; apagar fn_lead_status e os triggers, motivos_perda e as colunas novas.

SET LOCAL lock_timeout = '5s';

DO $$
BEGIN
  IF current_setting('lock_timeout') <> '5s' THEN
    RAISE EXCEPTION '126: rode com --single-transaction (lock_timeout atual: %)', current_setting('lock_timeout');
  END IF;
  IF current_user <> 'supabase_admin' THEN
    RAISE EXCEPTION '126: rodar como supabase_admin (atual: %)', current_user;
  END IF;
  IF to_regprocedure('public.is_gestor()') IS NULL THEN
    RAISE EXCEPTION '126: depende da 113 (is_gestor)';
  END IF;
  IF to_regprocedure('public.mesclar_leads(uuid,uuid,uuid)') IS NULL THEN
    RAISE EXCEPTION '126: depende da 121 (mesclar_leads)';
  END IF;
END $$;

-- ── 1. Colunas novas ─────────────────────────────────────────────────────────
ALTER TABLE public.funnel_stages ADD COLUMN IF NOT EXISTS resultado text;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'funnel_stages_resultado_check' AND conrelid = 'public.funnel_stages'::regclass) THEN
    ALTER TABLE public.funnel_stages
      ADD CONSTRAINT funnel_stages_resultado_check CHECK (resultado IN ('ganho', 'perdido'));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.motivos_perda (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  funnel_id  uuid NOT NULL REFERENCES public.funnels(id) ON DELETE CASCADE,
  unit_id    uuid NOT NULL REFERENCES public.units(id) ON DELETE CASCADE,
  nome       text NOT NULL CHECK (btrim(nome) <> ''),
  ordem      integer NOT NULL DEFAULT 0,
  ativo      boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT motivos_perda_funnel_nome_key UNIQUE (funnel_id, nome)
);
CREATE INDEX IF NOT EXISTS idx_motivos_perda_unit ON public.motivos_perda (unit_id);

ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'aberto';
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS ganho_em timestamptz;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS perdido_em timestamptz;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS motivo_perda_id uuid
  REFERENCES public.motivos_perda(id) ON DELETE SET NULL;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'leads_status_check' AND conrelid = 'public.leads'::regclass) THEN
    ALTER TABLE public.leads
      ADD CONSTRAINT leads_status_check CHECK (status IN ('aberto', 'ganho', 'perdido'));
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_leads_unit_status ON public.leads (unit_id, status);
CREATE INDEX IF NOT EXISTS idx_leads_motivo_perda ON public.leads (motivo_perda_id) WHERE motivo_perda_id IS NOT NULL;

-- ── 2. motivos_perda: unidade, lista padrão, RLS ─────────────────────────────
-- As funções de trigger desta migração rodam como quem escreve e usam search_path
-- 'public', não '': as policies que elas disparam chamam is_global_admin(), que
-- resolve profiles pelo search_path de quem chama (42P01 com '').
CREATE OR REPLACE FUNCTION public.motivos_perda_padrao(tipo_unidade text)
 RETURNS text[]
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
AS $function$
  SELECT CASE WHEN tipo_unidade = 'comercial'
    THEN ARRAY['Sem capital', 'Cidade indisponível', 'Sem perfil', 'Desistiu', 'Sem resposta', 'Outro']
    ELSE ARRAY['Sem orçamento', 'Escolheu concorrente', 'Sem interesse', 'Sem contato', 'Timing ruim',
               'Não é cliente (erro, spam, fornecedor)', 'Outro']
  END;
$function$;
REVOKE EXECUTE ON FUNCTION public.motivos_perda_padrao(text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.motivos_perda_padrao(text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.fn_motivo_perda_unidade()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  NEW.unit_id := (SELECT f.unit_id FROM public.funnels f WHERE f.id = NEW.funnel_id);
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_motivo_perda_unidade ON public.motivos_perda;
CREATE TRIGGER trg_motivo_perda_unidade
  BEFORE INSERT OR UPDATE OF funnel_id, unit_id ON public.motivos_perda
  FOR EACH ROW EXECUTE FUNCTION public.fn_motivo_perda_unidade();

CREATE OR REPLACE FUNCTION public.fn_motivo_perda_apagado()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  UPDATE public.leads
     SET motivo_perda = OLD.nome || coalesce(': ' || nullif(btrim(motivo_perda), ''), '')
   WHERE motivo_perda_id = OLD.id;
  RETURN OLD;
END;
$function$;

DROP TRIGGER IF EXISTS trg_motivo_perda_apagado ON public.motivos_perda;
CREATE TRIGGER trg_motivo_perda_apagado
  BEFORE DELETE ON public.motivos_perda
  FOR EACH ROW EXECUTE FUNCTION public.fn_motivo_perda_apagado();

CREATE OR REPLACE FUNCTION public.fn_funil_motivos_padrao()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.unit_id IS NOT NULL THEN
    INSERT INTO public.motivos_perda (funnel_id, unit_id, nome, ordem)
    SELECT NEW.id, NEW.unit_id, m.nome, m.ordem::integer
      FROM unnest(public.motivos_perda_padrao(
             (SELECT u.tipo FROM public.units u WHERE u.id = NEW.unit_id))) WITH ORDINALITY AS m(nome, ordem)
    ON CONFLICT (funnel_id, nome) DO NOTHING;
  END IF;
  RETURN NULL;
END;
$function$;

DROP TRIGGER IF EXISTS trg_funil_motivos_padrao ON public.funnels;
CREATE TRIGGER trg_funil_motivos_padrao
  AFTER INSERT ON public.funnels
  FOR EACH ROW EXECUTE FUNCTION public.fn_funil_motivos_padrao();

-- Funis existentes sem nenhum motivo recebem a lista padrão do tipo da unidade
INSERT INTO public.motivos_perda (funnel_id, unit_id, nome, ordem)
SELECT f.id, f.unit_id, m.nome, m.ordem::integer
  FROM public.funnels f
  JOIN public.units u ON u.id = f.unit_id
 CROSS JOIN LATERAL unnest(public.motivos_perda_padrao(u.tipo)) WITH ORDINALITY AS m(nome, ordem)
 WHERE NOT EXISTS (SELECT 1 FROM public.motivos_perda mp WHERE mp.funnel_id = f.id)
ON CONFLICT (funnel_id, nome) DO NOTHING;

ALTER TABLE public.motivos_perda ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.motivos_perda FROM PUBLIC, anon;
REVOKE TRUNCATE, TRIGGER, REFERENCES ON public.motivos_perda FROM authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.motivos_perda TO authenticated;
GRANT ALL ON public.motivos_perda TO service_role;

-- ── 3. Funções de trigger: nenhuma é chamada direto ──────────────────────────
REVOKE EXECUTE ON FUNCTION
  public.fn_motivo_perda_unidade(),
  public.fn_motivo_perda_apagado(),
  public.fn_funil_motivos_padrao()
FROM PUBLIC, anon, authenticated;

-- ── 4. Policies: leitura para membros, escrita só gestor/admin ───────────────
DO $$
DECLARE
  t text;
  regra_unidade constant text :=
    '(( SELECT is_global_admin() AS is_global_admin) OR (unit_id IN ( SELECT user_units.unit_id '
    'FROM user_units WHERE (user_units.user_id = ( SELECT auth.uid() AS uid)))))';
  regra_gestor constant text :=
    '(( SELECT is_global_admin() AS is_global_admin) OR (( SELECT is_gestor() AS is_gestor) AND '
    '(unit_id IN ( SELECT user_units.unit_id FROM user_units WHERE (user_units.user_id = ( SELECT auth.uid() AS uid))))))';
BEGIN
  FOREACH t IN ARRAY ARRAY['funnels', 'funnel_stages', 'motivos_perda'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'unit_members_' || t, t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'unit_members_' || t || '_select', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'gestores_' || t || '_insert', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'gestores_' || t || '_update', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'gestores_' || t || '_delete', t);
    EXECUTE format('CREATE POLICY %I ON public.%I AS PERMISSIVE FOR SELECT TO public USING (%s)',
                   'unit_members_' || t || '_select', t, regra_unidade);
    EXECUTE format('CREATE POLICY %I ON public.%I AS PERMISSIVE FOR INSERT TO public WITH CHECK (%s)',
                   'gestores_' || t || '_insert', t, regra_gestor);
    EXECUTE format('CREATE POLICY %I ON public.%I AS PERMISSIVE FOR UPDATE TO public USING (%s) WITH CHECK (%s)',
                   'gestores_' || t || '_update', t, regra_gestor, regra_gestor);
    EXECUTE format('CREATE POLICY %I ON public.%I AS PERMISSIVE FOR DELETE TO public USING (%s)',
                   'gestores_' || t || '_delete', t, regra_gestor);
  END LOOP;
END $$;

-- Policies se somam (OR): sobrando outra PERMISSIVE de escrita (criada fora das
-- migrações, por exemplo), o atendente continuaria editando. Aborta nesse caso.
DO $$
DECLARE outras text;
BEGIN
  SELECT string_agg(tablename || '.' || policyname, ', ') INTO outras
    FROM pg_policies
   WHERE schemaname = 'public'
     AND tablename IN ('funnels', 'funnel_stages', 'motivos_perda')
     AND cmd IN ('INSERT', 'UPDATE', 'DELETE', 'ALL') AND permissive = 'PERMISSIVE'
     AND policyname NOT IN (
       'gestores_funnels_insert', 'gestores_funnels_update', 'gestores_funnels_delete',
       'gestores_funnel_stages_insert', 'gestores_funnel_stages_update', 'gestores_funnel_stages_delete',
       'gestores_motivos_perda_insert', 'gestores_motivos_perda_update', 'gestores_motivos_perda_delete');
  IF outras IS NOT NULL THEN
    RAISE EXCEPTION '126: outras policies de escrita anulariam a regra de gestor: %', outras;
  END IF;
END $$;

-- ── 5. Uma vez só: etapas com resultado, dados e arquivado gerado ────────────
DO $$
DECLARE
  ja_convertido boolean;
BEGIN
  SELECT a.attgenerated = 's' INTO ja_convertido
    FROM pg_attribute a
   WHERE a.attrelid = 'public.leads'::regclass AND a.attname = 'arquivado' AND NOT a.attisdropped;
  IF ja_convertido IS NULL THEN
    RAISE EXCEPTION '126: leads.arquivado não existe';
  END IF;
  IF ja_convertido THEN
    RETURN;
  END IF;

  -- O CHECK antigo exige texto em motivo_perda; o novo (abaixo) aceita motivo_perda_id
  ALTER TABLE public.leads DROP CONSTRAINT IF EXISTS motivo_perda_required;

  UPDATE public.funnel_stages SET resultado = 'perdido'
   WHERE resultado IS NULL AND lower(btrim(nome)) = 'perdido';
  UPDATE public.funnel_stages SET resultado = 'ganho'
   WHERE resultado IS NULL AND lower(btrim(nome)) = 'contrato assinado';

  UPDATE public.leads l
     SET status          = 'perdido',
         perdido_em      = l.updated_at,
         motivo_perda_id = coalesce(x.exato, x.outro),
         motivo_perda    = CASE
           WHEN x.exato IS NOT NULL THEN NULL
           WHEN x.outro IS NOT NULL AND l.motivo_perda ~* '^\s*outro\s*:' THEN
             coalesce(nullif(btrim(regexp_replace(l.motivo_perda, '^\s*outro\s*:\s*', '', 'i')), ''), l.motivo_perda)
           ELSE l.motivo_perda
         END
    FROM (SELECT l2.id,
                 (SELECT m.id FROM public.motivos_perda m
                   WHERE m.funnel_id = l2.funnel_id AND lower(m.nome) = lower(btrim(l2.motivo_perda))) AS exato,
                 (SELECT m.id FROM public.motivos_perda m
                   WHERE m.funnel_id = l2.funnel_id AND m.nome = 'Outro') AS outro
            FROM public.leads l2
           WHERE l2.arquivado AND l2.status = 'aberto') x
   WHERE l.id = x.id;

  UPDATE public.leads l
     SET status          = 'perdido',
         perdido_em      = l.stage_changed_at,
         motivo_perda_id = (SELECT m.id FROM public.motivos_perda m
                             WHERE m.funnel_id = l.funnel_id AND m.nome = 'Outro'),
         motivo_perda    = 'Estava na etapa ' || btrim(fs.nome)
    FROM public.funnel_stages fs
   WHERE fs.id = l.stage_id AND fs.resultado = 'perdido'
     AND NOT l.arquivado AND l.status = 'aberto';

  UPDATE public.leads l
     SET status       = 'ganho',
         ganho_em     = l.stage_changed_at,
         is_converted = true
    FROM public.funnel_stages fs
   WHERE fs.id = l.stage_id AND fs.resultado = 'ganho'
     AND NOT l.arquivado AND l.status = 'aberto';

  UPDATE public.leads
     SET status = 'ganho'
   WHERE is_converted AND NOT arquivado AND status = 'aberto';

  DROP VIEW IF EXISTS public.leads_arquivados;
  DROP VIEW IF EXISTS public.leads_kanban;
  ALTER TABLE public.leads DROP COLUMN arquivado;
  ALTER TABLE public.leads ADD COLUMN arquivado boolean GENERATED ALWAYS AS (status = 'perdido') STORED;
END $$;

ALTER TABLE public.leads DROP CONSTRAINT IF EXISTS motivo_perda_required;
ALTER TABLE public.leads ADD CONSTRAINT motivo_perda_required CHECK (
  status <> 'perdido' OR motivo_perda_id IS NOT NULL OR coalesce(motivo_perda, '') <> ''
);

-- ── 6. Trigger de status em leads ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_lead_status()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  resultado_novo  text;
  etapa_nova      text;
  resultado_velho text;
  pela_etapa      boolean := false;
BEGIN
  -- A etapa só decide o status quando o mesmo comando não muda o status
  IF (TG_OP = 'INSERT' OR NEW.stage_id IS DISTINCT FROM OLD.stage_id)
     AND (TG_OP = 'INSERT' OR NEW.status IS NOT DISTINCT FROM OLD.status) THEN
    SELECT fs.resultado, fs.nome INTO resultado_novo, etapa_nova
      FROM public.funnel_stages fs WHERE fs.id = NEW.stage_id;
    IF resultado_novo IS NOT NULL THEN
      NEW.status := resultado_novo;
      pela_etapa := true;
    ELSIF TG_OP = 'UPDATE' THEN
      SELECT fs.resultado INTO resultado_velho FROM public.funnel_stages fs WHERE fs.id = OLD.stage_id;
      IF resultado_velho IS NOT NULL THEN
        NEW.status := 'aberto';
      END IF;
    END IF;
  END IF;

  IF TG_OP = 'INSERT' OR NEW.status IS DISTINCT FROM OLD.status THEN
    IF NEW.status = 'ganho' THEN
      NEW.is_converted := true;
      IF TG_OP = 'INSERT' THEN
        NEW.ganho_em := coalesce(NEW.ganho_em, now());
      ELSIF NEW.ganho_em IS NOT DISTINCT FROM OLD.ganho_em THEN
        NEW.ganho_em := now();
      END IF;
    ELSIF NEW.status = 'perdido' THEN
      IF TG_OP = 'INSERT' THEN
        NEW.perdido_em := coalesce(NEW.perdido_em, now());
      ELSIF NEW.perdido_em IS NOT DISTINCT FROM OLD.perdido_em THEN
        NEW.perdido_em := now();
      END IF;
      IF pela_etapa AND NEW.motivo_perda_id IS NULL AND coalesce(NEW.motivo_perda, '') = '' THEN
        NEW.motivo_perda := 'Movido para a etapa ' || etapa_nova;
      END IF;
    END IF;
    IF TG_OP = 'UPDATE' AND OLD.status = 'perdido' AND NEW.status <> 'perdido' THEN
      NEW.motivo_perda_id := NULL;
      NEW.motivo_perda    := NULL;
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.fn_lead_status() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_lead_status ON public.leads;
CREATE TRIGGER trg_lead_status
  BEFORE INSERT OR UPDATE OF stage_id, status ON public.leads
  FOR EACH ROW EXECUTE FUNCTION public.fn_lead_status();

-- ── 7. Views ─────────────────────────────────────────────────────────────────
DROP VIEW IF EXISTS public.leads_arquivados;
DROP VIEW IF EXISTS public.leads_kanban;

CREATE VIEW public.leads_kanban WITH (security_invoker = true) AS
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
    fs.resultado AS stage_resultado
   FROM leads l
     LEFT JOIN profiles p ON p.id = l.responsavel_id
     LEFT JOIN funnel_stages fs ON fs.id = l.stage_id
     LEFT JOIN funnels f ON f.id = l.funnel_id
     LEFT JOIN lead_negotiation ln ON ln.lead_id = l.id
     LEFT JOIN motivos_perda mp ON mp.id = l.motivo_perda_id
  WHERE l.status <> 'perdido'
  ORDER BY fs.ordem, l.ordem, l.created_at;

CREATE VIEW public.leads_arquivados WITH (security_invoker = true) AS
 SELECT l.id, l.nome, l.sobrenome, l.profissao, l.cidade, l.estado, l.pais,
    l.instagram, l.site, l.email, l.telefone, l.responsavel_id, l.arquivado,
    l.motivo_perda, l.ordem, l.created_at, l.updated_at, l.funnel_id, l.stage_id,
    l.origem, l.stage_changed_at, l.unit_id, l.is_converted,
    COALESCE(NULLIF(TRIM(p.apelido), ''), split_part(p.full_name, ' ', 1)) AS responsavel_nome,
    p.avatar_url AS responsavel_avatar,
    fs.nome AS stage_nome, fs.cor AS stage_cor, fs.ordem AS stage_ordem,
    fs.alerta_horas AS stage_alerta_horas,
    false AS stage_sla_mensal,
    f.nome AS funnel_nome,
    ln.valor_proposta, ln.modelo, ln.valor_negociado,
    0::numeric(12,2) AS valor_orcamentos,
    NULL::timestamptz AS proxima_tarefa_data,
    0 AS tarefas_pendentes, 0 AS total_notas, 0 AS total_contatos,
    l.status, l.ganho_em, l.perdido_em, l.motivo_perda_id,
    mp.nome AS motivo_perda_nome,
    fs.resultado AS stage_resultado
   FROM leads l
     LEFT JOIN profiles p ON p.id = l.responsavel_id
     LEFT JOIN funnel_stages fs ON fs.id = l.stage_id
     LEFT JOIN funnels f ON f.id = l.funnel_id
     LEFT JOIN lead_negotiation ln ON ln.lead_id = l.id
     LEFT JOIN motivos_perda mp ON mp.id = l.motivo_perda_id
  WHERE l.status = 'perdido'
  ORDER BY l.perdido_em DESC NULLS LAST, l.updated_at DESC;

REVOKE ALL ON public.leads_kanban, public.leads_arquivados FROM anon;
GRANT SELECT ON public.leads_kanban, public.leads_arquivados TO authenticated, service_role;

-- ── 8. Funções que escreviam arquivado ou juntam leads ───────────────────────
CREATE OR REPLACE FUNCTION public.execute_quote_automation(
  p_unit_id      uuid,
  p_lead_id      uuid,
  p_quote_status text,
  p_motivo       text DEFAULT NULL
)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public
AS $function$
DECLARE
  v_action        TEXT;
  v_stage_id      UUID;
  v_old_stage_id  UUID;
BEGIN
  SELECT action, stage_id
    INTO v_action, v_stage_id
    FROM quote_automations
   WHERE unit_id      = p_unit_id
     AND quote_status = p_quote_status
     AND ativo        = TRUE
   LIMIT 1;

  IF v_action IS NULL OR v_action = 'none' THEN
    RETURN;
  END IF;

  IF v_action = 'move_stage' AND v_stage_id IS NOT NULL THEN
    SELECT stage_id INTO v_old_stage_id FROM leads WHERE id = p_lead_id;
    UPDATE leads SET stage_id = v_stage_id WHERE id = p_lead_id;

    IF v_old_stage_id IS DISTINCT FROM v_stage_id THEN
      INSERT INTO lead_stage_history (lead_id, de_stage_id, para_stage_id, movido_por)
      VALUES (p_lead_id, v_old_stage_id, v_stage_id, NULL); -- NULL = automação
    END IF;

  ELSIF v_action = 'archive' THEN
    UPDATE leads
       SET status          = 'perdido',
           motivo_perda_id = NULL,
           motivo_perda    = CASE
             WHEN p_quote_status = 'recusado'
             THEN CONCAT('Orçamento recusado: ', COALESCE(p_motivo, '—'))
             ELSE 'Perdido por automação de orçamento'
           END
     WHERE id = p_lead_id;
  END IF;
END;
$function$;

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
       'public.quotes.lead_id', 'public.lead_negotiation.lead_id', 'public.automation_runs.lead_id']);
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

REVOKE EXECUTE ON FUNCTION public.execute_quote_automation(uuid, uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.execute_quote_automation(uuid, uuid, text, text) TO service_role;
REVOKE EXECUTE ON FUNCTION public.mesclar_leads(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.mesclar_leads(uuid, uuid, uuid) TO service_role;

-- ── 9. Conferência ───────────────────────────────────────────────────────────
DO $$
DECLARE
  r record;
BEGIN
  IF (SELECT attgenerated FROM pg_attribute
       WHERE attrelid = 'public.leads'::regclass AND attname = 'arquivado' AND NOT attisdropped) <> 's' THEN
    RAISE EXCEPTION '126: leads.arquivado deveria ser coluna gerada';
  END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.motivos_perda'::regclass) THEN
    RAISE EXCEPTION '126: motivos_perda sem RLS';
  END IF;
  IF has_table_privilege('anon', 'public.motivos_perda', 'SELECT')
     OR has_table_privilege('anon', 'public.leads_kanban', 'SELECT')
     OR has_table_privilege('anon', 'public.leads_arquivados', 'SELECT') THEN
    RAISE EXCEPTION '126: anon lê motivos_perda ou as views de leads';
  END IF;
  IF has_function_privilege('authenticated', 'public.mesclar_leads(uuid,uuid,uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.execute_quote_automation(uuid,uuid,text,text)', 'EXECUTE') THEN
    RAISE EXCEPTION '126: authenticated executa mesclar_leads ou execute_quote_automation';
  END IF;
  FOR r IN SELECT status, count(*) AS n FROM public.leads GROUP BY status ORDER BY status LOOP
    RAISE NOTICE '126: leads %: %', r.status, r.n;
  END LOOP;
END $$;
