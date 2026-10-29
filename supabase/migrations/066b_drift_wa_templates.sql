-- 066b_drift_wa_templates.sql
-- Deriva (só para banco montado do zero; NÃO aplicar em produção).
--
-- A 067 cria policies em wa_templates, tabela que existe em produção mas foi criada
-- fora das migrações. Sem ela, a 067 falha num banco do zero ("relation
-- wa_templates does not exist"), is_global_admin() não é criada e a 088 cai junto.
--
-- Estrutura conforme a leitura do Infra em 29/10/2026 (colunas, NOT NULL e
-- defaults; a tabela tem 0 linhas). Em produção este arquivo fica coberto pela
-- linha de base 089 do registro de versões e nunca é aplicado.
--
-- NÃO confirmado e por isso não replicado: chave primária, FK de unit_id,
-- índices e o trigger de updated_at (função handle_wa_templates_updated_at(),
-- corpo não colhido). Pendência do PR-D.

CREATE TABLE IF NOT EXISTS public.wa_templates (
  id               uuid        NOT NULL DEFAULT gen_random_uuid(),
  unit_id          uuid        NOT NULL,
  template_name    text        NOT NULL,
  language         text        NOT NULL DEFAULT 'pt_BR',
  category         text        NOT NULL,
  status           text        NOT NULL DEFAULT 'PENDING',
  components       jsonb       NOT NULL DEFAULT '[]'::jsonb,
  meta_template_id text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

-- Em produção todas as tabelas de public têm RLS ligado (diagnóstico de 28/10)
ALTER TABLE public.wa_templates ENABLE ROW LEVEL SECURITY;
