-- ── Rastreamento de custo por mensagem (modelo Meta pós-julho 2025) ────────────
-- Substitui a lógica de "1.000 conversas gratuitas" pelo modelo real:
-- cada template entregue é cobrado individualmente pela Meta.
-- Populado pelo webhook no evento status=sent com pricing.

CREATE TABLE wa_message_costs (
  id          UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id     UUID           NOT NULL REFERENCES units(id) ON DELETE CASCADE,
  wa_msg_id   TEXT           NOT NULL,     -- Meta message ID (wa_message_id)
  category    TEXT           NOT NULL,     -- marketing | utility | authentication | service
  billable    BOOLEAN        NOT NULL DEFAULT false,
  cost_usd    NUMERIC(10, 6) NOT NULL DEFAULT 0,
  month_year  TEXT           NOT NULL,     -- 'YYYY-MM'
  created_at  TIMESTAMPTZ    NOT NULL DEFAULT now(),

  UNIQUE (unit_id, wa_msg_id)
);

CREATE INDEX idx_wa_msg_costs_unit_month ON wa_message_costs (unit_id, month_year);

ALTER TABLE wa_message_costs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "unit members can view message costs" ON wa_message_costs
  FOR SELECT USING (
    unit_id IN (SELECT unit_id FROM profiles WHERE id = auth.uid())
  );
