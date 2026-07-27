-- Tabela de metas de vendas (por unidade, mensal)
CREATE TABLE sales_goals (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id    UUID NOT NULL REFERENCES units(id),
  user_id    UUID REFERENCES profiles(id),
  month      DATE NOT NULL,
  target     NUMERIC(12,2) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(unit_id, user_id, month)
);

ALTER TABLE sales_goals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "sales_goals_unit" ON sales_goals
  FOR ALL USING (unit_id IN (
    SELECT unit_id FROM profiles WHERE id = auth.uid()
  ));
