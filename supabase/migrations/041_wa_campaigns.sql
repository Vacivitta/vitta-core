-- ── Módulo de Campanhas WhatsApp ─────────────────────────────────────────────

-- 1. Campos de consentimento na tabela leads
ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS wa_optin_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS wa_optout_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS campanha_id   UUID;  -- preenchido ao responder campanha

-- 2. Tabela de campanhas
CREATE TABLE wa_campaigns (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id             UUID        NOT NULL REFERENCES units(id) ON DELETE CASCADE,
  nome                TEXT        NOT NULL,
  template_id         UUID        REFERENCES wa_message_templates(id) ON DELETE SET NULL,
  template_nome       TEXT,                    -- snapshot do nome no momento da criação
  template_category   TEXT        NOT NULL DEFAULT 'marketing', -- marketing | utility
  status              TEXT        NOT NULL DEFAULT 'rascunho',
                                               -- rascunho | agendada | enviando | pausada | concluida | cancelada
  scheduled_at        TIMESTAMPTZ,
  started_at          TIMESTAMPTZ,
  completed_at        TIMESTAMPTZ,
  daily_limit         INT         NOT NULL DEFAULT 250,  -- limite atual da conta Meta
  total_recipients    INT         NOT NULL DEFAULT 0,
  sent_count          INT         NOT NULL DEFAULT 0,
  delivered_count     INT         NOT NULL DEFAULT 0,
  read_count          INT         NOT NULL DEFAULT 0,
  replied_count       INT         NOT NULL DEFAULT 0,
  optout_count        INT         NOT NULL DEFAULT 0,
  failed_count        INT         NOT NULL DEFAULT 0,
  estimated_cost_usd  NUMERIC(10, 4) NOT NULL DEFAULT 0,
  actual_cost_usd     NUMERIC(10, 4) NOT NULL DEFAULT 0,
  created_by          UUID        REFERENCES profiles(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_wa_campaigns_unit ON wa_campaigns (unit_id, status);

ALTER TABLE wa_campaigns ENABLE ROW LEVEL SECURITY;

CREATE POLICY "unit members can manage campaigns" ON wa_campaigns
  FOR ALL USING (
    unit_id IN (SELECT unit_id FROM profiles WHERE id = auth.uid())
  );

-- 3. Tabela de destinatários da campanha (um registro por mensagem)
CREATE TABLE wa_campaign_recipients (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id  UUID        NOT NULL REFERENCES wa_campaigns(id) ON DELETE CASCADE,
  lead_id      UUID        REFERENCES leads(id) ON DELETE SET NULL,
  phone        TEXT        NOT NULL,
  nome         TEXT,
  has_optin    BOOLEAN     NOT NULL DEFAULT false,   -- tinha opt-in no momento do envio
  in_csw       BOOLEAN     NOT NULL DEFAULT false,   -- estava na janela de 24h (utility gratuito)
  status       TEXT        NOT NULL DEFAULT 'pending',
                                                     -- pending | sent | delivered | read | replied | failed | skipped
  wa_msg_id    TEXT,                                 -- ID do Meta após envio
  cost_usd     NUMERIC(10, 6) NOT NULL DEFAULT 0,
  error_msg    TEXT,
  sent_at      TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  read_at      TIMESTAMPTZ,
  replied_at   TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_wa_camp_recip_campaign ON wa_campaign_recipients (campaign_id, status);
CREATE INDEX idx_wa_camp_recip_wa_msg   ON wa_campaign_recipients (wa_msg_id) WHERE wa_msg_id IS NOT NULL;
CREATE INDEX idx_wa_camp_recip_lead     ON wa_campaign_recipients (lead_id)   WHERE lead_id IS NOT NULL;

ALTER TABLE wa_campaign_recipients ENABLE ROW LEVEL SECURITY;

CREATE POLICY "unit members can manage campaign recipients" ON wa_campaign_recipients
  FOR ALL USING (
    campaign_id IN (
      SELECT id FROM wa_campaigns
      WHERE unit_id IN (SELECT unit_id FROM profiles WHERE id = auth.uid())
    )
  );

-- 4. Trigger: atualiza updated_at automaticamente
CREATE OR REPLACE FUNCTION touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

CREATE TRIGGER wa_campaigns_updated_at
  BEFORE UPDATE ON wa_campaigns
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
