-- ============================================================
-- VITTA CORE CRM — Migration 012: Renomeia tipo 'combo' → 'pacote'
-- ============================================================

-- Atualizar constraint de check
ALTER TABLE products DROP CONSTRAINT IF EXISTS products_tipo_check;
ALTER TABLE products ADD CONSTRAINT products_tipo_check
  CHECK (tipo IN ('vacina', 'pacote', 'servico'));

-- Migrar dados existentes
UPDATE products SET tipo = 'pacote' WHERE tipo = 'combo';
