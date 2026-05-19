-- ============================================================
-- VITTA CORE CRM — Schema Inicial
-- ============================================================

-- Tipos enumerados
CREATE TYPE lead_stage AS ENUM (
  'lead',
  'lead_em_interacao',
  'reuniao',
  'negociacao',
  'followup_proposta',
  'vendido',
  'perdido'
);

CREATE TYPE contact_role AS ENUM (
  'proprietario',
  'secretaria',
  'financeiro',
  'socio',
  'outro'
);

-- ============================================================
-- PROFILES (extensão do auth.users)
-- ============================================================
CREATE TABLE profiles (
  id          UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name   TEXT NOT NULL,
  avatar_url  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Usuários veem todos os perfis" ON profiles
  FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "Usuário edita próprio perfil" ON profiles
  FOR UPDATE USING (auth.uid() = id);

-- Cria perfil automaticamente ao criar usuário
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO profiles (id, full_name)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email));
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- ============================================================
-- LEADS
-- ============================================================
CREATE TABLE leads (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome            TEXT NOT NULL,
  sobrenome       TEXT,
  profissao       TEXT,
  cidade          TEXT,
  estado          TEXT,
  pais            TEXT DEFAULT 'Brasil',
  instagram       TEXT,
  site            TEXT,
  email           TEXT,
  telefone        TEXT,
  stage           lead_stage NOT NULL DEFAULT 'lead',
  responsavel_id  UUID REFERENCES profiles(id) ON DELETE SET NULL,
  arquivado       BOOLEAN NOT NULL DEFAULT FALSE,
  motivo_perda    TEXT,
  ordem           INTEGER NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Garante motivo obrigatório ao arquivar
  CONSTRAINT motivo_perda_required CHECK (
    arquivado = FALSE OR (arquivado = TRUE AND motivo_perda IS NOT NULL AND motivo_perda <> '')
  )
);

CREATE INDEX idx_leads_stage         ON leads(stage) WHERE arquivado = FALSE;
CREATE INDEX idx_leads_responsavel   ON leads(responsavel_id);
CREATE INDEX idx_leads_cidade        ON leads(cidade);
CREATE INDEX idx_leads_profissao     ON leads(profissao);
CREATE INDEX idx_leads_arquivado     ON leads(arquivado);

ALTER TABLE leads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated lê leads" ON leads
  FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "Authenticated insere leads" ON leads
  FOR INSERT WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Authenticated atualiza leads" ON leads
  FOR UPDATE USING (auth.role() = 'authenticated');

-- Atualiza updated_at automaticamente
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

CREATE TRIGGER leads_updated_at
  BEFORE UPDATE ON leads
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================
-- CONTATOS DO LEAD
-- ============================================================
CREATE TABLE lead_contacts (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id     UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  nome        TEXT NOT NULL,
  telefone    TEXT,
  cargo       contact_role NOT NULL DEFAULT 'outro',
  observacao  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_lead_contacts_lead ON lead_contacts(lead_id);

ALTER TABLE lead_contacts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated acessa contatos" ON lead_contacts
  FOR ALL USING (auth.role() = 'authenticated');

-- ============================================================
-- ANOTAÇÕES INTERNAS
-- ============================================================
CREATE TABLE lead_notes (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id     UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  conteudo    TEXT NOT NULL,
  autor_id    UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_lead_notes_lead ON lead_notes(lead_id);

ALTER TABLE lead_notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated acessa anotações" ON lead_notes
  FOR ALL USING (auth.role() = 'authenticated');

-- ============================================================
-- TAREFAS
-- ============================================================
CREATE TABLE lead_tasks (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id         UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  titulo          TEXT NOT NULL,
  descricao       TEXT,
  responsavel_id  UUID REFERENCES profiles(id) ON DELETE SET NULL,
  data_limite     TIMESTAMPTZ,
  lembrete_em     TIMESTAMPTZ,
  concluida       BOOLEAN NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_lead_tasks_lead          ON lead_tasks(lead_id);
CREATE INDEX idx_lead_tasks_responsavel   ON lead_tasks(responsavel_id);
CREATE INDEX idx_lead_tasks_data_limite   ON lead_tasks(data_limite) WHERE concluida = FALSE;

ALTER TABLE lead_tasks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated acessa tarefas" ON lead_tasks
  FOR ALL USING (auth.role() = 'authenticated');

CREATE TRIGGER lead_tasks_updated_at
  BEFORE UPDATE ON lead_tasks
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================
-- HISTÓRICO DE RESPONSÁVEL
-- ============================================================
CREATE TABLE lead_responsible_history (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id                   UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  responsavel_anterior_id   UUID REFERENCES profiles(id) ON DELETE SET NULL,
  novo_responsavel_id       UUID REFERENCES profiles(id) ON DELETE SET NULL,
  trocado_por_id            UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_lead_responsible_history_lead ON lead_responsible_history(lead_id);

ALTER TABLE lead_responsible_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated acessa histórico" ON lead_responsible_history
  FOR ALL USING (auth.role() = 'authenticated');

-- Registra automaticamente ao mudar responsável
CREATE OR REPLACE FUNCTION log_responsible_change()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF OLD.responsavel_id IS DISTINCT FROM NEW.responsavel_id THEN
    INSERT INTO lead_responsible_history (
      lead_id, responsavel_anterior_id, novo_responsavel_id, trocado_por_id
    ) VALUES (
      NEW.id, OLD.responsavel_id, NEW.responsavel_id, auth.uid()
    );
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER leads_responsible_change
  AFTER UPDATE ON leads
  FOR EACH ROW EXECUTE FUNCTION log_responsible_change();

-- ============================================================
-- NEGOCIAÇÃO (campos adicionais na etapa negociacao)
-- ============================================================
CREATE TABLE lead_negotiation (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id           UUID NOT NULL UNIQUE REFERENCES leads(id) ON DELETE CASCADE,
  valor_proposta    NUMERIC(12,2),
  modelo            TEXT,
  valor_negociado   NUMERIC(12,2),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE lead_negotiation ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated acessa negociação" ON lead_negotiation
  FOR ALL USING (auth.role() = 'authenticated');

CREATE TRIGGER lead_negotiation_updated_at
  BEFORE UPDATE ON lead_negotiation
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================
-- VIEW: leads com dados completos para o Kanban
-- ============================================================
CREATE OR REPLACE VIEW leads_kanban AS
SELECT
  l.*,
  p.full_name                         AS responsavel_nome,
  p.avatar_url                        AS responsavel_avatar,
  ln.valor_proposta,
  ln.modelo,
  ln.valor_negociado,
  (SELECT COUNT(*) FROM lead_tasks t  WHERE t.lead_id = l.id AND t.concluida = FALSE)::int AS tarefas_pendentes,
  (SELECT COUNT(*) FROM lead_notes n  WHERE n.lead_id = l.id)::int AS total_notas,
  (SELECT COUNT(*) FROM lead_contacts c WHERE c.lead_id = l.id)::int AS total_contatos
FROM leads l
LEFT JOIN profiles p      ON p.id = l.responsavel_id
LEFT JOIN lead_negotiation ln ON ln.lead_id = l.id
WHERE l.arquivado = FALSE
ORDER BY l.stage, l.ordem, l.created_at;
