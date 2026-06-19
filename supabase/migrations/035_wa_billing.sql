-- ── Rastreamento de conversas cobráveis do WhatsApp (Meta Cloud API) ──────────
-- O webhook captura conversation.id + pricing de cada status update.
-- Uma conversa Meta dura 24h; múltiplas mensagens nessa janela = 1 cobrança.

CREATE TABLE wa_billing_conversations (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id       UUID        REFERENCES units(id) ON DELETE CASCADE,
  meta_conv_id  TEXT        NOT NULL,
  category      TEXT        NOT NULL,  -- marketing | utility | authentication | service
  billable      BOOLEAN     NOT NULL DEFAULT true,
  origin_type   TEXT,                  -- business_initiated | user_initiated | referral_conversion
  month_year    TEXT        NOT NULL,  -- ex: "2026-06"
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (unit_id, meta_conv_id)
);

CREATE INDEX idx_wa_billing_unit_month ON wa_billing_conversations (unit_id, month_year);

ALTER TABLE wa_billing_conversations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated acessa billing" ON wa_billing_conversations
  FOR ALL USING (auth.role() = 'authenticated');
