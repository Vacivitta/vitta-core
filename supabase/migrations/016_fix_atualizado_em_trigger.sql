-- ============================================================
-- VITTA CORE CRM — Migration 016: Corrige triggers atualizado_em
-- As tabelas clients, quotes e quote_templates usam "atualizado_em"
-- mas o trigger set_updated_at() espera a coluna "updated_at"
-- ============================================================

-- Nova função para tabelas com coluna atualizado_em
CREATE OR REPLACE FUNCTION set_atualizado_em()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.atualizado_em = NOW();
  RETURN NEW;
END;
$$;

-- clients
DROP TRIGGER IF EXISTS clients_updated_at ON clients;
CREATE TRIGGER clients_updated_at
  BEFORE UPDATE ON clients
  FOR EACH ROW EXECUTE FUNCTION set_atualizado_em();

-- quotes
DROP TRIGGER IF EXISTS quotes_updated_at ON quotes;
CREATE TRIGGER quotes_updated_at
  BEFORE UPDATE ON quotes
  FOR EACH ROW EXECUTE FUNCTION set_atualizado_em();

-- quote_templates
DROP TRIGGER IF EXISTS quote_templates_updated_at ON quote_templates;
CREATE TRIGGER quote_templates_updated_at
  BEFORE UPDATE ON quote_templates
  FOR EACH ROW EXECUTE FUNCTION set_atualizado_em();
