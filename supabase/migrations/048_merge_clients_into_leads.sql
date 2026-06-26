-- ============================================================
-- VITTA CORE CRM — Migration 048: Unificação clients → leads
-- Absorve a tabela clients em leads. Todo contato passa a ser
-- um lead; a flag is_converted distingue clientes convertidos.
-- ============================================================

-- 1. Adicionar colunas de cliente em leads (todas nullable para não quebrar dados existentes)
ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS data_nascimento DATE,
  ADD COLUMN IF NOT EXISTS cpf             TEXT,
  ADD COLUMN IF NOT EXISTS observacoes_cli TEXT,
  ADD COLUMN IF NOT EXISTS is_converted    BOOLEAN NOT NULL DEFAULT FALSE;

-- 2a. Vincular clients avulsos (sem lead_id) ao lead com mesmo telefone, se existir
UPDATE clients c SET
  lead_id = l.id
FROM leads l
WHERE c.lead_id  IS NULL
  AND c.unit_id   = l.unit_id
  AND c.telefone IS NOT NULL
  AND l.telefone  = c.telefone;

-- 2b. Migrar dados de clients → leads (apenas onde existe lead_id)
UPDATE leads l SET
  data_nascimento = c.data_nascimento,
  cpf             = c.cpf,
  observacoes_cli = c.observacoes,
  is_converted    = TRUE
FROM clients c
WHERE c.lead_id = l.id;

-- 3. Migrar quotes.client_id → quotes.lead_id (onde só existia client_id, sem lead_id)
UPDATE quotes q SET
  lead_id = c.lead_id
FROM clients c
WHERE q.client_id = c.id
  AND q.lead_id   IS NULL
  AND c.lead_id   IS NOT NULL;

-- 4. Dropar client_contacts (dados de observacoes já migrados para leads.observacoes_cli)
DROP TABLE IF EXISTS client_contacts;

-- 5. Remover todas as FKs para clients, depois dropar a tabela
ALTER TABLE quotes          DROP COLUMN IF EXISTS client_id;
ALTER TABLE leads           DROP COLUMN IF EXISTS client_id;
ALTER TABLE wa_conversations DROP COLUMN IF EXISTS client_id;
DROP TABLE IF EXISTS clients;

-- 6. Índices úteis nas novas colunas
CREATE INDEX IF NOT EXISTS idx_leads_is_converted ON leads(unit_id, is_converted);
CREATE INDEX IF NOT EXISTS idx_leads_cpf ON leads(cpf) WHERE cpf IS NOT NULL;
