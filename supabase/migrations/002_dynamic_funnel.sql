-- ============================================================
-- VITTA CORE CRM — Migration 002: Funis Dinâmicos
-- ============================================================

-- ============================================================
-- 1. TABELA DE FUNIS
-- ============================================================
CREATE TABLE funnels (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome        TEXT NOT NULL,
  descricao   TEXT,
  ativo       BOOLEAN NOT NULL DEFAULT TRUE,
  ordem       INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_funnels_ativo ON funnels(ativo);

ALTER TABLE funnels ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated acessa funis" ON funnels
  FOR ALL USING (auth.role() = 'authenticated');

-- ============================================================
-- 2. TABELA DE ETAPAS DO FUNIL
-- ============================================================
CREATE TABLE funnel_stages (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  funnel_id   UUID NOT NULL REFERENCES funnels(id) ON DELETE CASCADE,
  nome        TEXT NOT NULL,
  cor         TEXT NOT NULL DEFAULT '#94a3b8',
  ordem       INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT funnel_stages_unique_order UNIQUE (funnel_id, ordem) DEFERRABLE INITIALLY DEFERRED
);

CREATE INDEX idx_funnel_stages_funnel ON funnel_stages(funnel_id);
CREATE INDEX idx_funnel_stages_ordem  ON funnel_stages(funnel_id, ordem);

ALTER TABLE funnel_stages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated acessa etapas" ON funnel_stages
  FOR ALL USING (auth.role() = 'authenticated');

-- ============================================================
-- 3. DROP VIEW (depende de leads.stage)
-- ============================================================
DROP VIEW IF EXISTS leads_kanban;

-- ============================================================
-- 4. ADICIONAR NOVAS COLUNAS EM LEADS (nullable por enquanto)
-- ============================================================
ALTER TABLE leads
  ADD COLUMN funnel_id UUID REFERENCES funnels(id) ON DELETE SET NULL,
  ADD COLUMN stage_id  UUID REFERENCES funnel_stages(id) ON DELETE SET NULL;

-- ============================================================
-- 5. INSERIR FUNIL PADRÃO, ETAPAS E MIGRAR DADOS EXISTENTES
-- ============================================================
DO $$
DECLARE
  v_funnel_id       UUID;
  v_stage_lead      UUID;
  v_stage_interacao UUID;
  v_stage_reuniao   UUID;
  v_stage_negoc     UUID;
  v_stage_followup  UUID;
  v_stage_vendido   UUID;
  v_stage_perdido   UUID;
BEGIN
  -- Funil padrão
  INSERT INTO funnels (nome, descricao, ativo, ordem)
  VALUES ('Funil de Vendas', 'Funil comercial padrão', TRUE, 0)
  RETURNING id INTO v_funnel_id;

  -- Etapas na ordem original
  INSERT INTO funnel_stages (funnel_id, nome, cor, ordem)
  VALUES (v_funnel_id, 'Lead', '#94a3b8', 0)
  RETURNING id INTO v_stage_lead;

  INSERT INTO funnel_stages (funnel_id, nome, cor, ordem)
  VALUES (v_funnel_id, 'Em Interação', '#60a5fa', 1)
  RETURNING id INTO v_stage_interacao;

  INSERT INTO funnel_stages (funnel_id, nome, cor, ordem)
  VALUES (v_funnel_id, 'Reunião', '#a78bfa', 2)
  RETURNING id INTO v_stage_reuniao;

  INSERT INTO funnel_stages (funnel_id, nome, cor, ordem)
  VALUES (v_funnel_id, 'Negociação', '#fbbf24', 3)
  RETURNING id INTO v_stage_negoc;

  INSERT INTO funnel_stages (funnel_id, nome, cor, ordem)
  VALUES (v_funnel_id, 'Follow-up de Proposta', '#fb923c', 4)
  RETURNING id INTO v_stage_followup;

  INSERT INTO funnel_stages (funnel_id, nome, cor, ordem)
  VALUES (v_funnel_id, 'Vendido', '#34d399', 5)
  RETURNING id INTO v_stage_vendido;

  INSERT INTO funnel_stages (funnel_id, nome, cor, ordem)
  VALUES (v_funnel_id, 'Perdido', '#f87171', 6)
  RETURNING id INTO v_stage_perdido;

  -- Migrar leads existentes
  UPDATE leads SET funnel_id = v_funnel_id, stage_id = v_stage_lead      WHERE stage = 'lead';
  UPDATE leads SET funnel_id = v_funnel_id, stage_id = v_stage_interacao  WHERE stage = 'lead_em_interacao';
  UPDATE leads SET funnel_id = v_funnel_id, stage_id = v_stage_reuniao    WHERE stage = 'reuniao';
  UPDATE leads SET funnel_id = v_funnel_id, stage_id = v_stage_negoc      WHERE stage = 'negociacao';
  UPDATE leads SET funnel_id = v_funnel_id, stage_id = v_stage_followup   WHERE stage = 'followup_proposta';
  UPDATE leads SET funnel_id = v_funnel_id, stage_id = v_stage_vendido    WHERE stage = 'vendido';
  UPDATE leads SET funnel_id = v_funnel_id, stage_id = v_stage_perdido    WHERE stage = 'perdido';
END;
$$;

-- ============================================================
-- 6. TORNAR COLUNAS OBRIGATÓRIAS E ADICIONAR ÍNDICES
-- ============================================================
ALTER TABLE leads
  ALTER COLUMN funnel_id SET NOT NULL,
  ALTER COLUMN stage_id  SET NOT NULL;

CREATE INDEX idx_leads_funnel   ON leads(funnel_id);
CREATE INDEX idx_leads_stage_id ON leads(stage_id);

-- ============================================================
-- 7. REMOVER COLUNA ANTIGA E ENUM
-- ============================================================
ALTER TABLE leads DROP COLUMN stage;

DROP TYPE lead_stage;

-- ============================================================
-- 8. RECRIAR VIEW leads_kanban COM JOIN NAS NOVAS TABELAS
-- ============================================================
CREATE OR REPLACE VIEW leads_kanban AS
SELECT
  l.*,
  p.full_name                                                               AS responsavel_nome,
  p.avatar_url                                                              AS responsavel_avatar,
  fs.nome                                                                   AS stage_nome,
  fs.cor                                                                    AS stage_cor,
  fs.ordem                                                                  AS stage_ordem,
  f.nome                                                                    AS funnel_nome,
  ln.valor_proposta,
  ln.modelo,
  ln.valor_negociado,
  (SELECT COUNT(*) FROM lead_tasks t    WHERE t.lead_id = l.id AND t.concluida = FALSE)::int AS tarefas_pendentes,
  (SELECT COUNT(*) FROM lead_notes n    WHERE n.lead_id = l.id)::int                         AS total_notas,
  (SELECT COUNT(*) FROM lead_contacts c WHERE c.lead_id = l.id)::int                         AS total_contatos
FROM leads l
LEFT JOIN profiles        p  ON p.id  = l.responsavel_id
LEFT JOIN funnel_stages   fs ON fs.id = l.stage_id
LEFT JOIN funnels         f  ON f.id  = l.funnel_id
LEFT JOIN lead_negotiation ln ON ln.lead_id = l.id
WHERE l.arquivado = FALSE
ORDER BY fs.ordem, l.ordem, l.created_at;
