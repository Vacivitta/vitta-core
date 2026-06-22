-- ── Migration 043: WhatsApp API Config ────────────────────────────────────────
-- Armazena credenciais da API WhatsApp (Meta) por unidade,
-- permitindo configuração direta no CRM sem precisar de env vars.

CREATE TABLE IF NOT EXISTS wa_config (
  id               uuid        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  unit_id          uuid        NOT NULL UNIQUE REFERENCES units(id) ON DELETE CASCADE,
  phone_number_id  text,                   -- Phone Number ID do Meta
  access_token     text,                   -- Token de acesso permanente
  verify_token     text,                   -- Token de verificação do webhook
  waba_id          text,                   -- WhatsApp Business Account ID
  display_phone    text,                   -- Número formatado para exibição
  is_active        boolean     NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE wa_config ENABLE ROW LEVEL SECURITY;

-- Apenas membros da mesma unidade podem ver/editar
CREATE POLICY "unit members" ON wa_config FOR ALL USING (
  unit_id IN (SELECT unit_id FROM profiles WHERE id = auth.uid())
);

-- Trigger para atualizar updated_at
CREATE OR REPLACE FUNCTION update_wa_config_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER wa_config_updated_at
  BEFORE UPDATE ON wa_config
  FOR EACH ROW EXECUTE FUNCTION update_wa_config_updated_at();
