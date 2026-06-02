-- ============================================================
-- VITTA CORE CRM — Migration 032: Prevenção de clientes duplicados
-- ============================================================

-- 1. Identificar duplicatas: para cada lead_id, o cliente a MANTER (mais antigo)
--    e os que serão removidos (mais novos).

-- 1a. Redirecionar leads.client_id que apontam para o duplicado → para o keeper
UPDATE leads l
SET    client_id = keeper.id
FROM (
  SELECT DISTINCT ON (lead_id)
    id,
    lead_id
  FROM clients
  WHERE lead_id IS NOT NULL
  ORDER BY lead_id, criado_em   -- o mais antigo é o keeper
) AS keeper
JOIN clients dup
  ON dup.lead_id = keeper.lead_id
 AND dup.id     <> keeper.id
WHERE l.client_id = dup.id;

-- 1b. Agora sim: deletar os duplicados (sem FK pendente)
WITH ranked AS (
  SELECT id,
         ROW_NUMBER() OVER (PARTITION BY lead_id ORDER BY criado_em) AS rn
  FROM clients
  WHERE lead_id IS NOT NULL
)
DELETE FROM clients
WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

-- 2. Criar índice UNIQUE parcial (agora sem duplicatas)
CREATE UNIQUE INDEX IF NOT EXISTS idx_clients_lead_id_unique
  ON clients(lead_id)
  WHERE lead_id IS NOT NULL;
