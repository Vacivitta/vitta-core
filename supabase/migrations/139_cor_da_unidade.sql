-- 139_cor_da_unidade.sql
-- Cor de cada unidade, para a caixa de entrada e o sino de quem atende várias.
--
-- Por quê: o Atendimento e o sino passam a mostrar conversas e notificações de
-- todas as unidades vinculadas (Fase 3·1, entrega 4). Cada item leva o nome e a
-- cor da unidade, e a barra "Respondendo como" usa a mesma cor. A cor fica
-- guardada para não mudar quando uma unidade nova entra na lista.
--
-- O que faz:
--   1. units.cor: hex #RRGGBB (CHECK), NULL permitido. Unidade sem cor usa a
--      paleta do app pela posição (src/lib/unidades.ts, PALETA_UNIDADES).
--   2. Preenche as unidades sem cor com a mesma paleta, na ordem de criação.
--
-- Aplicar em produção é [H]: o Infra aplica, com aprovação e backup do dia, como
-- supabase_admin, com --single-transaction; depois registra a versão '139' e roda
-- notify pgrst, 'reload schema'. Sem BEGIN/COMMIT. Idempotente. O app de hoje
-- ignora a coluna; o app desta versão funciona sem ela preenchida.
--
-- Reversão: ALTER TABLE public.units DROP COLUMN IF EXISTS cor;

SET LOCAL lock_timeout = '5s';

DO $$
BEGIN
  IF current_setting('lock_timeout') <> '5s' THEN
    RAISE EXCEPTION '139: rode com --single-transaction (lock_timeout atual: %)', current_setting('lock_timeout');
  END IF;
  IF current_user <> 'supabase_admin' THEN
    RAISE EXCEPTION '139: rodar como supabase_admin (atual: %)', current_user;
  END IF;
END $$;

ALTER TABLE public.units ADD COLUMN IF NOT EXISTS cor text;

ALTER TABLE public.units DROP CONSTRAINT IF EXISTS units_cor_check;
ALTER TABLE public.units ADD CONSTRAINT units_cor_check CHECK (cor ~ '^#[0-9A-Fa-f]{6}$');

WITH paleta AS (
  SELECT ARRAY['#3E9849', '#2563EB', '#C87F1B', '#7C3AED', '#DB2777', '#0891B2', '#DC2626', '#4D7C0F'] AS cores
), sem_cor AS (
  SELECT u.id, row_number() OVER (ORDER BY u.criado_em, u.id) - 1 AS posicao
    FROM public.units u
   WHERE u.cor IS NULL
)
UPDATE public.units u
   SET cor = p.cores[(s.posicao % array_length(p.cores, 1)) + 1]
  FROM sem_cor s, paleta p
 WHERE u.id = s.id;
