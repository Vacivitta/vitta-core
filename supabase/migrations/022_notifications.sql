-- ============================================================
-- VITTA CORE CRM — Migration 022: Notificações in-app
-- Alerta o operador quando um paciente aceita ou recusa orçamento
-- ============================================================

CREATE TABLE notifications (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id   UUID NOT NULL REFERENCES units(id),
  user_id   UUID REFERENCES profiles(id) ON DELETE CASCADE,
  type      TEXT NOT NULL,
  title     TEXT NOT NULL,
  body      TEXT,
  quote_id  UUID REFERENCES quotes(id)  ON DELETE CASCADE,
  lead_id   UUID REFERENCES leads(id)   ON DELETE CASCADE,
  lida      BOOLEAN NOT NULL DEFAULT FALSE,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_notifications_user  ON notifications(user_id,  lida) WHERE lida = FALSE;
CREATE INDEX idx_notifications_unit  ON notifications(unit_id,  lida) WHERE lida = FALSE AND user_id IS NULL;
CREATE INDEX idx_notifications_quote ON notifications(quote_id);

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

-- Leitura: notificações próprias ou de toda a unidade (user_id IS NULL)
CREATE POLICY "notifications_select" ON notifications FOR SELECT
  USING (
    user_id = auth.uid()
    OR (user_id IS NULL AND unit_id IN (
      SELECT unit_id FROM profiles WHERE id = auth.uid()
    ))
  );

-- Marcar como lida
CREATE POLICY "notifications_update" ON notifications FOR UPDATE
  USING (
    user_id = auth.uid()
    OR (user_id IS NULL AND unit_id IN (
      SELECT unit_id FROM profiles WHERE id = auth.uid()
    ))
  );

-- Função SECURITY DEFINER: insere notificação sem precisar de service-role
CREATE OR REPLACE FUNCTION create_quote_notification(
  p_unit_id  UUID,
  p_user_id  UUID,
  p_type     TEXT,
  p_title    TEXT,
  p_body     TEXT,
  p_quote_id UUID,
  p_lead_id  UUID
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO notifications (unit_id, user_id, type, title, body, quote_id, lead_id)
  VALUES (p_unit_id, p_user_id, p_type, p_title, p_body, p_quote_id, p_lead_id);
END;
$$;

GRANT EXECUTE ON FUNCTION create_quote_notification(UUID,UUID,TEXT,TEXT,TEXT,UUID,UUID) TO anon, authenticated;

-- Habilitar realtime
ALTER PUBLICATION supabase_realtime ADD TABLE notifications;
