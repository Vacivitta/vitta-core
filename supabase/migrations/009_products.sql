-- ============================================================
-- VITTA CORE CRM — Migration 009: Catálogo de Produtos
-- Vacinas, combos e serviços com versionamento de preço
-- ============================================================

-- ── 1. Produtos ────────────────────────────────────────────────────────────

CREATE TABLE products (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id     UUID NOT NULL REFERENCES units(id),
  nome        TEXT NOT NULL,
  tipo        TEXT CHECK (tipo IN ('vacina', 'combo', 'servico')),
  descricao   TEXT,
  ativo       BOOLEAN NOT NULL DEFAULT TRUE,
  criado_em   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_products_unit  ON products(unit_id);
CREATE INDEX idx_products_tipo  ON products(tipo);
CREATE INDEX idx_products_ativo ON products(unit_id, ativo);

ALTER TABLE products ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated acessa produtos" ON products
  FOR ALL USING (auth.role() = 'authenticated');

-- ── 2. Preços com vigência ─────────────────────────────────────────────────
-- Reajuste: fechar vigência atual (vigencia_fim = hoje) e inserir novo registro
-- Orçamentos já emitidos usam valor_snapshot — nunca são recalculados

CREATE TABLE product_prices (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id       UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  unit_id          UUID NOT NULL REFERENCES units(id),
  valor            NUMERIC(10,2) NOT NULL CHECK (valor >= 0),
  vigencia_inicio  DATE NOT NULL DEFAULT CURRENT_DATE,
  vigencia_fim     DATE,
  criado_em        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT vigencia_check CHECK (vigencia_fim IS NULL OR vigencia_fim >= vigencia_inicio)
);

CREATE INDEX idx_product_prices_product ON product_prices(product_id);
CREATE INDEX idx_product_prices_unit    ON product_prices(unit_id);
CREATE INDEX idx_product_prices_vigente ON product_prices(unit_id)
  WHERE vigencia_fim IS NULL;

ALTER TABLE product_prices ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated acessa preços" ON product_prices
  FOR ALL USING (auth.role() = 'authenticated');

-- ── 3. View — preço ativo por produto ─────────────────────────────────────

CREATE OR REPLACE VIEW product_current_price AS
  SELECT
    p.id,
    p.nome,
    p.tipo,
    p.unit_id,
    p.descricao,
    pp.valor,
    pp.vigencia_inicio
  FROM products p
  JOIN product_prices pp ON pp.product_id = p.id
  WHERE (pp.vigencia_fim IS NULL OR pp.vigencia_fim >= CURRENT_DATE)
    AND p.ativo = TRUE;
