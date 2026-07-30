-- Taxas de máquina por forma de pagamento (configurável por unidade)
CREATE TABLE unit_payment_fees (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id    UUID NOT NULL REFERENCES units(id),
  pix        NUMERIC(5,2) NOT NULL DEFAULT 0,
  debito     NUMERIC(5,2) NOT NULL DEFAULT 0,
  credito_1x NUMERIC(5,2) NOT NULL DEFAULT 0,
  credito_2x NUMERIC(5,2) NOT NULL DEFAULT 0,
  credito_3x NUMERIC(5,2) NOT NULL DEFAULT 0,
  credito_4x NUMERIC(5,2) NOT NULL DEFAULT 0,
  credito_5x NUMERIC(5,2) NOT NULL DEFAULT 0,
  credito_6x NUMERIC(5,2) NOT NULL DEFAULT 0,
  credito_7x NUMERIC(5,2) NOT NULL DEFAULT 0,
  credito_8x NUMERIC(5,2) NOT NULL DEFAULT 0,
  credito_9x NUMERIC(5,2) NOT NULL DEFAULT 0,
  credito_10x NUMERIC(5,2) NOT NULL DEFAULT 0,
  credito_11x NUMERIC(5,2) NOT NULL DEFAULT 0,
  credito_12x NUMERIC(5,2) NOT NULL DEFAULT 0,
  credito_13x NUMERIC(5,2) NOT NULL DEFAULT 0,
  credito_14x NUMERIC(5,2) NOT NULL DEFAULT 0,
  credito_15x NUMERIC(5,2) NOT NULL DEFAULT 0,
  credito_16x NUMERIC(5,2) NOT NULL DEFAULT 0,
  credito_17x NUMERIC(5,2) NOT NULL DEFAULT 0,
  credito_18x NUMERIC(5,2) NOT NULL DEFAULT 0,
  criado_em  TIMESTAMPTZ DEFAULT now(),
  UNIQUE(unit_id)
);

ALTER TABLE unit_payment_fees ENABLE ROW LEVEL SECURITY;

CREATE POLICY "unit_payment_fees_unit" ON unit_payment_fees
  FOR ALL USING (unit_id IN (
    SELECT unit_id FROM profiles WHERE id = auth.uid()
  ));

-- Adicionar custo_snapshot no quote_items para preservar o custo no momento do orçamento
ALTER TABLE quote_items ADD COLUMN IF NOT EXISTS custo_snapshot NUMERIC(12,2) DEFAULT NULL;
