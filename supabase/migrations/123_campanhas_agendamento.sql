-- 123_campanhas_agendamento.sql
-- Campanhas de WhatsApp que andam sozinhas e respeitam o limite diário da Meta.
--
-- Por quê: campanha agendada nunca era disparada (não havia job), daily_limit era
-- gravado e ignorado, e "Disparar" enviava um lote de 10 por clique. Agora o botão
-- só marca a campanha como 'enviando' e o job process-wa-campaigns (pg_cron, a cada
-- minuto, criado à mão: ver docs/migracao-vps/runbook.md) continua em lotes. Cron e
-- clique podem rodar ao mesmo tempo; a reserva abaixo impede envio em dobro.
--
-- O que faz:
--   1. wa_campaigns.motivo_pausa: por que a campanha está pausada. Só
--      'limite_diario' é retomada sozinha, em retomar_em (próxima meia-noite de
--      São Paulo). 'manual', 'erro_meta' (429, taxa de erro, template), 'autorizacao'
--      (token/número) e 'optout' (taxa de opt-out, webhook) esperam alguém retomar.
--   2. wa_campaign_recipients.reservado_em: o destinatário foi pego por um lote e
--      está sendo enviado. Reserva com mais de 10 min sem envio é considerada
--      abandonada (o processo caiu) e volta a ser pega.
--   3. reservar_destinatarios_campanha(campanha, limite): reserva até `limite`
--      pendentes da campanha com FOR UPDATE SKIP LOCKED, só se ela está 'enviando',
--      e nunca passa do limite diário da unidade: daily_limit da campanha menos o
--      que a unidade (todas as campanhas) já enviou no dia de São Paulo ou tem
--      reservado. Serializa por unidade com advisory lock, para que dois lotes da
--      mesma unidade não leiam a mesma contagem. Só service_role executa.
--   4. Índices para contar envios do dia e reservas ativas.
--
-- Não mexe em dados. Campanhas 'agendada' criadas antes desta versão têm
-- scheduled_at gravado sem fuso (lido como UTC, 3 h antes do horário digitado):
-- assim que o job existir elas disparam nesse horário adiantado, ou já, se ele
-- passou. Conferir antes de criar o job (consulta no runbook).
--
-- Aplicar em produção é [H]: o Infra aplica, com aprovação e backup do dia, como
-- supabase_admin, com --single-transaction; depois registra a versão '123' e roda
-- notify pgrst, 'reload schema'. Sem BEGIN/COMMIT. Idempotente.
--
-- Reversão (o app desta versão para de enviar campanhas sem a função):
--   DROP FUNCTION IF EXISTS public.reservar_destinatarios_campanha(uuid, int);
--   DROP INDEX IF EXISTS public.idx_wa_camp_recip_sent_at, public.idx_wa_camp_recip_reservado;
--   ALTER TABLE public.wa_campaign_recipients DROP COLUMN IF EXISTS reservado_em;
--   ALTER TABLE public.wa_campaigns DROP COLUMN IF EXISTS motivo_pausa, DROP COLUMN IF EXISTS retomar_em;

SET LOCAL lock_timeout = '5s';

DO $$
BEGIN
  IF current_setting('lock_timeout') <> '5s' THEN
    RAISE EXCEPTION '123: rode com --single-transaction (lock_timeout atual: %)', current_setting('lock_timeout');
  END IF;
  IF current_user <> 'supabase_admin' THEN
    RAISE EXCEPTION '123: rodar como supabase_admin (atual: %)', current_user;
  END IF;
END $$;

ALTER TABLE public.wa_campaigns
  ADD COLUMN IF NOT EXISTS motivo_pausa text,
  ADD COLUMN IF NOT EXISTS retomar_em timestamptz;

ALTER TABLE public.wa_campaigns DROP CONSTRAINT IF EXISTS wa_campaigns_motivo_pausa_check;
ALTER TABLE public.wa_campaigns ADD CONSTRAINT wa_campaigns_motivo_pausa_check
  CHECK (motivo_pausa IN ('manual', 'limite_diario', 'erro_meta', 'autorizacao', 'optout'));

ALTER TABLE public.wa_campaign_recipients
  ADD COLUMN IF NOT EXISTS reservado_em timestamptz;

CREATE INDEX IF NOT EXISTS idx_wa_camp_recip_sent_at
  ON public.wa_campaign_recipients (sent_at)
  WHERE sent_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_wa_camp_recip_reservado
  ON public.wa_campaign_recipients (campaign_id, reservado_em)
  WHERE status = 'pending' AND reservado_em IS NOT NULL;

-- SECURITY INVOKER: só o service_role chama, e ele já ignora o RLS. Assim, se um
-- restore devolver o EXECUTE a authenticated, a função não vira atalho entre unidades.
CREATE OR REPLACE FUNCTION public.reservar_destinatarios_campanha(p_campaign uuid, p_limite int)
 RETURNS SETOF public.wa_campaign_recipients
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE
  c record;
  inicio_dia timestamptz := date_trunc('day', now() AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'America/Sao_Paulo';
  usados int;
  vagas int;
BEGIN
  IF coalesce(auth.role(), '') IN ('anon', 'authenticated') THEN
    RAISE EXCEPTION 'reservar_destinatarios_campanha: só o servidor envia campanhas' USING ERRCODE = '42501';
  END IF;
  IF p_limite IS NULL OR p_limite < 1 THEN
    RETURN;
  END IF;

  SELECT id, unit_id, status, daily_limit INTO c FROM public.wa_campaigns WHERE id = p_campaign;
  IF NOT FOUND OR c.status <> 'enviando' THEN
    RETURN;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('wa_campanha_unidade:' || c.unit_id::text, 0));

  SELECT count(*) INTO usados
    FROM public.wa_campaign_recipients r
    JOIN public.wa_campaigns w ON w.id = r.campaign_id
   WHERE w.unit_id = c.unit_id
     AND (r.sent_at >= inicio_dia
          OR (r.status = 'pending' AND r.reservado_em > now() - interval '10 minutes'));

  vagas := least(p_limite, c.daily_limit - usados);
  IF vagas < 1 THEN
    RETURN;
  END IF;

  RETURN QUERY
  UPDATE public.wa_campaign_recipients r
     SET reservado_em = now()
   WHERE r.id IN (
     SELECT p.id FROM public.wa_campaign_recipients p
      WHERE p.campaign_id = p_campaign
        AND p.status = 'pending'
        AND (p.reservado_em IS NULL OR p.reservado_em <= now() - interval '10 minutes')
      ORDER BY p.created_at, p.id
      LIMIT vagas
      FOR UPDATE SKIP LOCKED)
  RETURNING r.*;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.reservar_destinatarios_campanha(uuid, int) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.reservar_destinatarios_campanha(uuid, int) TO service_role;
