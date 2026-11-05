-- 131_perdido_na_etapa.sql
-- Lead perdido fica na coluna de perda do funil, visível no kanban.
--
-- Por quê: desde a 126 a view leads_kanban esconde todo lead com status
-- 'perdido', inclusive os que estão na etapa "Perdido" (funnel_stages.resultado
-- = 'perdido'): a coluna Perdido ficou vazia e quem marca perdido pela ficha vê
-- o lead "arquivado" (ele só aparece no painel Perdidos). O combinado é: perdido
-- vai para a etapa de perda do funil e continua no kanban, nessa coluna; funil
-- sem etapa de perda segue como hoje (o lead fica só no painel Perdidos).
--
-- O que faz:
--   1. Recria leads_kanban com as mesmas colunas da 126, mostrando os leads não
--      perdidos e também os perdidos que estão numa etapa de perda.
--      leads_arquivados não muda: continua listando todos os perdidos (painel).
--   2. Dados (uma vez; reaplicar não acha mais ninguém): cada lead perdido fora
--      de uma etapa de perda (etapa sem resultado ou stage_id nulo) cujo funil
--      tem etapa de perda vai para ela (a de menor ordem, se houver mais de uma;
--      em produção cada funil tem no máximo uma). status, perdido_em e motivo
--      não mudam: fn_lead_status (126), com o status igual no mesmo comando,
--      só confirma 'perdido' e não reescreve perdido_em nem o motivo (a
--      conferência abaixo aborta se mudarem). Grava lead_stage_history (de =
--      etapa de onde saiu, movido_via 'perdido', movido_por NULL), para o
--      dashboard "perdas por etapa" (etapaDaPerda) achar a etapa da perda.
--      O histórico e stage_changed_at ficam com a data da perda
--      (greatest(perdido_em, stage_changed_at)), não a da migração: o lead
--      entrou na perda quando foi perdido, e o "tempo na etapa" do dashboard não
--      ganha meses falsos. updated_at vira a hora da migração (trigger
--      leads_updated_at). Triggers que rodam: trg_lead_obrigatorios (130) não
--      barra (só 'authenticated'; etapa de perda não exige nada),
--      trg_stage_changed_at (004) e o Realtime avisam os quadros abertos.
--      NOTICE com quantos foram movidos.
--
-- O app (marcarPerdido em src/lib/leads.ts) passa a gravar a etapa de perda no
-- mesmo update do status e o histórico com movido_via 'perdido'.
--
-- Depende da 126 (status, funnel_stages.resultado, leads_kanban) e da 130.
-- Aplicar em produção é [H]: o Infra aplica, com aprovação e backup do dia,
-- como supabase_admin, com --single-transaction; depois registra a versão '131'
-- e roda notify pgrst, 'reload schema'. Sem BEGIN/COMMIT. Idempotente. Pode ir
-- antes ou depois do deploy do app (ver runbook). Não recria mesclar_leads nem
-- funções SECURITY DEFINER. Depois de um restore, reaplicar DEPOIS da 126 (que
-- recria leads_kanban escondendo todos os perdidos): ver CLAUDE.md.
--
-- Reversão (só com aprovação): recriar leads_kanban como na 126 (WHERE
-- l.status <> 'perdido'). Os leads movidos ficam na etapa de perda (continuam
-- perdidos); para devolvê-los, os registros com movido_via = 'perdido' gravados
-- por esta migração (movido_por NULL) têm a etapa de origem em de_stage_id.

SET LOCAL lock_timeout = '5s';

DO $$
BEGIN
  IF current_setting('lock_timeout') <> '5s' THEN
    RAISE EXCEPTION '131: rode com --single-transaction (lock_timeout atual: %)', current_setting('lock_timeout');
  END IF;
  IF current_user <> 'supabase_admin' THEN
    RAISE EXCEPTION '131: rodar como supabase_admin (atual: %)', current_user;
  END IF;
  IF to_regprocedure('public.fn_lead_status()') IS NULL OR to_regclass('public.leads_kanban') IS NULL THEN
    RAISE EXCEPTION '131: depende da 126 (fn_lead_status, leads_kanban)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_attribute
                  WHERE attrelid = 'public.funnel_stages'::regclass AND attname = 'campos_obrigatorios'
                    AND NOT attisdropped) THEN
    RAISE EXCEPTION '131: depende da 130 (funnel_stages.campos_obrigatorios)';
  END IF;
END $$;

-- ── 1. leads_kanban: perdidos na etapa de perda continuam no quadro ──────────
-- Mesmas colunas, na mesma ordem, da 126: CREATE OR REPLACE só troca o WHERE
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
    fs.resultado AS stage_resultado
   FROM leads l
     LEFT JOIN profiles p ON p.id = l.responsavel_id
     LEFT JOIN funnel_stages fs ON fs.id = l.stage_id
     LEFT JOIN funnels f ON f.id = l.funnel_id
     LEFT JOIN lead_negotiation ln ON ln.lead_id = l.id
     LEFT JOIN motivos_perda mp ON mp.id = l.motivo_perda_id
  WHERE l.status <> 'perdido' OR fs.resultado = 'perdido'
  ORDER BY fs.ordem, l.ordem, l.created_at;

REVOKE ALL ON public.leads_kanban FROM anon;
GRANT SELECT ON public.leads_kanban TO authenticated, service_role;

-- ── 2. Perdidos fora da etapa de perda vão para ela ──────────────────────────
DO $$
DECLARE
  movidos   integer;
  sem_etapa integer;
  mudou     integer;
BEGIN
  CREATE TEMP TABLE perdidos_131 ON COMMIT DROP AS
  SELECT l.id, l.stage_id AS de_stage_id, destino.id AS para_stage_id,
         greatest(coalesce(l.perdido_em, now()), l.stage_changed_at) AS quando,
         l.perdido_em, l.motivo_perda_id, l.motivo_perda
    FROM public.leads l
    LEFT JOIN public.funnel_stages atual ON atual.id = l.stage_id
    CROSS JOIN LATERAL (
      SELECT fs.id FROM public.funnel_stages fs
       WHERE fs.funnel_id = l.funnel_id AND fs.resultado = 'perdido'
       ORDER BY fs.ordem, fs.id
       LIMIT 1) destino
   WHERE l.status = 'perdido'
     AND atual.resultado IS DISTINCT FROM 'perdido';

  SELECT count(*), count(*) FILTER (WHERE de_stage_id IS NULL) INTO movidos, sem_etapa FROM perdidos_131;

  UPDATE public.leads l SET stage_id = p.para_stage_id
    FROM perdidos_131 p WHERE l.id = p.id;

  INSERT INTO public.lead_stage_history (lead_id, de_stage_id, para_stage_id, movido_por, movido_via, criado_em)
  SELECT id, de_stage_id, para_stage_id, NULL, 'perdido', quando FROM perdidos_131;

  -- trg_stage_changed_at gravou now(); a entrada na perda foi na data da perda
  UPDATE public.leads l SET stage_changed_at = p.quando
    FROM perdidos_131 p WHERE l.id = p.id;

  SELECT count(*) INTO mudou
    FROM perdidos_131 p JOIN public.leads l ON l.id = p.id
   WHERE l.status <> 'perdido'
      OR l.perdido_em IS DISTINCT FROM p.perdido_em
      OR l.motivo_perda_id IS DISTINCT FROM p.motivo_perda_id
      OR l.motivo_perda IS DISTINCT FROM p.motivo_perda;
  IF mudou > 0 THEN
    RAISE EXCEPTION '131: % lead(s) mudaram status, perdido_em ou motivo ao ir para a etapa de perda', mudou;
  END IF;

  RAISE NOTICE '131: % lead(s) perdido(s) movido(s) para a etapa de perda do funil (% sem etapa antes)', movidos, sem_etapa;
END $$;

-- ── 3. Conferência ───────────────────────────────────────────────────────────
DO $$
DECLARE
  fora integer;
BEGIN
  IF has_table_privilege('anon', 'public.leads_kanban', 'SELECT') THEN
    RAISE EXCEPTION '131: anon lê leads_kanban';
  END IF;
  IF NOT coalesce((SELECT 'security_invoker=true' = ANY (reloptions) FROM pg_class
                    WHERE oid = 'public.leads_kanban'::regclass), false) THEN
    RAISE EXCEPTION '131: leads_kanban sem security_invoker';
  END IF;
  SELECT count(*) INTO fora
    FROM public.leads l
    LEFT JOIN public.funnel_stages atual ON atual.id = l.stage_id
   WHERE l.status = 'perdido' AND atual.resultado IS DISTINCT FROM 'perdido'
     AND EXISTS (SELECT 1 FROM public.funnel_stages fs WHERE fs.funnel_id = l.funnel_id AND fs.resultado = 'perdido');
  IF fora > 0 THEN
    RAISE EXCEPTION '131: % lead(s) perdido(s) ainda fora da etapa de perda do funil', fora;
  END IF;
  RAISE NOTICE '131: perdidos no quadro (etapa de perda): %, só no painel (funil sem etapa de perda): %',
    (SELECT count(*) FROM public.leads l JOIN public.funnel_stages fs ON fs.id = l.stage_id
      WHERE l.status = 'perdido' AND fs.resultado = 'perdido'),
    (SELECT count(*) FROM public.leads l LEFT JOIN public.funnel_stages fs ON fs.id = l.stage_id
      WHERE l.status = 'perdido' AND fs.resultado IS DISTINCT FROM 'perdido');
END $$;
