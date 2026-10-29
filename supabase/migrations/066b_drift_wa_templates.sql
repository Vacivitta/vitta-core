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

-- Guarda: só roda em banco NOVO (montado do zero pelas migrações). Aborta se
-- houver dados em leads ou se o registro de versões já tiver a linha de base 089
-- (banco que já passou da 089, como a produção). Não basta o registro existir:
-- a CLI do Supabase cria a tabela num banco local novo antes de aplicar as migrações.
DO $$
DECLARE ja_passou boolean := false;
BEGIN
  IF to_regclass('supabase_migrations.schema_migrations') IS NOT NULL THEN
    EXECUTE 'SELECT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version >= ''089'')'
      INTO ja_passou;
  END IF;
  IF ja_passou OR (to_regclass('public.leads') IS NOT NULL AND EXISTS (SELECT 1 FROM public.leads)) THEN
    RAISE EXCEPTION '%: só para banco novo (há dados em leads ou o registro já passou da 089)', '066b';
  END IF;
END $$;

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
