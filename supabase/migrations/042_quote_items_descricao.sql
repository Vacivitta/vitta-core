-- Adiciona descrição snapshotada aos itens de orçamento
ALTER TABLE quote_items
  ADD COLUMN IF NOT EXISTS descricao_snapshot text;
