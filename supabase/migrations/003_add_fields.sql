-- ============================================================
-- VITTA CORE CRM — Migration 003: Campos complementares
-- ============================================================

-- Origem do lead (Indicação, Instagram, WhatsApp, etc.)
ALTER TABLE leads ADD COLUMN IF NOT EXISTS origem TEXT;

-- E-mail nos contatos vinculados
ALTER TABLE lead_contacts ADD COLUMN IF NOT EXISTS email TEXT;

-- Timestamp de edição em anotações (para indicador "(editado)")
ALTER TABLE lead_notes ADD COLUMN IF NOT EXISTS editado_em TIMESTAMPTZ;
