-- ============================================================
-- VITTA CORE CRM — Migration 011: Preço de custo em produtos
-- Necessário para cálculo de margem no módulo de orçamentos
-- ============================================================

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS valor_venda NUMERIC(10,2) CHECK (valor_venda >= 0),
  ADD COLUMN IF NOT EXISTS valor_custo NUMERIC(10,2) CHECK (valor_custo >= 0);

-- Recriar view para incluir campos de custo (DROP necessário para renomear colunas)
DROP VIEW IF EXISTS product_current_price;
CREATE VIEW product_current_price AS
  SELECT
    p.id,
    p.nome,
    p.tipo,
    p.unit_id,
    p.descricao,
    p.valor_venda,
    p.valor_custo,
    pp.valor        AS valor_tabela,    -- preço de tabela versionado (legado)
    pp.vigencia_inicio
  FROM products p
  LEFT JOIN product_prices pp ON pp.product_id = p.id
    AND (pp.vigencia_fim IS NULL OR pp.vigencia_fim >= CURRENT_DATE)
  WHERE p.ativo = TRUE;
