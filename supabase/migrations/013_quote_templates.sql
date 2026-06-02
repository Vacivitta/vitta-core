-- ============================================================
-- VITTA CORE CRM — Migration 013: Templates de Orçamento
-- Templates visuais por unidade para geração de PDF
-- ============================================================

-- ⚠️  Antes de rodar: criar bucket público "quote-templates" no
--     Supabase Dashboard → Storage → New Bucket
--     Name: quote-templates  |  Public: true

CREATE TABLE quote_templates (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id          UUID NOT NULL REFERENCES units(id),
  nome             TEXT NOT NULL,
  age_group        TEXT NOT NULL DEFAULT 'todos'
                     CHECK (age_group IN ('crianca', 'adulto', 'idoso', 'todos')),

  -- Visual
  logo_url         TEXT,          -- URL pública do Supabase Storage
  cor_primaria     TEXT NOT NULL DEFAULT '#1D9E75',
  cor_secundaria   TEXT NOT NULL DEFAULT '#185FA5',

  -- Dados da clínica impressos no PDF
  nome_clinica     TEXT,
  endereco         TEXT,
  cidade_estado    TEXT,
  telefone_clinica TEXT,
  cnpj             TEXT,

  -- Textos livres
  texto_cabecalho  TEXT,          -- tagline, slogan
  texto_rodape     TEXT,          -- termos, validade, observações

  -- Configurações
  validade_dias    INTEGER NOT NULL DEFAULT 7,
  is_default       BOOLEAN NOT NULL DEFAULT FALSE,
  ativo            BOOLEAN NOT NULL DEFAULT TRUE,

  criado_em        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  atualizado_em    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_quote_templates_unit    ON quote_templates(unit_id);
CREATE INDEX idx_quote_templates_default ON quote_templates(unit_id, is_default) WHERE is_default = TRUE;

ALTER TABLE quote_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated acessa templates" ON quote_templates
  FOR ALL USING (auth.role() = 'authenticated');

CREATE TRIGGER quote_templates_updated_at
  BEFORE UPDATE ON quote_templates
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Garante apenas 1 template default por unidade+age_group (via trigger)
CREATE OR REPLACE FUNCTION enforce_single_default_template()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.is_default = TRUE THEN
    UPDATE quote_templates
      SET is_default = FALSE
      WHERE unit_id = NEW.unit_id
        AND age_group = NEW.age_group
        AND id <> NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER quote_templates_single_default
  AFTER INSERT OR UPDATE OF is_default ON quote_templates
  FOR EACH ROW
  WHEN (NEW.is_default = TRUE)
  EXECUTE FUNCTION enforce_single_default_template();
