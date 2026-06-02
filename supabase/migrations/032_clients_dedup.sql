-- ============================================================
-- VITTA CORE CRM — Migration 032: Prevenção de clientes duplicados
-- ============================================================

-- 1. Índice UNIQUE parcial: um lead só pode ter um cliente vinculado
CREATE UNIQUE INDEX IF NOT EXISTS idx_clients_lead_id_unique
  ON clients(lead_id)
  WHERE lead_id IS NOT NULL;

-- 2. Remover duplicatas existentes por lead_id (mantém o mais antigo)
--    Antes de criar o índice, se já houver dupes, precisamos limpá-los.
--    Esta CTE identifica o id a MANTER (menor criado_em) e deleta os demais.
WITH ranked AS (
  SELECT id,
         ROW_NUMBER() OVER (PARTITION BY lead_id ORDER BY criado_em) AS rn
  FROM clients
  WHERE lead_id IS NOT NULL
)
DELETE FROM clients
WHERE id IN (SELECT id FROM ranked WHERE rn > 1);
