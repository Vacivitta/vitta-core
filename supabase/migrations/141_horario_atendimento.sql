-- 141_horario_atendimento.sql
-- Horário de atendimento por unidade, com fuso, feriados e exceção por fila ou
-- funil (Fase 3·1, entrega 7). Nada de horário fixo no código.
--
-- Por quê: os fluxos (3·3) vão precisar de "dentro do horário", "esperar o
-- horário abrir", mensagem de fora do horário e SLA em horas de atendimento
-- (decisão de 05/11/2026). Hoje tudo é São Paulo e não há horário em lugar
-- nenhum. Esta migração só guarda e responde; ninguém consome ainda.
--
-- O que faz:
--   1. units.fuso (padrão America/Sao_Paulo), recusado se o Postgres não o
--      conhece (22023). Só o admin da marca altera units (063).
--   2. horarios_atendimento: um por unidade (escopo 'unidade') e exceções por
--      fila (escopo 'fila', fila_id) ou por funil (escopo 'funil', funnel_id),
--      sempre da mesma unidade (23514). Excluir a fila leva a exceção junto; excluir o funil
--      com exceção falha (23503), como os outros vínculos a funis (135).
--   3. horario_faixas: faixas por dia da semana (0 = domingo), várias por dia,
--      início incluído e fim excluído (8h–12h fecha às 12h00).
--   4. feriados: unit_id NULL é feriado nacional, mantido pela marca; a unidade
--      acrescenta os seus e pode reabrir um nacional com horário especial (a
--      linha da unidade vence a nacional na mesma data). Fechado o dia todo ou
--      com uma faixa especial. Valem para a unidade inteira, filas e funis.
--   5. dentro_do_horario(unidade, instante, fila, funil) e
--      proxima_abertura(...): a fila vence o funil, que vence a unidade; sem
--      horário configurado, a unidade está sempre aberta (como hoje). A próxima
--      abertura olha até 14 dias à frente (NULL se não houver).
--   6. RLS: quem está na unidade lê; gestor da unidade (is_gestor) e admin da
--      marca alteram; feriado nacional só o admin da marca altera, e todos leem.
--      As funções são SECURITY INVOKER (leem sob o RLS de quem chama) e não
--      executam para anon. search_path public, e não vazio: as regras de acesso chamam
--      is_global_admin() (067), que não fixa o próprio search_path e não acharia
--      profiles.
--
-- Aplicar em produção é [H]: o Infra aplica, com aprovação e backup do dia, como
-- supabase_admin, com --single-transaction; depois registra a versão '141' e roda
-- notify pgrst, 'reload schema'. Sem BEGIN/COMMIT. Idempotente. Antes do deploy
-- do app desta versão (a tela lê as tabelas novas); o app de hoje a ignora.
--
-- Reversão:
--   DROP FUNCTION IF EXISTS public.proxima_abertura(uuid, timestamptz, uuid, uuid),
--     public.dentro_do_horario(uuid, timestamptz, uuid, uuid), public.horario_aplicavel(uuid, uuid, uuid);
--   DROP TABLE IF EXISTS public.horario_faixas, public.horarios_atendimento, public.feriados;
--   DROP TRIGGER IF EXISTS trg_units_fuso ON public.units; DROP FUNCTION IF EXISTS public.fn_valida_fuso();
--   DROP FUNCTION IF EXISTS public.fn_horario_mesma_unidade();
--   ALTER TABLE public.units DROP COLUMN IF EXISTS fuso;

SET LOCAL lock_timeout = '5s';

DO $$
BEGIN
  IF current_setting('lock_timeout') <> '5s' THEN
    RAISE EXCEPTION '141: rode com --single-transaction (lock_timeout atual: %)', current_setting('lock_timeout');
  END IF;
  IF current_user <> 'supabase_admin' THEN
    RAISE EXCEPTION '141: rodar como supabase_admin (atual: %)', current_user;
  END IF;
END $$;

-- ── 1. Fuso da unidade ───────────────────────────────────────────────────────
ALTER TABLE public.units ADD COLUMN IF NOT EXISTS fuso text NOT NULL DEFAULT 'America/Sao_Paulo';

CREATE OR REPLACE FUNCTION public.fn_valida_fuso()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO public
AS $function$
BEGIN
  -- AT TIME ZONE com nome desconhecido falha com 22023 (invalid_parameter_value)
  PERFORM now() AT TIME ZONE NEW.fuso;
  RETURN NEW;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.fn_valida_fuso() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_units_fuso ON public.units;
CREATE TRIGGER trg_units_fuso BEFORE INSERT OR UPDATE OF fuso ON public.units
  FOR EACH ROW EXECUTE FUNCTION public.fn_valida_fuso();

-- ── 2. Horários e faixas ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.horarios_atendimento (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id    uuid        NOT NULL REFERENCES public.units (id) ON DELETE CASCADE,
  escopo     text        NOT NULL CHECK (escopo IN ('unidade', 'fila', 'funil')),
  fila_id    uuid        REFERENCES public.wa_queues (id) ON DELETE CASCADE,
  funnel_id  uuid        REFERENCES public.funnels (id) ON DELETE RESTRICT,
  ativo      boolean     NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT horarios_atendimento_alvo_check CHECK (
       (escopo = 'unidade' AND fila_id IS NULL AND funnel_id IS NULL)
    OR (escopo = 'fila'    AND fila_id IS NOT NULL AND funnel_id IS NULL)
    OR (escopo = 'funil'   AND funnel_id IS NOT NULL AND fila_id IS NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_horarios_unidade ON public.horarios_atendimento (unit_id) WHERE escopo = 'unidade';
CREATE UNIQUE INDEX IF NOT EXISTS uq_horarios_fila    ON public.horarios_atendimento (fila_id) WHERE escopo = 'fila';
CREATE UNIQUE INDEX IF NOT EXISTS uq_horarios_funil   ON public.horarios_atendimento (funnel_id) WHERE escopo = 'funil';

CREATE OR REPLACE FUNCTION public.fn_horario_mesma_unidade()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO public
AS $function$
BEGIN
  IF NEW.fila_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.wa_queues q WHERE q.id = NEW.fila_id AND q.unit_id = NEW.unit_id) THEN
    RAISE EXCEPTION 'A fila do horário é de outra unidade' USING ERRCODE = '23514';
  END IF;
  IF NEW.funnel_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.funnels f WHERE f.id = NEW.funnel_id AND f.unit_id = NEW.unit_id) THEN
    RAISE EXCEPTION 'O funil do horário é de outra unidade' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.fn_horario_mesma_unidade() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_horario_mesma_unidade ON public.horarios_atendimento;
CREATE TRIGGER trg_horario_mesma_unidade BEFORE INSERT OR UPDATE ON public.horarios_atendimento
  FOR EACH ROW EXECUTE FUNCTION public.fn_horario_mesma_unidade();

CREATE TABLE IF NOT EXISTS public.horario_faixas (
  id          uuid     PRIMARY KEY DEFAULT gen_random_uuid(),
  horario_id  uuid     NOT NULL REFERENCES public.horarios_atendimento (id) ON DELETE CASCADE,
  dia_semana  smallint NOT NULL CHECK (dia_semana BETWEEN 0 AND 6),
  inicio      time     NOT NULL,
  fim         time     NOT NULL,
  CONSTRAINT horario_faixas_ordem_check CHECK (inicio < fim)
);

CREATE INDEX IF NOT EXISTS idx_horario_faixas_dia ON public.horario_faixas (horario_id, dia_semana);

-- ── 3. Feriados ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.feriados (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id    uuid        REFERENCES public.units (id) ON DELETE CASCADE,
  data       date        NOT NULL,
  nome       text        NOT NULL,
  fechado    boolean     NOT NULL DEFAULT true,
  inicio     time,
  fim        time,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT feriados_horario_check CHECK (
       (fechado AND inicio IS NULL AND fim IS NULL)
    OR (NOT fechado AND inicio IS NOT NULL AND fim IS NOT NULL AND inicio < fim)),
  CONSTRAINT feriados_unidade_data_key UNIQUE NULLS NOT DISTINCT (unit_id, data)
);

-- ── 4. RLS ───────────────────────────────────────────────────────────────────
ALTER TABLE public.horarios_atendimento ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.horario_faixas       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.feriados             ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.horarios_atendimento, public.horario_faixas, public.feriados FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.horarios_atendimento, public.horario_faixas, public.feriados TO authenticated;
GRANT ALL ON public.horarios_atendimento, public.horario_faixas, public.feriados TO service_role;

DROP POLICY IF EXISTS "horarios_ler" ON public.horarios_atendimento;
CREATE POLICY "horarios_ler" ON public.horarios_atendimento AS PERMISSIVE FOR SELECT TO authenticated
  USING ((SELECT is_global_admin())
         OR unit_id IN (SELECT uu.unit_id FROM public.user_units uu WHERE uu.user_id = (SELECT auth.uid())));

DROP POLICY IF EXISTS "horarios_gestor" ON public.horarios_atendimento;
CREATE POLICY "horarios_gestor" ON public.horarios_atendimento AS PERMISSIVE FOR ALL TO authenticated
  USING ((SELECT is_global_admin())
         OR ((SELECT is_gestor()) AND unit_id IN (SELECT uu.unit_id FROM public.user_units uu WHERE uu.user_id = (SELECT auth.uid()))))
  WITH CHECK ((SELECT is_global_admin())
         OR ((SELECT is_gestor()) AND unit_id IN (SELECT uu.unit_id FROM public.user_units uu WHERE uu.user_id = (SELECT auth.uid()))));

DROP POLICY IF EXISTS "faixas_ler" ON public.horario_faixas;
CREATE POLICY "faixas_ler" ON public.horario_faixas AS PERMISSIVE FOR SELECT TO authenticated
  USING (horario_id IN (SELECT h.id FROM public.horarios_atendimento h));

DROP POLICY IF EXISTS "faixas_gestor" ON public.horario_faixas;
CREATE POLICY "faixas_gestor" ON public.horario_faixas AS PERMISSIVE FOR ALL TO authenticated
  USING (horario_id IN (
    SELECT h.id FROM public.horarios_atendimento h
     WHERE (SELECT is_global_admin())
        OR ((SELECT is_gestor()) AND h.unit_id IN (SELECT uu.unit_id FROM public.user_units uu WHERE uu.user_id = (SELECT auth.uid())))))
  WITH CHECK (horario_id IN (
    SELECT h.id FROM public.horarios_atendimento h
     WHERE (SELECT is_global_admin())
        OR ((SELECT is_gestor()) AND h.unit_id IN (SELECT uu.unit_id FROM public.user_units uu WHERE uu.user_id = (SELECT auth.uid())))));

DROP POLICY IF EXISTS "feriados_ler" ON public.feriados;
CREATE POLICY "feriados_ler" ON public.feriados AS PERMISSIVE FOR SELECT TO authenticated
  USING (unit_id IS NULL
         OR (SELECT is_global_admin())
         OR unit_id IN (SELECT uu.unit_id FROM public.user_units uu WHERE uu.user_id = (SELECT auth.uid())));

DROP POLICY IF EXISTS "feriados_alterar" ON public.feriados;
CREATE POLICY "feriados_alterar" ON public.feriados AS PERMISSIVE FOR ALL TO authenticated
  USING ((SELECT is_global_admin())
         OR (unit_id IS NOT NULL AND (SELECT is_gestor())
             AND unit_id IN (SELECT uu.unit_id FROM public.user_units uu WHERE uu.user_id = (SELECT auth.uid()))))
  WITH CHECK ((SELECT is_global_admin())
         OR (unit_id IS NOT NULL AND (SELECT is_gestor())
             AND unit_id IN (SELECT uu.unit_id FROM public.user_units uu WHERE uu.user_id = (SELECT auth.uid()))));

-- ── 5. Consultas ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.horario_aplicavel(p_unit uuid, p_fila uuid, p_funil uuid)
 RETURNS uuid
 LANGUAGE sql
 STABLE
 SET search_path TO public
AS $function$
  SELECT h.id FROM public.horarios_atendimento h
   WHERE h.unit_id = p_unit AND h.ativo
     AND (h.escopo = 'unidade'
          OR (h.escopo = 'fila' AND h.fila_id = p_fila)
          OR (h.escopo = 'funil' AND h.funnel_id = p_funil))
   ORDER BY CASE h.escopo WHEN 'fila' THEN 0 WHEN 'funil' THEN 1 ELSE 2 END
   LIMIT 1
$function$;

CREATE OR REPLACE FUNCTION public.dentro_do_horario(
  p_unit uuid, p_instante timestamptz, p_fila uuid DEFAULT NULL, p_funil uuid DEFAULT NULL)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE
 SET search_path TO public
AS $function$
DECLARE
  v_horario uuid := public.horario_aplicavel(p_unit, p_fila, p_funil);
  v_local   timestamp;
  v_feriado record;
BEGIN
  IF v_horario IS NULL THEN
    RETURN true;
  END IF;
  SELECT p_instante AT TIME ZONE u.fuso INTO v_local FROM public.units u WHERE u.id = p_unit;

  SELECT f.fechado, f.inicio, f.fim INTO v_feriado
    FROM public.feriados f
   WHERE f.data = v_local::date AND (f.unit_id = p_unit OR f.unit_id IS NULL)
   ORDER BY f.unit_id NULLS LAST
   LIMIT 1;
  IF FOUND THEN
    RETURN NOT v_feriado.fechado AND v_local::time >= v_feriado.inicio AND v_local::time < v_feriado.fim;
  END IF;

  RETURN EXISTS (
    SELECT 1 FROM public.horario_faixas x
     WHERE x.horario_id = v_horario
       AND x.dia_semana = extract(dow FROM v_local)
       AND v_local::time >= x.inicio AND v_local::time < x.fim);
END;
$function$;

CREATE OR REPLACE FUNCTION public.proxima_abertura(
  p_unit uuid, p_instante timestamptz, p_fila uuid DEFAULT NULL, p_funil uuid DEFAULT NULL)
 RETURNS timestamptz
 LANGUAGE plpgsql
 STABLE
 SET search_path TO public
AS $function$
DECLARE
  v_horario uuid;
  v_fuso    text;
  v_local   timestamp;
  v_dia     date;
  v_feriado record;
  v_inicio  time;
BEGIN
  IF public.dentro_do_horario(p_unit, p_instante, p_fila, p_funil) THEN
    RETURN p_instante;
  END IF;
  v_horario := public.horario_aplicavel(p_unit, p_fila, p_funil);
  SELECT u.fuso INTO v_fuso FROM public.units u WHERE u.id = p_unit;
  v_local := p_instante AT TIME ZONE v_fuso;

  FOR i IN 0..14 LOOP
    v_dia := v_local::date + i;

    SELECT f.fechado, f.inicio INTO v_feriado
      FROM public.feriados f
     WHERE f.data = v_dia AND (f.unit_id = p_unit OR f.unit_id IS NULL)
     ORDER BY f.unit_id NULLS LAST
     LIMIT 1;
    IF FOUND THEN
      IF NOT v_feriado.fechado AND (i > 0 OR v_feriado.inicio > v_local::time) THEN
        RETURN (v_dia + v_feriado.inicio) AT TIME ZONE v_fuso;
      END IF;
      CONTINUE;
    END IF;

    SELECT min(x.inicio) INTO v_inicio
      FROM public.horario_faixas x
     WHERE x.horario_id = v_horario
       AND x.dia_semana = extract(dow FROM v_dia)
       AND (i > 0 OR x.inicio > v_local::time);
    IF v_inicio IS NOT NULL THEN
      RETURN (v_dia + v_inicio) AT TIME ZONE v_fuso;
    END IF;
  END LOOP;
  RETURN NULL;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.horario_aplicavel(uuid, uuid, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.dentro_do_horario(uuid, timestamptz, uuid, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.proxima_abertura(uuid, timestamptz, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.horario_aplicavel(uuid, uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.dentro_do_horario(uuid, timestamptz, uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.proxima_abertura(uuid, timestamptz, uuid, uuid) TO authenticated, service_role;
