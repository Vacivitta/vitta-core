-- ============================================================
-- VITTA CORE CRM — Migration 014: Imagens de páginas nos templates
-- Cada template pode ter capa, intro, página de conteúdo e encerramento
-- ============================================================

ALTER TABLE quote_templates
  ADD COLUMN IF NOT EXISTS paginas_imagens    JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS cor_texto_conteudo TEXT  NOT NULL DEFAULT '#ffffff';

-- Estrutura do JSON paginas_imagens:
-- {
--   "capa":         "https://...",       -- 1ª página (cover)
--   "intro":        ["https://...", ...], -- 0-N páginas institucionais
--   "conteudo":     "https://...",       -- página onde os dados são sobrepostos
--   "encerramento": "https://..."        -- última página
-- }
