-- ============================================================
-- VITTA CORE CRM — Migration 008: Módulo Clientes
-- Lead que compra vira Cliente (ciclos de vida distintos)
-- ============================================================

-- ── 1. Tabela de clientes ──────────────────────────────────────────────────

CREATE TABLE clients (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id         UUID NOT NULL REFERENCES units(id),
  lead_id         UUID REFERENCES leads(id),   -- origem (nullable)
  nome            TEXT NOT NULL,
  sobrenome       TEXT,
  telefone        TEXT,
  email           TEXT,
  data_nascimento DATE,
  cpf             TEXT,
  observacoes     TEXT,
  criado_em       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  atualizado_em   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_clients_unit   ON clients(unit_id);
CREATE INDEX idx_clients_lead   ON clients(lead_id);
CREATE INDEX idx_clients_nome   ON clients(nome);
CREATE INDEX idx_clients_cpf    ON clients(cpf) WHERE cpf IS NOT NULL;

ALTER TABLE clients ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated acessa clientes" ON clients
  FOR ALL USING (auth.role() = 'authenticated');

CREATE TRIGGER clients_updated_at
  BEFORE UPDATE ON clients
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── 2. Contatos adicionais do cliente ─────────────────────────────────────

CREATE TABLE client_contacts (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id   UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  unit_id     UUID NOT NULL REFERENCES units(id),
  nome        TEXT NOT NULL,
  telefone    TEXT,
  email       TEXT,
  cargo       TEXT,
  observacao  TEXT,
  criado_em   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_client_contacts_client ON client_contacts(client_id);

ALTER TABLE client_contacts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated acessa contatos de clientes" ON client_contacts
  FOR ALL USING (auth.role() = 'authenticated');

-- ── 3. Ligar lead ao cliente após conversão ────────────────────────────────

ALTER TABLE leads ADD COLUMN IF NOT EXISTS client_id UUID REFERENCES clients(id);
CREATE INDEX IF NOT EXISTS idx_leads_client ON leads(client_id) WHERE client_id IS NOT NULL;
