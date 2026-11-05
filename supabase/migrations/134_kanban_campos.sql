-- 134_kanban_campos.sql
-- leads_kanban passa a trazer os campos personalizados do lead (leads.campos).
--
-- Por quê: o funil vai filtrar por campo personalizado (seleção, múltipla e
-- sim/não) e lê os leads só por leads_kanban. A 129 deixou a view sem campos
-- (a ficha lê leads.campos direto).
--
-- O que faz: CREATE OR REPLACE da leads_kanban com a definição EXATA da 132 e
-- l.campos como última coluna (CREATE OR REPLACE VIEW só aceita colunas novas no
-- fim; as da 132 ficam na mesma ordem e com os mesmos tipos). security_invoker
-- continua (RLS de leads por unidade vale para quem lê), anon continua sem
-- acesso (REVOKE de novo, como a 086/132). leads_arquivados não muda.
--
-- Depende da 129 (leads.campos) e da 132 (leads_kanban com arquivado_em, filtro
-- WHERE NOT l.arquivado). Aplicar em produção é [H]: o Infra aplica, com
-- aprovação e backup do dia, como supabase_admin, com --single-transaction;
-- depois registra a versão '134' e roda notify pgrst, 'reload schema'. Sem
-- BEGIN/COMMIT. Idempotente. Não reescreve dados (só a definição da view).
-- Pode ir antes ou depois do deploy do app: o app lê leads_kanban com
-- select('*'); sem a 134 o filtro por campo só não encontra ninguém.
-- Depois de um restore, reaplicar DEPOIS da 132 (a 132 faz DROP + CREATE da
-- view e tira a coluna campos): ordem completa no CLAUDE.md. A 132 reaplicada
-- depois desta passa, mas tira campos da view: reaplicar a 134 em seguida.
--
-- Reversão (só com aprovação): DROP VIEW leads_kanban e recriar como na 132
-- (CREATE OR REPLACE não remove coluna), com REVOKE anon e GRANT de novo.

SET LOCAL lock_timeout = '5s';

DO $$
BEGIN
  IF current_setting('lock_timeout') <> '5s' THEN
    RAISE EXCEPTION '134: rode com --single-transaction (lock_timeout atual: %)', current_setting('lock_timeout');
  END IF;
  IF current_user <> 'supabase_admin' THEN
    RAISE EXCEPTION '134: rodar como supabase_admin (atual: %)', current_user;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'leads' AND column_name = 'campos') THEN
    RAISE EXCEPTION '134: depende da 129 (leads.campos)';
  END IF;
  IF to_regprocedure('public.fn_lead_arquivado()') IS NULL
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns
                     WHERE table_schema = 'public' AND table_name = 'leads_kanban' AND column_name = 'arquivado_em') THEN
    RAISE EXCEPTION '134: depende da 132 (leads_kanban com arquivado_em; depois de reaplicar a 126 ou a 131, reaplique a 132 antes)';
  END IF;
END $$;

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
    l.campos
   FROM leads l
     LEFT JOIN profiles p ON p.id = l.responsavel_id
     LEFT JOIN funnel_stages fs ON fs.id = l.stage_id
     LEFT JOIN funnels f ON f.id = l.funnel_id
     LEFT JOIN lead_negotiation ln ON ln.lead_id = l.id
     LEFT JOIN motivos_perda mp ON mp.id = l.motivo_perda_id
  WHERE NOT l.arquivado
  ORDER BY fs.ordem, l.ordem, l.created_at;

REVOKE ALL ON public.leads_kanban FROM anon;
GRANT SELECT ON public.leads_kanban TO authenticated, service_role;

-- ── Conferência ──────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF (SELECT attname FROM pg_attribute
       WHERE attrelid = 'public.leads_kanban'::regclass AND attnum > 0 AND NOT attisdropped
       ORDER BY attnum DESC LIMIT 1) IS DISTINCT FROM 'campos' THEN
    RAISE EXCEPTION '134: leads_kanban deveria terminar na coluna campos';
  END IF;
  IF has_table_privilege('anon', 'public.leads_kanban', 'SELECT') THEN
    RAISE EXCEPTION '134: anon lê leads_kanban';
  END IF;
  IF NOT coalesce((SELECT 'security_invoker=true' = ANY (reloptions) FROM pg_class
                    WHERE oid = 'public.leads_kanban'::regclass), false) THEN
    RAISE EXCEPTION '134: leads_kanban sem security_invoker';
  END IF;
END $$;
