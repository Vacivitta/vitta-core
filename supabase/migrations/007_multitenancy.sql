-- ============================================================
-- VITTA CORE CRM — Migration 007: Multi-tenancy
-- Adiciona infraestrutura de tenants/unidades e atualiza perfis
-- ============================================================

-- ── 1. Tabela de tenants (licenciados/franqueados) ─────────────────────────

CREATE TABLE tenants (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome        TEXT NOT NULL,
  documento   TEXT,
  ativo       BOOLEAN NOT NULL DEFAULT TRUE,
  criado_em   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated acessa tenants" ON tenants
  FOR ALL USING (auth.role() = 'authenticated');

-- ── 2. Tabela de unidades (clínicas físicas) ───────────────────────────────

CREATE TABLE units (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id),
  nome        TEXT NOT NULL,
  cidade      TEXT,
  estado      TEXT,
  telefone    TEXT,
  ativo       BOOLEAN NOT NULL DEFAULT TRUE,
  criado_em   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_units_tenant ON units(tenant_id);

ALTER TABLE units ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated acessa units" ON units
  FOR ALL USING (auth.role() = 'authenticated');

-- ── 3. Atualizar profiles ──────────────────────────────────────────────────
-- Adicionar: perfil (novo campo de role), unit_id, ativo
-- Remover:   role (campo antigo)

ALTER TABLE profiles
  ADD COLUMN perfil  TEXT NOT NULL DEFAULT 'atendente'
    CHECK (perfil IN ('admin', 'gestor_vacivitta', 'gestor_unidade', 'atendente')),
  ADD COLUMN unit_id UUID REFERENCES units(id),
  ADD COLUMN ativo   BOOLEAN NOT NULL DEFAULT TRUE;

-- Migrar valores existentes: gestor → gestor_unidade, operador → atendente
UPDATE profiles SET perfil = CASE
  WHEN role = 'gestor'   THEN 'gestor_unidade'
  WHEN role = 'operador' THEN 'atendente'
  ELSE 'atendente'
END;

-- Pedro Araújo como admin
UPDATE profiles
  SET perfil = 'admin'
  WHERE id = (SELECT id FROM auth.users WHERE email = 'pedro.araujo@vacivitta.com.br');

ALTER TABLE profiles DROP COLUMN role;

-- ── 4. Tabela de vínculo usuário-unidade ───────────────────────────────────

CREATE TABLE user_units (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  unit_id     UUID NOT NULL REFERENCES units(id) ON DELETE CASCADE,
  ativo       BOOLEAN NOT NULL DEFAULT TRUE,
  criado_em   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, unit_id)
);

CREATE INDEX idx_user_units_user ON user_units(user_id);
CREATE INDEX idx_user_units_unit ON user_units(unit_id);

ALTER TABLE user_units ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated acessa user_units" ON user_units
  FOR ALL USING (auth.role() = 'authenticated');

-- ── 5. Adicionar unit_id às tabelas existentes ─────────────────────────────

ALTER TABLE leads                    ADD COLUMN IF NOT EXISTS unit_id UUID REFERENCES units(id);
ALTER TABLE funnels                  ADD COLUMN IF NOT EXISTS unit_id UUID REFERENCES units(id);
ALTER TABLE funnel_stages            ADD COLUMN IF NOT EXISTS unit_id UUID REFERENCES units(id);
ALTER TABLE lead_responsible_history ADD COLUMN IF NOT EXISTS unit_id UUID REFERENCES units(id);
ALTER TABLE lead_notes               ADD COLUMN IF NOT EXISTS unit_id UUID REFERENCES units(id);
ALTER TABLE lead_tasks               ADD COLUMN IF NOT EXISTS unit_id UUID REFERENCES units(id);
ALTER TABLE lead_contacts            ADD COLUMN IF NOT EXISTS unit_id UUID REFERENCES units(id);

CREATE INDEX IF NOT EXISTS idx_leads_unit    ON leads(unit_id);
CREATE INDEX IF NOT EXISTS idx_funnels_unit  ON funnels(unit_id);

-- ── 6. Seed: tenant + unidade padrão e atribuição dos dados existentes ──────

DO $$
DECLARE
  v_tenant_id UUID;
  v_unit_id   UUID;
BEGIN
  INSERT INTO tenants (nome, documento)
  VALUES ('Vacivitta Franquias', '')
  RETURNING id INTO v_tenant_id;

  INSERT INTO units (tenant_id, nome, cidade, estado)
  VALUES (v_tenant_id, 'Vacivitta Sede', 'São Paulo', 'SP')
  RETURNING id INTO v_unit_id;

  -- Vincular todos os perfis existentes à unidade padrão
  UPDATE profiles SET unit_id = v_unit_id;

  INSERT INTO user_units (user_id, unit_id)
  SELECT id, v_unit_id FROM profiles;

  -- Atribuir unit_id nos dados existentes
  UPDATE leads                    SET unit_id = v_unit_id WHERE unit_id IS NULL;
  UPDATE funnels                  SET unit_id = v_unit_id WHERE unit_id IS NULL;
  UPDATE funnel_stages            SET unit_id = v_unit_id WHERE unit_id IS NULL;
  UPDATE lead_responsible_history SET unit_id = v_unit_id WHERE unit_id IS NULL;
  UPDATE lead_notes               SET unit_id = v_unit_id WHERE unit_id IS NULL;
  UPDATE lead_tasks               SET unit_id = v_unit_id WHERE unit_id IS NULL;
  UPDATE lead_contacts            SET unit_id = v_unit_id WHERE unit_id IS NULL;
END;
$$;

-- ── 7. Atualizar trigger de criação de usuário ─────────────────────────────

CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO profiles (id, full_name, perfil, ativo)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email),
    'atendente',
    TRUE
  );
  RETURN NEW;
END;
$$;
