-- ============================================================
-- VITTA CORE CRM — Migration 032: Prevenção de clientes duplicados
-- ============================================================

-- 1. Remover duplicatas ANTES de criar o índice único
--    Mantém o registro mais antigo (menor criado_em) por lead_id.
WITH ranked AS (
  SELECT id,
         ROW_NUMBER() OVER (PARTITION BY lead_id ORDER BY criado_em) AS rn
  FROM clients
  WHERE lead_id IS NOT NULL
)
DELETE FROM clients
WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

-- 2. Agora que não há duplicatas, cria o índice UNIQUE parcial
CREATE UNIQUE INDEX IF NOT EXISTS idx_clients_lead_id_unique
  ON clients(lead_id)
  WHERE lead_id IS NOT NULL;
