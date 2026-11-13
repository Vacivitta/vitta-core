-- 132_arquivar.sql
-- Arquivar volta a ser uma ação separada de Perdido.
--
-- Por quê: a 126 juntou "arquivado" com "perdido" (leads.arquivado virou coluna
-- gerada status = 'perdido') e a 131 levou os perdidos para a etapa de perda do
-- funil. Resultado: os contatos que tinham sido ARQUIVADOS antes da 126 (spam,
-- engano, fornecedor...) aparecem como "Perdido" na coluna de perda e também no
-- painel "Perdidos" do funil. O combinado agora:
--   - Perdido = negócio perdido; fica na etapa de perda, visível no quadro.
--   - Arquivado = tira o lead do quadro (spam, contato errado, fornecedor,
--     funcionário, duplicado...), independe do status (aberto, ganho ou
--     perdido), com motivo. Aparece só no painel "Arquivados" do funil, de onde
--     pode ser desarquivado; mensagem recebida no WhatsApp desarquiva (app).
--
-- O que faz:
--   1. leads.arquivado_em (timestamptz), arquivado_motivo (text), arquivado_por
--      (uuid → profiles, ON DELETE SET NULL). CHECK: arquivado exige motivo.
--   2. Uma vez só (enquanto leads.arquivado ainda é a coluna gerada da 126,
--      expressão status = 'perdido'): marca os antigos arquivados (regra abaixo)
--      e troca leads.arquivado pela coluna GERADA (arquivado_em IS NOT NULL).
--      Arquivar = gravar arquivado_em + arquivado_motivo; desarquivar = gravar
--      arquivado_em NULL. arquivado continua só de leitura (erro 428C9 ao
--      gravar), e todas as leituras existentes (.eq('arquivado', false),
--      auto_link_wa_conversation da 121, ordem de buscarLeadPorTelefone) passam a
--      significar "não arquivado".
--      Por que gerada e não coluna comum: a ordem pós-restore reaplica a 126,
--      cuja parte de dados roda só quando arquivado NÃO é gerada; com uma coluna
--      comum aqui, reaplicar a 126 transformaria todo arquivado aberto em
--      perdido e recriaria arquivado = (status = 'perdido'), perdendo os
--      arquivamentos. Com a coluna gerada a 126 reaplicada pula essa parte.
--   3. Trigger fn_lead_arquivado (BEFORE INSERT/UPDATE OF arquivado_em,
--      arquivado_motivo, arquivado_por): desarquivar limpa motivo e autor;
--      arquivar por uma pessoa (auth.uid() presente) grava arquivado_em = now()
--      e arquivado_por = auth.uid() (o navegador não escolhe a data nem o
--      autor); pessoa num lead já arquivado só troca o motivo. Sem usuário
--      (service_role, migração) os valores informados ficam.
--   4. Recria leads_kanban (esconde só os arquivados: WHERE NOT l.arquivado) e
--      leads_arquivados (lista arquivado = true; o nome volta a fazer sentido),
--      mesmas colunas da 126/131 mais arquivado_em, arquivado_motivo e
--      arquivado_por no fim; security_invoker e sem anon (como a 086).
--      O kanban deixa de esconder perdido fora da etapa de perda: num funil com
--      etapa de perda o perdido já está nela (131 + marcarPerdido + automação);
--      num funil SEM etapa de perda o painel não lista mais perdidos, então
--      escondê-lo o tiraria de todas as telas do funil. Ele fica na coluna onde
--      estava, com o selo Perdido.
--
-- Migração de dados (só na primeira aplicação): antigos arquivados são os leads
-- perdidos ANTES da 126 entrar em produção (perdido_em < 2026-11-05 11:48:00
-- UTC; a 126 foi aplicada às ~11:48:45 e gravou perdido_em = updated_at dos
-- arquivados) que NÃO estavam numa etapa de perda antes da 131:
--   - os que a 131 levou para a etapa de perda (registro em lead_stage_history
--     com movido_via 'perdido', movido_por NULL e para_stage_id = etapa atual;
--     o criado_em desse registro é a data da perda, não a da 131, por isso a
--     regra usa perdido_em); ou
--   - os que continuam fora de uma etapa de perda (funil sem etapa de perda: a
--     131 não os moveu).
-- Ficam de fora os que a 126 tornou perdidos por estarem na etapa "Perdido"
-- (estão na etapa de perda e a 131 não gravou histórico para eles) e todo lead
-- perdido depois da 126 (perdido_em mais recente). Arquivado que já estava na
-- etapa "Perdido" antes da 126 não se distingue de quem só estava nessa etapa:
-- fica só perdido (visível na coluna de perda; arquive pela ficha se for o caso).
-- arquivado_em = perdido_em (a data em que foi arquivado antes da 126),
-- arquivado_motivo = motivo da perda ("Nome: detalhe", só o nome ou só o texto
-- antigo). status, motivo da perda e etapa não mudam (a conferência aborta se
-- mudarem). NOTICE com a contagem (esperado em produção: 34 pela 131; mais os
-- antigos arquivados de funis sem etapa de perda, se houver). Reaplicar não
-- mexe em leads: não rearquiva quem foi desarquivado depois.
--
-- execute_quote_automation (ramo 'archive') continua PERDENDO o lead (131), não
-- arquiva. mesclar_leads (129) não lê nem grava arquivado_*: o lead mantido
-- conserva o próprio arquivamento (o do removido se perde com ele); por isso a
-- 132 não recria mesclar_leads.
--
-- Depende da 126 (arquivado gerado, status) e da 131 (execute_quote_automation
-- que move para a etapa de perda; leads_kanban). Aplicar em produção é [H]: o
-- Infra aplica, com aprovação e backup do dia, como supabase_admin, com
-- --single-transaction; depois registra a versão '132' e roda
-- notify pgrst, 'reload schema'. Sem BEGIN/COMMIT. Idempotente. Reescreve leads
-- (DROP/ADD COLUMN STORED), rápido com ~3 mil linhas. Pode ir antes ou depois do
-- deploy do app (ver runbook): o app de hoje não grava arquivado nem as colunas
-- novas.
-- Depois de um restore, reaplicar DEPOIS da 126 e da 131 (as duas recriam
-- leads_kanban; a 126 também leads_arquivados): ordem completa no CLAUDE.md.
-- A 131 reaplicada depois desta aborta (CREATE OR REPLACE VIEW com menos
-- colunas): reaplicar a 132 em seguida. A 118 reaplicada depois desta passa.
--
-- Reversão (só com aprovação, perde os arquivamentos): DROP das views; DROP
-- COLUMN arquivado; ADD COLUMN arquivado GENERATED ALWAYS AS (status =
-- 'perdido') STORED; recriar leads_kanban como na 131 e leads_arquivados como na
-- 126; apagar trg_lead_arquivado, fn_lead_arquivado, o CHECK e as colunas
-- arquivado_em/arquivado_motivo/arquivado_por.

SET LOCAL lock_timeout = '5s';

DO $$
BEGIN
  IF current_setting('lock_timeout') <> '5s' THEN
    RAISE EXCEPTION '132: rode com --single-transaction (lock_timeout atual: %)', current_setting('lock_timeout');
  END IF;
  IF current_user <> 'supabase_admin' THEN
    RAISE EXCEPTION '132: rodar como supabase_admin (atual: %)', current_user;
  END IF;
  IF to_regprocedure('public.fn_lead_status()') IS NULL OR to_regclass('public.leads_kanban') IS NULL THEN
    RAISE EXCEPTION '132: depende da 126 (fn_lead_status, leads_kanban)';
  END IF;
  IF pg_get_functiondef('public.execute_quote_automation(uuid,uuid,text,text)'::regprocedure) NOT LIKE '%v_stage_perda%' THEN
    RAISE EXCEPTION '132: depende da 131 (execute_quote_automation que leva o perdido para a etapa de perda)';
  END IF;
END $$;

-- ── 1. Colunas novas ─────────────────────────────────────────────────────────
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS arquivado_em timestamptz;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS arquivado_motivo text;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS arquivado_por uuid
  REFERENCES public.profiles(id) ON DELETE SET NULL;

-- ── 2. Uma vez só: antigos arquivados e arquivado gerado por arquivado_em ────
DO $$
DECLARE
  expressao  text;
  pela_131   integer;
  sem_perda  integer;
  mudou      integer;
BEGIN
  SELECT pg_get_expr(d.adbin, d.adrelid) INTO expressao
    FROM pg_attribute a
    LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
   WHERE a.attrelid = 'public.leads'::regclass AND a.attname = 'arquivado' AND NOT a.attisdropped
     AND a.attgenerated = 's';
  IF expressao IS NULL THEN
    RAISE EXCEPTION '132: leads.arquivado deveria ser coluna gerada (126)';
  END IF;
  IF expressao LIKE '%arquivado_em%' THEN
    RETURN;  -- já convertida: reaplicar não mexe em leads
  END IF;
  IF expressao NOT LIKE '%status%' THEN
    RAISE EXCEPTION '132: expressão inesperada em leads.arquivado: %', expressao;
  END IF;

  CREATE TEMP TABLE arquivar_132 ON COMMIT DROP AS
  SELECT l.id,
         coalesce(l.perdido_em, l.updated_at) AS quando,
         coalesce(nullif(concat_ws(': ', mp.nome, nullif(btrim(l.motivo_perda), '')), ''),
                  'Arquivado antes da mudança de status') AS motivo,
         l.status, l.perdido_em, l.motivo_perda_id, l.motivo_perda, l.stage_id,
         EXISTS (SELECT 1 FROM public.lead_stage_history h
                  WHERE h.lead_id = l.id AND h.movido_via = 'perdido' AND h.movido_por IS NULL
                    AND h.para_stage_id = l.stage_id) AS movido_pela_131
    FROM public.leads l
    LEFT JOIN public.funnel_stages atual ON atual.id = l.stage_id
    LEFT JOIN public.motivos_perda mp ON mp.id = l.motivo_perda_id
   WHERE l.status = 'perdido'
     AND l.perdido_em < '2026-11-05 11:48:00+00'
     AND (atual.resultado IS DISTINCT FROM 'perdido'
          OR EXISTS (SELECT 1 FROM public.lead_stage_history h
                      WHERE h.lead_id = l.id AND h.movido_via = 'perdido' AND h.movido_por IS NULL
                        AND h.para_stage_id = l.stage_id));

  SELECT count(*) FILTER (WHERE movido_pela_131), count(*) FILTER (WHERE NOT movido_pela_131)
    INTO pela_131, sem_perda FROM arquivar_132;

  UPDATE public.leads l
     SET arquivado_em = a.quando, arquivado_motivo = a.motivo, arquivado_por = NULL
    FROM arquivar_132 a WHERE l.id = a.id;

  DROP VIEW IF EXISTS public.leads_arquivados;
  DROP VIEW IF EXISTS public.leads_kanban;
  ALTER TABLE public.leads DROP COLUMN arquivado;
  ALTER TABLE public.leads ADD COLUMN arquivado boolean GENERATED ALWAYS AS (arquivado_em IS NOT NULL) STORED;

  SELECT count(*) INTO mudou
    FROM arquivar_132 a JOIN public.leads l ON l.id = a.id
   WHERE NOT l.arquivado
      OR l.status IS DISTINCT FROM a.status
      OR l.perdido_em IS DISTINCT FROM a.perdido_em
      OR l.motivo_perda_id IS DISTINCT FROM a.motivo_perda_id
      OR l.motivo_perda IS DISTINCT FROM a.motivo_perda
      OR l.stage_id IS DISTINCT FROM a.stage_id;
  IF mudou > 0 THEN
    RAISE EXCEPTION '132: % lead(s) mudaram status, motivo ou etapa ao arquivar (ou não ficaram arquivados)', mudou;
  END IF;

  RAISE NOTICE '132: % antigo(s) arquivado(s) voltaram a ser arquivados (% levados pela 131 para a etapa de perda, % fora de etapa de perda)',
    pela_131 + sem_perda, pela_131, sem_perda;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'leads_arquivado_motivo_check' AND conrelid = 'public.leads'::regclass) THEN
    ALTER TABLE public.leads ADD CONSTRAINT leads_arquivado_motivo_check
      CHECK (arquivado_em IS NULL OR btrim(coalesce(arquivado_motivo, '')) <> '');
  END IF;
END $$;

-- ── 3. Trigger: datas e autor do arquivamento ────────────────────────────────
-- search_path 'public' (não ''), como as funções de trigger da 126: roda como
-- quem escreve e as policies que dispara resolvem nomes pelo search_path.
CREATE OR REPLACE FUNCTION public.fn_lead_arquivado()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  usuario uuid := auth.uid();
BEGIN
  IF NEW.arquivado_em IS NULL THEN
    NEW.arquivado_motivo := NULL;
    NEW.arquivado_por    := NULL;
  ELSIF TG_OP = 'INSERT' OR OLD.arquivado_em IS NULL THEN
    IF usuario IS NOT NULL THEN
      NEW.arquivado_em  := now();
      NEW.arquivado_por := usuario;
    END IF;
  ELSIF usuario IS NOT NULL THEN
    -- Já arquivado: a pessoa só troca o motivo
    NEW.arquivado_em  := OLD.arquivado_em;
    NEW.arquivado_por := OLD.arquivado_por;
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.fn_lead_arquivado() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_lead_arquivado ON public.leads;
CREATE TRIGGER trg_lead_arquivado
  BEFORE INSERT OR UPDATE OF arquivado_em, arquivado_motivo, arquivado_por ON public.leads
  FOR EACH ROW EXECUTE FUNCTION public.fn_lead_arquivado();

-- ── 4. Views ─────────────────────────────────────────────────────────────────
-- DROP + CREATE: depois de um restore a 126 recria as duas com outras colunas
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
    fs.resultado AS stage_resultado,
    l.arquivado_em, l.arquivado_motivo, l.arquivado_por
   FROM leads l
     LEFT JOIN profiles p ON p.id = l.responsavel_id
     LEFT JOIN funnel_stages fs ON fs.id = l.stage_id
     LEFT JOIN funnels f ON f.id = l.funnel_id
     LEFT JOIN lead_negotiation ln ON ln.lead_id = l.id
     LEFT JOIN motivos_perda mp ON mp.id = l.motivo_perda_id
  WHERE NOT l.arquivado
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
    fs.resultado AS stage_resultado,
    l.arquivado_em, l.arquivado_motivo, l.arquivado_por
   FROM leads l
     LEFT JOIN profiles p ON p.id = l.responsavel_id
     LEFT JOIN funnel_stages fs ON fs.id = l.stage_id
     LEFT JOIN funnels f ON f.id = l.funnel_id
     LEFT JOIN lead_negotiation ln ON ln.lead_id = l.id
     LEFT JOIN motivos_perda mp ON mp.id = l.motivo_perda_id
  WHERE l.arquivado
  ORDER BY l.arquivado_em DESC NULLS LAST, l.updated_at DESC;

REVOKE ALL ON public.leads_kanban, public.leads_arquivados FROM anon;
GRANT SELECT ON public.leads_kanban, public.leads_arquivados TO authenticated, service_role;

-- ── 5. Conferência ───────────────────────────────────────────────────────────
DO $$
BEGIN
  IF (SELECT pg_get_expr(d.adbin, d.adrelid)
        FROM pg_attribute a JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
       WHERE a.attrelid = 'public.leads'::regclass AND a.attname = 'arquivado' AND NOT a.attisdropped
         AND a.attgenerated = 's') IS DISTINCT FROM '(arquivado_em IS NOT NULL)' THEN
    RAISE EXCEPTION '132: leads.arquivado deveria ser gerada por (arquivado_em IS NOT NULL)';
  END IF;
  IF has_table_privilege('anon', 'public.leads_kanban', 'SELECT')
     OR has_table_privilege('anon', 'public.leads_arquivados', 'SELECT') THEN
    RAISE EXCEPTION '132: anon lê as views de leads';
  END IF;
  IF NOT coalesce((SELECT 'security_invoker=true' = ANY (reloptions) FROM pg_class
                    WHERE oid = 'public.leads_kanban'::regclass), false)
     OR NOT coalesce((SELECT 'security_invoker=true' = ANY (reloptions) FROM pg_class
                       WHERE oid = 'public.leads_arquivados'::regclass), false) THEN
    RAISE EXCEPTION '132: views de leads sem security_invoker';
  END IF;
  IF has_function_privilege('authenticated', 'public.fn_lead_arquivado()', 'EXECUTE')
     OR has_function_privilege('anon', 'public.fn_lead_arquivado()', 'EXECUTE') THEN
    RAISE EXCEPTION '132: anon/authenticated executa fn_lead_arquivado';
  END IF;
  RAISE NOTICE '132: leads arquivados: % (perdidos: %, abertos: %, ganhos: %)',
    (SELECT count(*) FROM public.leads WHERE arquivado),
    (SELECT count(*) FROM public.leads WHERE arquivado AND status = 'perdido'),
    (SELECT count(*) FROM public.leads WHERE arquivado AND status = 'aberto'),
    (SELECT count(*) FROM public.leads WHERE arquivado AND status = 'ganho');
END $$;
