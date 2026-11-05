-- 137_reserva_envios.sql
-- Mensagens agendadas e automações por tempo reservam o que vão enviar antes de
-- enviar, para duas execuções simultâneas nunca mandarem a mesma mensagem.
--
-- Por quê:
--   - /api/whatsapp/process-scheduled (cron a cada minuto) lia as mensagens
--     'pending' vencidas e só marcava 'sent' depois de chamar a Meta. Um lote de
--     50 com a Meta lenta (até 15 s cada) passa de um minuto, e a execução
--     seguinte lia as mesmas mensagens e mandava de novo.
--   - /api/whatsapp/process-timed-automations conferia wa_timed_automation_log e
--     só gravava a linha depois de agir, sem UNIQUE. Duas execuções juntas
--     (cron de hora em hora e uma chamada manual, ou uma execução que passa da
--     hora) mandavam o mesmo modelo duas vezes para o mesmo contato.
--   Em 05/11/2026 a produção não tinha duplicata registrada (1 agendada enviada,
--   0 disparos por tempo): a falha é latente, e cresce com o uso.
--
-- O que faz:
--   1. wa_scheduled_messages.reservado_em e reservar_mensagens_agendadas(limite):
--      reserva até `limite` mensagens 'pending' vencidas com FOR UPDATE SKIP
--      LOCKED, como reservar_destinatarios_campanha (123). Reserva com mais de
--      10 min sem envio é considerada abandonada (o processo caiu) e volta a ser
--      pega. O status continua 'pending' até o envio: a tela e o cancelamento
--      não mudam.
--   2. wa_timed_automation_log.alvo_chave e UNIQUE (automation_id, alvo_chave):
--      um disparo por alvo. O alvo é a conversa nas condições de conversa
--      (no_patient_reply, no_agent_reply) e o lead nas de lead
--      (lead_stuck_stage, lead_no_task). Antes, a condição de conversa olhava a
--      conversa e o lead juntos; agora olha só a conversa.
--      reservar_disparo_por_tempo(automação, lead, conversa) grava a linha antes
--      da ação e devolve o id, ou NULL se o alvo já foi disparado; o app apaga a
--      linha quando o disparo não se consuma (falha da Meta, pulado), para tentar
--      de novo na hora seguinte. Se o processo cair entre a reserva e o envio, o
--      alvo fica marcado como disparado: preferimos perder um lembrete a mandar
--      dois.
--   3. As duas funções são SECURITY INVOKER e só o service_role executa.
--
-- Aborta se o log já tiver dois disparos para o mesmo alvo (a consulta da
-- mensagem mostra quantos grupos).
--
-- Aplicar em produção é [H]: o Infra aplica, com aprovação e backup do dia, como
-- supabase_admin, com --single-transaction; depois registra a versão '137' e roda
-- notify pgrst, 'reload schema'. Sem BEGIN/COMMIT. Idempotente. Aplicar antes do
-- deploy do app desta versão (o app chama as duas funções).
--
-- Reversão (o app desta versão para de enviar agendadas e automações por tempo):
--   DROP FUNCTION IF EXISTS public.reservar_mensagens_agendadas(int);
--   DROP FUNCTION IF EXISTS public.reservar_disparo_por_tempo(uuid, uuid, uuid);
--   DROP INDEX IF EXISTS public.uq_wa_timed_automation_log_alvo, public.idx_wa_scheduled_vencidas;
--   ALTER TABLE public.wa_timed_automation_log DROP COLUMN IF EXISTS alvo_chave;
--   ALTER TABLE public.wa_scheduled_messages DROP COLUMN IF EXISTS reservado_em;

SET LOCAL lock_timeout = '5s';

DO $$
BEGIN
  IF current_setting('lock_timeout') <> '5s' THEN
    RAISE EXCEPTION '137: rode com --single-transaction (lock_timeout atual: %)', current_setting('lock_timeout');
  END IF;
  IF current_user <> 'supabase_admin' THEN
    RAISE EXCEPTION '137: rodar como supabase_admin (atual: %)', current_user;
  END IF;
END $$;

-- ── 1. Mensagens agendadas ───────────────────────────────────────────────────

ALTER TABLE public.wa_scheduled_messages
  ADD COLUMN IF NOT EXISTS reservado_em timestamptz;

CREATE INDEX IF NOT EXISTS idx_wa_scheduled_vencidas
  ON public.wa_scheduled_messages (scheduled_for)
  WHERE status = 'pending';

CREATE OR REPLACE FUNCTION public.reservar_mensagens_agendadas(p_limite int)
 RETURNS SETOF public.wa_scheduled_messages
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
BEGIN
  IF coalesce(auth.role(), '') IN ('anon', 'authenticated') THEN
    RAISE EXCEPTION 'reservar_mensagens_agendadas: só o servidor envia agendadas' USING ERRCODE = '42501';
  END IF;
  IF p_limite IS NULL OR p_limite < 1 THEN
    RETURN;
  END IF;

  RETURN QUERY
  UPDATE public.wa_scheduled_messages m
     SET reservado_em = now()
   WHERE m.id IN (
     SELECT s.id FROM public.wa_scheduled_messages s
      WHERE s.status = 'pending'
        AND s.scheduled_for <= now()
        AND (s.reservado_em IS NULL OR s.reservado_em <= now() - interval '10 minutes')
      ORDER BY s.scheduled_for, s.id
      LIMIT p_limite
      FOR UPDATE SKIP LOCKED)
  RETURNING m.*;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.reservar_mensagens_agendadas(int) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.reservar_mensagens_agendadas(int) TO service_role;

-- ── 2. Automações por tempo ──────────────────────────────────────────────────

ALTER TABLE public.wa_timed_automation_log
  ADD COLUMN IF NOT EXISTS alvo_chave text;

UPDATE public.wa_timed_automation_log l
   SET alvo_chave = CASE WHEN a.condition IN ('no_patient_reply', 'no_agent_reply')
                         THEN 'conversa:' || l.conversation_id
                         ELSE 'lead:' || l.lead_id END
  FROM public.wa_timed_automations a
 WHERE a.id = l.automation_id
   AND l.alvo_chave IS NULL;

DO $$
DECLARE repetidos int;
BEGIN
  SELECT count(*) INTO repetidos FROM (
    SELECT 1 FROM public.wa_timed_automation_log
     WHERE alvo_chave IS NOT NULL
     GROUP BY automation_id, alvo_chave HAVING count(*) > 1) g;
  IF repetidos > 0 THEN
    RAISE EXCEPTION '137: % grupo(s) de disparos repetidos em wa_timed_automation_log (mesma automação e alvo)', repetidos;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_wa_timed_automation_log_alvo
  ON public.wa_timed_automation_log (automation_id, alvo_chave);

CREATE OR REPLACE FUNCTION public.reservar_disparo_por_tempo(p_automation uuid, p_lead uuid, p_conversa uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE
  condicao text;
  chave text;
  reserva uuid;
BEGIN
  IF coalesce(auth.role(), '') IN ('anon', 'authenticated') THEN
    RAISE EXCEPTION 'reservar_disparo_por_tempo: só o servidor dispara automações' USING ERRCODE = '42501';
  END IF;

  SELECT a.condition INTO condicao FROM public.wa_timed_automations a WHERE a.id = p_automation;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'reservar_disparo_por_tempo: automação % não existe', p_automation USING ERRCODE = '23503';
  END IF;

  chave := CASE WHEN condicao IN ('no_patient_reply', 'no_agent_reply')
                THEN 'conversa:' || p_conversa
                ELSE 'lead:' || p_lead END;
  IF chave IS NULL THEN
    RAISE EXCEPTION 'reservar_disparo_por_tempo: alvo vazio para a condição %', condicao USING ERRCODE = '22004';
  END IF;

  INSERT INTO public.wa_timed_automation_log (automation_id, lead_id, conversation_id, alvo_chave)
  VALUES (p_automation, p_lead, p_conversa, chave)
  ON CONFLICT (automation_id, alvo_chave) DO NOTHING
  RETURNING id INTO reserva;

  RETURN reserva;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.reservar_disparo_por_tempo(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.reservar_disparo_por_tempo(uuid, uuid, uuid) TO service_role;
