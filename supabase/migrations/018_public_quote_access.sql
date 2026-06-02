-- ============================================================
-- VITTA CORE CRM — Migration 018: Acesso público a orçamentos via token
-- Paciente acessa o orçamento pelo link sem precisar autenticar
-- ============================================================

-- quotes: leitura pública (para /orcamento/ver/[token])
DROP POLICY IF EXISTS "quotes_public_read" ON quotes;
CREATE POLICY "quotes_public_read" ON quotes
  FOR SELECT USING (true);

-- quotes: paciente pode atualizar status/motivo_recusa via token
-- O token serve como credencial; validado no Route Handler
DROP POLICY IF EXISTS "quotes_public_update_status" ON quotes;
CREATE POLICY "quotes_public_update_status" ON quotes
  FOR UPDATE USING (true) WITH CHECK (true);

-- quote_items: leitura pública (para montar o orçamento no link)
DROP POLICY IF EXISTS "quote_items_public_read" ON quote_items;
CREATE POLICY "quote_items_public_read" ON quote_items
  FOR SELECT USING (true);
