INSERT INTO public.tenants (id, nome) VALUES ('00000000-0000-4000-8200-0000000000f0', 'Rede 200');
INSERT INTO public.units (id, tenant_id, nome, tipo) VALUES
  ('00000000-0000-4000-8200-0000000000a0', '00000000-0000-4000-8200-0000000000f0', 'Clínica 200', 'clinica');
INSERT INTO public.funnels (id, nome, unit_id)
VALUES ('00000000-0000-4000-8200-0000000000d0', 'Funil 200', '00000000-0000-4000-8200-0000000000a0');
INSERT INTO public.funnel_stages (id, funnel_id, nome, unit_id)
VALUES ('00000000-0000-4000-8200-0000000000d1', '00000000-0000-4000-8200-0000000000d0', 'Novo',
        '00000000-0000-4000-8200-0000000000a0');
INSERT INTO public.leads (id, nome, funnel_id, stage_id, unit_id) VALUES
  ('00000000-0000-4000-8200-000000000101', 'Lead 200', '00000000-0000-4000-8200-0000000000d0',
   '00000000-0000-4000-8200-0000000000d1', '00000000-0000-4000-8200-0000000000a0');
INSERT INTO public.wa_conversations (id, unit_id, wa_phone, lead_id) VALUES
  ('00000000-0000-4000-8200-000000000501', '00000000-0000-4000-8200-0000000000a0', '5511900000501',
   '00000000-0000-4000-8200-000000000101'),
  ('00000000-0000-4000-8200-000000000502', '00000000-0000-4000-8200-0000000000a0', '5511900000502',
   '00000000-0000-4000-8200-000000000101');

-- 601-603 vencidas; 604 futura; 605 cancelada; 606 já enviada
INSERT INTO public.wa_scheduled_messages (id, conversation_id, unit_id, content, scheduled_for, status) VALUES
  ('00000000-0000-4000-8200-000000000601', '00000000-0000-4000-8200-000000000501', '00000000-0000-4000-8200-0000000000a0',
   'um', now() - interval '3 minutes', 'pending'),
  ('00000000-0000-4000-8200-000000000602', '00000000-0000-4000-8200-000000000501', '00000000-0000-4000-8200-0000000000a0',
   'dois', now() - interval '2 minutes', 'pending'),
  ('00000000-0000-4000-8200-000000000603', '00000000-0000-4000-8200-000000000501', '00000000-0000-4000-8200-0000000000a0',
   'três', now() - interval '1 minute', 'pending'),
  ('00000000-0000-4000-8200-000000000604', '00000000-0000-4000-8200-000000000501', '00000000-0000-4000-8200-0000000000a0',
   'futura', now() + interval '1 hour', 'pending'),
  ('00000000-0000-4000-8200-000000000605', '00000000-0000-4000-8200-000000000501', '00000000-0000-4000-8200-0000000000a0',
   'cancelada', now() - interval '5 minutes', 'cancelled'),
  ('00000000-0000-4000-8200-000000000606', '00000000-0000-4000-8200-000000000501', '00000000-0000-4000-8200-0000000000a0',
   'enviada', now() - interval '5 minutes', 'sent');

CREATE FUNCTION pg_temp.finais(ids uuid[]) RETURNS text LANGUAGE sql AS $$
  SELECT coalesce(string_agg(right(i::text, 3), ',' ORDER BY i), '') FROM unnest(ids) i
$$;

DO $$
DECLARE
  primeira uuid[];
  segunda uuid[];
  terceira uuid[];
  quarta uuid[];
BEGIN
  SELECT array_agg(id) INTO primeira FROM public.reservar_mensagens_agendadas(2);
  SELECT array_agg(id) INTO segunda  FROM public.reservar_mensagens_agendadas(10);
  SELECT array_agg(id) INTO terceira FROM public.reservar_mensagens_agendadas(10);
  IF pg_temp.finais(primeira) <> '601,602' THEN
    RAISE EXCEPTION 'primeira reserva deveria pegar as 2 mais antigas vencidas (601,602), pegou %', pg_temp.finais(primeira);
  END IF;
  IF pg_temp.finais(segunda) <> '603' THEN
    RAISE EXCEPTION 'segunda reserva deveria pegar só a vencida que sobrou (603), pegou %', pg_temp.finais(segunda);
  END IF;
  IF pg_temp.finais(terceira) <> '' THEN
    RAISE EXCEPTION 'terceira reserva não deveria pegar nada (futura, cancelada, enviada ou reservada), pegou %', pg_temp.finais(terceira);
  END IF;

  UPDATE public.wa_scheduled_messages SET reservado_em = now() - interval '11 minutes'
   WHERE id = '00000000-0000-4000-8200-000000000602';
  SELECT array_agg(id) INTO quarta FROM public.reservar_mensagens_agendadas(10);
  IF pg_temp.finais(quarta) <> '602' THEN
    RAISE EXCEPTION 'reserva abandonada há mais de 10 min deveria voltar (602), pegou %', pg_temp.finais(quarta);
  END IF;

  IF (SELECT count(*) FROM public.reservar_mensagens_agendadas(0)) <> 0 THEN
    RAISE EXCEPTION 'limite 0 não deveria reservar';
  END IF;
  IF (SELECT status FROM public.wa_scheduled_messages WHERE id = '00000000-0000-4000-8200-000000000601') <> 'pending' THEN
    RAISE EXCEPTION 'reservar não muda o status: a tela e o cancelamento continuam vendo pending';
  END IF;
END $$;

INSERT INTO public.wa_timed_automations (id, unit_id, nome, condition, action) VALUES
  ('00000000-0000-4000-8200-000000000701', '00000000-0000-4000-8200-0000000000a0', 'sem resposta', 'no_patient_reply', 'send_template'),
  ('00000000-0000-4000-8200-000000000702', '00000000-0000-4000-8200-0000000000a0', 'parado', 'lead_stuck_stage', 'move_stage');

DO $$
DECLARE
  auto_conversa constant uuid := '00000000-0000-4000-8200-000000000701';
  auto_lead     constant uuid := '00000000-0000-4000-8200-000000000702';
  lead          constant uuid := '00000000-0000-4000-8200-000000000101';
  conv1         constant uuid := '00000000-0000-4000-8200-000000000501';
  conv2         constant uuid := '00000000-0000-4000-8200-000000000502';
  r1 uuid; r2 uuid; r3 uuid; r4 uuid; r5 uuid; r6 uuid;
BEGIN
  r1 := public.reservar_disparo_por_tempo(auto_conversa, lead, conv1);
  r2 := public.reservar_disparo_por_tempo(auto_conversa, lead, conv1);
  r3 := public.reservar_disparo_por_tempo(auto_conversa, lead, conv2);
  IF r1 IS NULL THEN RAISE EXCEPTION 'primeira reserva da conversa deveria devolver o id'; END IF;
  IF r2 IS NOT NULL THEN RAISE EXCEPTION 'segunda reserva da mesma automação e conversa deveria devolver NULL'; END IF;
  IF r3 IS NULL THEN RAISE EXCEPTION 'outra conversa do mesmo lead é outro alvo na condição de conversa'; END IF;

  r4 := public.reservar_disparo_por_tempo(auto_lead, lead, NULL);
  r5 := public.reservar_disparo_por_tempo(auto_lead, lead, conv2);
  IF r4 IS NULL THEN RAISE EXCEPTION 'primeira reserva do lead deveria devolver o id'; END IF;
  IF r5 IS NOT NULL THEN RAISE EXCEPTION 'na condição de lead, o mesmo lead por outra conversa já foi disparado'; END IF;

  DELETE FROM public.wa_timed_automation_log WHERE id = r1;
  r6 := public.reservar_disparo_por_tempo(auto_conversa, lead, conv1);
  IF r6 IS NULL THEN RAISE EXCEPTION 'reserva liberada (disparo não consumado) deveria poder ser feita de novo'; END IF;

  BEGIN
    PERFORM public.reservar_disparo_por_tempo(auto_conversa, lead, NULL);
    RAISE EXCEPTION 'condição de conversa sem conversa deveria ser recusada';
  EXCEPTION WHEN SQLSTATE '22004' THEN NULL;
  END;

  BEGIN
    INSERT INTO public.wa_timed_automation_log (automation_id, lead_id, conversation_id, alvo_chave)
    VALUES (auto_lead, lead, NULL, 'lead:' || lead);
    RAISE EXCEPTION 'o banco deveria recusar um segundo disparo para o mesmo alvo';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
END $$;

CREATE FUNCTION pg_temp.erro_como(papel text, comando text) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE resultado text := 'sem erro';
BEGIN
  BEGIN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', gen_random_uuid(), 'role', papel)::text, true);
    EXECUTE format('SET LOCAL ROLE %I', papel);
    EXECUTE comando;
    RAISE EXCEPTION USING ERRCODE = 'VCT01';
  EXCEPTION
    WHEN SQLSTATE 'VCT01' THEN NULL;
    WHEN OTHERS THEN resultado := 'erro ' || SQLSTATE;
  END;
  RETURN resultado;
END $$;

DO $$
DECLARE
  papel text;
  comando text;
  obtido text;
BEGIN
  FOREACH papel IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    FOREACH comando IN ARRAY ARRAY[
      'SELECT * FROM public.reservar_mensagens_agendadas(10)',
      $c$SELECT public.reservar_disparo_por_tempo('00000000-0000-4000-8200-000000000701',
           '00000000-0000-4000-8200-000000000101', '00000000-0000-4000-8200-000000000502')$c$
    ] LOOP
      obtido := pg_temp.erro_como(papel, comando);
      IF obtido <> 'erro 42501' THEN
        RAISE EXCEPTION '% deveria ser recusado para %, obtido %', comando, papel, obtido;
      END IF;
    END LOOP;
  END LOOP;
END $$;
