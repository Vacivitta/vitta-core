-- 037b_drift_funnel_stages_alerta_dias.sql
-- Deriva (só para banco montado do zero; NÃO aplicar em produção).
--
-- As migrações 038 e 059 criam a view leads_kanban com fs.alerta_dias, uma coluna
-- que existia na produção na época, mas foi criada fora das migrações. Sem ela,
-- 038 e 059 falham num banco do zero ("fs.alerta_dias does not exist").
--
-- A 038 também renomeia a coluna stage_alerta_horas da view para stage_alerta_dias
-- com CREATE OR REPLACE VIEW, o que o Postgres não permite ("cannot change name of
-- view column"). Na produção a view já tinha sido refeita fora das migrações antes
-- da 038. Aqui ela é removida para a 038 criá-la de novo; a 059 e a 083/084 a
-- refazem depois, como na produção.
--
-- Hoje a coluna NÃO existe em produção (leitura do Infra em 29/10/2026); a view
-- usa fs.alerta_horas desde a 083/084. Por isso a 092 remove a coluna de novo.
-- Em produção este arquivo fica coberto pela linha de base 089 do registro de
-- versões e nunca é aplicado.

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
    RAISE EXCEPTION '%: só para banco novo (há dados em leads ou o registro já passou da 089)', '037b';
  END IF;
END $$;

ALTER TABLE public.funnel_stages ADD COLUMN IF NOT EXISTS alerta_dias integer;

DROP VIEW IF EXISTS public.leads_kanban;
