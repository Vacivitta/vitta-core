-- ============================================================
-- VITTA CORE CRM — Migration 010: Módulo de Orçamentos
-- Orçamento enviado ao cliente com ciclo de vida rastreado
-- ============================================================

-- ── 1. Orçamentos ──────────────────────────────────────────────────────────

CREATE TABLE quotes (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id         UUID NOT NULL REFERENCES units(id),
  client_id       UUID REFERENCES clients(id),    -- preenchido se cliente já existe
  lead_id         UUID REFERENCES leads(id),       -- preenchido se ainda é lead
  -- CONSTRAINT: pelo menos um dos dois deve ser preenchido (validar no backend)
  numero          BIGINT,                          -- sequencial por unidade (via trigger)
  status          TEXT NOT NULL DEFAULT 'rascunho'
                    CHECK (status IN (
                      'rascunho', 'enviado', 'visualizado',
                      'aceito', 'recusado', 'em_negociacao', 'expirado'
                    )),
  motivo_recusa   TEXT,
  responsavel_id  UUID REFERENCES profiles(id) ON DELETE SET NULL,
  validade_ate    DATE,
  observacoes     TEXT,
  total_calculado NUMERIC(10,2),                   -- calculado pelo backend, nunca pelo frontend
  token_publico   UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  enviado_em      TIMESTAMPTZ,
  visualizado_em  TIMESTAMPTZ,
  aceito_em       TIMESTAMPTZ,
  criado_em       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  atualizado_em   TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- motivo_recusa obrigatório quando status = recusado
  CONSTRAINT motivo_recusa_required CHECK (
    status <> 'recusado' OR (motivo_recusa IS NOT NULL AND motivo_recusa <> '')
  )
);

CREATE INDEX idx_quotes_unit        ON quotes(unit_id);
CREATE INDEX idx_quotes_client      ON quotes(client_id) WHERE client_id IS NOT NULL;
CREATE INDEX idx_quotes_lead        ON quotes(lead_id)   WHERE lead_id IS NOT NULL;
CREATE INDEX idx_quotes_status      ON quotes(unit_id, status);
CREATE INDEX idx_quotes_responsavel ON quotes(responsavel_id);
CREATE UNIQUE INDEX idx_quotes_token ON quotes(token_publico);

ALTER TABLE quotes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated acessa orçamentos" ON quotes
  FOR ALL USING (auth.role() = 'authenticated');

CREATE TRIGGER quotes_updated_at
  BEFORE UPDATE ON quotes
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── 2. Itens do orçamento ──────────────────────────────────────────────────
-- valor_snapshot e nome_snapshot são imutáveis após criação

CREATE TABLE quote_items (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_id        UUID NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
  unit_id         UUID NOT NULL REFERENCES units(id),
  product_id      UUID NOT NULL REFERENCES products(id),
  nome_snapshot   TEXT NOT NULL,
  valor_snapshot  NUMERIC(10,2) NOT NULL CHECK (valor_snapshot >= 0),
  quantidade      INTEGER NOT NULL DEFAULT 1 CHECK (quantidade > 0),
  desconto        NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (desconto >= 0 AND desconto <= 100),
  valor_final     NUMERIC(10,2) NOT NULL CHECK (valor_final >= 0),
  observacao      TEXT,
  criado_em       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_quote_items_quote   ON quote_items(quote_id);
CREATE INDEX idx_quote_items_product ON quote_items(product_id);

ALTER TABLE quote_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated acessa itens de orçamento" ON quote_items
  FOR ALL USING (auth.role() = 'authenticated');

-- ── 3. Trigger: número sequencial por unidade ─────────────────────────────

CREATE OR REPLACE FUNCTION set_quote_numero()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.numero IS NULL THEN
    SELECT COALESCE(MAX(numero), 0) + 1 INTO NEW.numero
    FROM quotes
    WHERE unit_id = NEW.unit_id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER quotes_set_numero
  BEFORE INSERT ON quotes
  FOR EACH ROW
  EXECUTE FUNCTION set_quote_numero();

-- ── 4. Proibir exclusão de orçamentos (apenas cancelar via status) ─────────

CREATE OR REPLACE FUNCTION prevent_quote_delete()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Orçamentos não podem ser excluídos. Use mudança de status para cancelar.';
END;
$$;

CREATE TRIGGER quotes_no_delete
  BEFORE DELETE ON quotes
  FOR EACH ROW
  EXECUTE FUNCTION prevent_quote_delete();
