-- ============================================================
-- VITTA CORE CRM — Migration 020: Pacote de condições de pagamento
-- Permite exibir opções de pagamento com desconto no orçamento
-- ============================================================

ALTER TABLE quotes
  ADD COLUMN IF NOT EXISTS pacote_ativo  BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS pacote_opcoes JSONB;
