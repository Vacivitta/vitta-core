-- ============================================================
-- VITTA CORE CRM — Migration 004
--   · alerta_horas em etapas (permanência configurável em horas)
--   · stage_changed_at em leads (quando entrou na etapa atual)
--   · view leads_arquivados (mesma estrutura de leads_kanban)
-- ============================================================

-- 1. Tempo de alerta por etapa em horas (null = sem alerta)
ALTER TABLE funnel_stages ADD COLUMN IF NOT EXISTS alerta_horas INTEGER;

-- 2. Timestamp de entrada na etapa atual
ALTER TABLE leads ADD COLUMN IF NOT EXISTS stage_changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- 3. Trigger: atualiza stage_changed_at quando stage_id muda
CREATE OR REPLACE FUNCTION fn_update_stage_changed_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.stage_id IS DISTINCT FROM OLD.stage_id THEN
    NEW.stage_changed_at = NOW();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_stage_changed_at ON leads;
CREATE TRIGGER trg_stage_changed_at
  BEFORE UPDATE ON leads
  FOR EACH ROW
  EXECUTE FUNCTION fn_update_stage_changed_at();

-- 4. Recria leads_kanban incluindo stage_changed_at e stage_alerta_horas
--    DROP + CREATE porque CREATE OR REPLACE não aceita mudança na ordem das colunas
DROP VIEW IF EXISTS leads_kanban;
DROP VIEW IF EXISTS leads_arquivados;

CREATE VIEW leads_kanban AS
SELECT
  l.*,
  p.full_name      AS responsavel_nome,
  p.avatar_url     AS responsavel_avatar,
  fs.nome          AS stage_nome,
  fs.cor           AS stage_cor,
  fs.ordem         AS stage_ordem,
  fs.alerta_horas  AS stage_alerta_horas,
  f.nome           AS funnel_nome,
  ln.valor_proposta,
  ln.modelo,
  ln.valor_negociado,
  (SELECT COUNT(*) FROM lead_tasks    t WHERE t.lead_id = l.id AND t.concluida = FALSE)::int AS tarefas_pendentes,
  (SELECT COUNT(*) FROM lead_notes    n WHERE n.lead_id = l.id)::int                         AS total_notas,
  (SELECT COUNT(*) FROM lead_contacts c WHERE c.lead_id = l.id)::int                         AS total_contatos
FROM leads l
LEFT JOIN profiles        p  ON p.id     = l.responsavel_id
LEFT JOIN funnel_stages   fs ON fs.id    = l.stage_id
LEFT JOIN funnels         f  ON f.id     = l.funnel_id
LEFT JOIN lead_negotiation ln ON ln.lead_id = l.id
WHERE l.arquivado = FALSE
ORDER BY fs.ordem, l.ordem, l.created_at;

-- 5. Nova view para leads arquivados
CREATE VIEW leads_arquivados AS
SELECT
  l.*,
  p.full_name      AS responsavel_nome,
  p.avatar_url     AS responsavel_avatar,
  fs.nome          AS stage_nome,
  fs.cor           AS stage_cor,
  fs.ordem         AS stage_ordem,
  fs.alerta_horas  AS stage_alerta_horas,
  f.nome           AS funnel_nome,
  ln.valor_proposta,
  ln.modelo,
  ln.valor_negociado,
  (SELECT COUNT(*) FROM lead_tasks    t WHERE t.lead_id = l.id AND t.concluida = FALSE)::int AS tarefas_pendentes,
  (SELECT COUNT(*) FROM lead_notes    n WHERE n.lead_id = l.id)::int                         AS total_notas,
  (SELECT COUNT(*) FROM lead_contacts c WHERE c.lead_id = l.id)::int                         AS total_contatos
FROM leads l
LEFT JOIN profiles        p  ON p.id     = l.responsavel_id
LEFT JOIN funnel_stages   fs ON fs.id    = l.stage_id
LEFT JOIN funnels         f  ON f.id     = l.funnel_id
LEFT JOIN lead_negotiation ln ON ln.lead_id = l.id
WHERE l.arquivado = TRUE
ORDER BY l.updated_at DESC;
