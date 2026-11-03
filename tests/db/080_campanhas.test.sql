INSERT INTO public.tenants (id, nome) VALUES ('00000000-0000-4000-8080-0000000000f0', 'Rede Campanhas');
INSERT INTO public.units (id, tenant_id, nome, tipo) VALUES
  ('00000000-0000-4000-8080-0000000000a0', '00000000-0000-4000-8080-0000000000f0', 'Unidade A', 'clinica'),
  ('00000000-0000-4000-8080-0000000000b0', '00000000-0000-4000-8080-0000000000f0', 'Unidade B', 'clinica');

INSERT INTO public.wa_campaigns (id, unit_id, nome, status, daily_limit) VALUES
  ('00000000-0000-4000-8080-0000000000c1', '00000000-0000-4000-8080-0000000000a0', 'A envia',   'enviando', 10),
  ('00000000-0000-4000-8080-0000000000c2', '00000000-0000-4000-8080-0000000000a0', 'A já foi',  'enviando', 10),
  ('00000000-0000-4000-8080-0000000000c3', '00000000-0000-4000-8080-0000000000b0', 'B envia',   'enviando', 100),
  ('00000000-0000-4000-8080-0000000000c4', '00000000-0000-4000-8080-0000000000b0', 'B reserva', 'enviando', 100),
  ('00000000-0000-4000-8080-0000000000c5', '00000000-0000-4000-8080-0000000000b0', 'B pausada', 'pausada',  100);

INSERT INTO public.wa_campaign_recipients (campaign_id, phone)
SELECT '00000000-0000-4000-8080-0000000000c1', '55319900000' || lpad(i::text, 2, '0') FROM generate_series(1, 12) i;

INSERT INTO public.wa_campaign_recipients (campaign_id, phone, status, sent_at) VALUES
  ('00000000-0000-4000-8080-0000000000c2', '5531990000101', 'sent', now()),
  ('00000000-0000-4000-8080-0000000000c2', '5531990000102', 'delivered', now()),
  ('00000000-0000-4000-8080-0000000000c2', '5531990000103', 'read',
   (date_trunc('day', now() AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'America/Sao_Paulo') - interval '1 minute');

INSERT INTO public.wa_campaign_recipients (campaign_id, phone)
SELECT '00000000-0000-4000-8080-0000000000c3', '55319900002' || i FROM generate_series(1, 3) i;

INSERT INTO public.wa_campaign_recipients (id, campaign_id, phone, reservado_em) VALUES
  ('00000000-0000-4000-8080-000000000401', '00000000-0000-4000-8080-0000000000c4', '5531990000401', now() - interval '11 minutes'),
  ('00000000-0000-4000-8080-000000000402', '00000000-0000-4000-8080-0000000000c4', '5531990000402', now() - interval '1 minute');

INSERT INTO public.wa_campaign_recipients (campaign_id, phone)
VALUES ('00000000-0000-4000-8080-0000000000c5', '5531990000501');

DO $$
DECLARE
  primeira uuid[];
  segunda uuid[];
  terceira uuid[];
  quarta uuid[];
BEGIN
  SELECT array_agg(id) INTO primeira FROM public.reservar_destinatarios_campanha('00000000-0000-4000-8080-0000000000c1', 3);
  SELECT array_agg(id) INTO segunda  FROM public.reservar_destinatarios_campanha('00000000-0000-4000-8080-0000000000c1', 3);
  IF cardinality(primeira) IS DISTINCT FROM 3 OR cardinality(segunda) IS DISTINCT FROM 3 THEN
    RAISE EXCEPTION 'reserva deveria devolver 3 e 3 destinatários, devolveu % e %',
      coalesce(cardinality(primeira), 0), coalesce(cardinality(segunda), 0);
  END IF;
  IF primeira && segunda THEN
    RAISE EXCEPTION 'duas reservas seguidas devolveram o mesmo destinatário';
  END IF;

  SELECT array_agg(id) INTO terceira FROM public.reservar_destinatarios_campanha('00000000-0000-4000-8080-0000000000c1', 3);
  IF cardinality(terceira) IS DISTINCT FROM 2 THEN
    RAISE EXCEPTION 'com 8 de 10 usados hoje na unidade, a reserva deveria devolver 2, devolveu %', coalesce(cardinality(terceira), 0);
  END IF;
  IF terceira && (primeira || segunda) THEN
    RAISE EXCEPTION 'terceira reserva repetiu destinatário';
  END IF;
  SELECT array_agg(id) INTO quarta FROM public.reservar_destinatarios_campanha('00000000-0000-4000-8080-0000000000c1', 3);
  IF quarta IS NOT NULL THEN
    RAISE EXCEPTION 'limite diário da unidade atingido, mas a reserva devolveu % destinatário(s)', cardinality(quarta);
  END IF;
END $$;

DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM public.reservar_destinatarios_campanha('00000000-0000-4000-8080-0000000000c3', 1);
  IF n <> 1 THEN
    RAISE EXCEPTION 'p_limite = 1 deveria reservar 1, reservou %', n;
  END IF;
  SELECT count(*) INTO n FROM public.reservar_destinatarios_campanha('00000000-0000-4000-8080-0000000000c3', 0);
  IF n <> 0 THEN
    RAISE EXCEPTION 'p_limite = 0 deveria reservar 0, reservou %', n;
  END IF;

  SELECT count(*) INTO n FROM public.reservar_destinatarios_campanha('00000000-0000-4000-8080-0000000000c5', 5);
  IF n <> 0 THEN
    RAISE EXCEPTION 'campanha pausada não deveria ter destinatários reservados, teve %', n;
  END IF;
END $$;

DO $$
DECLARE ids uuid[];
BEGIN
  SELECT array_agg(id) INTO ids FROM public.reservar_destinatarios_campanha('00000000-0000-4000-8080-0000000000c4', 5);
  IF ids IS DISTINCT FROM ARRAY['00000000-0000-4000-8080-000000000401'::uuid] THEN
    RAISE EXCEPTION 'deveria liberar só a reserva de 11 min (a de 1 min está ativa), devolveu %', ids;
  END IF;
  IF (SELECT reservado_em FROM public.wa_campaign_recipients WHERE id = '00000000-0000-4000-8080-000000000401') <> now() THEN
    RAISE EXCEPTION 'reserva liberada deveria ganhar reservado_em novo';
  END IF;
END $$;

DO $$
DECLARE resultado text;
BEGIN
  IF has_function_privilege('authenticated', 'public.reservar_destinatarios_campanha(uuid,int)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.reservar_destinatarios_campanha(uuid,int)', 'EXECUTE') THEN
    RAISE EXCEPTION 'reservar_destinatarios_campanha executável por authenticated/anon';
  END IF;
  IF NOT has_function_privilege('service_role', 'public.reservar_destinatarios_campanha(uuid,int)', 'EXECUTE') THEN
    RAISE EXCEPTION 'service_role deveria executar reservar_destinatarios_campanha';
  END IF;

  BEGIN
    PERFORM set_config('request.jwt.claims', json_build_object('role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    PERFORM public.reservar_destinatarios_campanha('00000000-0000-4000-8080-0000000000c3', 1);
    resultado := 'executou';
  EXCEPTION WHEN OTHERS THEN
    resultado := SQLSTATE;
  END;
  RESET ROLE;
  IF resultado <> '42501' THEN
    RAISE EXCEPTION 'authenticated chamando a reserva deveria dar 42501, deu %', resultado;
  END IF;

  GRANT EXECUTE ON FUNCTION public.reservar_destinatarios_campanha(uuid, int) TO authenticated;
  BEGIN
    PERFORM set_config('request.jwt.claims', json_build_object('role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    PERFORM public.reservar_destinatarios_campanha('00000000-0000-4000-8080-0000000000c3', 1);
    resultado := 'executou';
  EXCEPTION WHEN OTHERS THEN
    resultado := SQLSTATE;
  END;
  RESET ROLE;
  REVOKE EXECUTE ON FUNCTION public.reservar_destinatarios_campanha(uuid, int) FROM authenticated;
  IF resultado <> '42501' THEN
    RAISE EXCEPTION 'com EXECUTE para authenticated, a guarda deveria dar 42501, deu %', resultado;
  END IF;
END $$;

DO $$
DECLARE resultado text;
BEGIN
  BEGIN
    UPDATE public.wa_campaigns SET motivo_pausa = 'qualquer' WHERE id = '00000000-0000-4000-8080-0000000000c5';
    resultado := 'aceitou';
  EXCEPTION WHEN check_violation THEN
    resultado := 'recusou';
  END;
  IF resultado <> 'recusou' THEN
    RAISE EXCEPTION 'motivo_pausa fora da lista deveria violar o check';
  END IF;
  UPDATE public.wa_campaigns SET motivo_pausa = 'limite_diario', retomar_em = now()
   WHERE id = '00000000-0000-4000-8080-0000000000c5';
END $$;
