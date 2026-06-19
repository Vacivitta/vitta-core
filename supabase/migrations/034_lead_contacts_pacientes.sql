-- Adiciona campos de paciente (filho/dependente) à tabela lead_contacts.
-- Colunas antigas (telefone, email, cargo) permanecem para compatibilidade.

ALTER TABLE lead_contacts
  ADD COLUMN IF NOT EXISTS data_nascimento date,
  ADD COLUMN IF NOT EXISTS relacao         text NOT NULL DEFAULT 'outro'
    CHECK (relacao IN ('filho','filha','dependente','outro'));
