-- 093_units_tipo.sql
-- Tipo da unidade: 'clinica' (padrão, todas as unidades atuais) ou 'comercial'.
--
-- Por quê: base das travas da unidade comercial. Agora só a coluna e a trava de
-- transferência de lead entre tipos diferentes (rota api/leads/transfer). As
-- travas de IA, webhooks e campos personalizados do comercial (F1) também vão
-- depender deste tipo. Esta migração NÃO cria a unidade comercial.
--
-- Aditiva: ADD COLUMN com DEFAULT constante é só metadado no Postgres 11+ (não
-- reescreve a tabela); todas as unidades existentes ficam 'clinica'.
-- Aplicar em produção é [H]: o Infra aplica como supabase_admin, com
-- --single-transaction, aprovação e backup do dia; depois registra a versão '093'.
-- Sem BEGIN/COMMIT. Idempotente.
-- Reversão (só com aprovação): ALTER TABLE public.units DROP COLUMN IF EXISTS tipo;
--   (antes, conferir que nenhuma unidade é 'comercial').

SET LOCAL lock_timeout = '5s';

DO $$
BEGIN
  IF current_setting('lock_timeout') <> '5s' THEN
    RAISE EXCEPTION '093: rode com --single-transaction (lock_timeout atual: %)', current_setting('lock_timeout');
  END IF;
END $$;

ALTER TABLE public.units ADD COLUMN IF NOT EXISTS tipo text NOT NULL DEFAULT 'clinica';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'units_tipo_check' AND conrelid = 'public.units'::regclass) THEN
    ALTER TABLE public.units ADD CONSTRAINT units_tipo_check CHECK (tipo IN ('clinica', 'comercial'));
  END IF;
END $$;

COMMENT ON COLUMN public.units.tipo IS
  'clinica | comercial. Unidades comerciais (licenciamento) ficam isoladas da clínica: transferência de lead entre tipos só por admin global.';

-- Guarda: nenhuma unidade fora dos dois tipos, e as existentes continuam clínica
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.units WHERE tipo NOT IN ('clinica', 'comercial') OR tipo IS NULL) THEN
    RAISE EXCEPTION '093: unidade com tipo inválido';
  END IF;
END $$;
