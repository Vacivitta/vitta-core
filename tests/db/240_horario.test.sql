INSERT INTO public.tenants (id, nome) VALUES ('00000000-0000-4000-8240-0000000000f0', 'Rede 240');
-- a0: Itu (São Paulo); b0: Manaus (UTC-4)
INSERT INTO public.units (id, tenant_id, nome, tipo) VALUES
  ('00000000-0000-4000-8240-0000000000a0', '00000000-0000-4000-8240-0000000000f0', 'Itu 240', 'clinica'),
  ('00000000-0000-4000-8240-0000000000b0', '00000000-0000-4000-8240-0000000000f0', 'Manaus 240', 'clinica');
UPDATE public.units SET fuso = 'America/Manaus' WHERE id = '00000000-0000-4000-8240-0000000000b0';

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('00000000-0000-4000-8240-000000000001', 'atendente240@teste.invalid', '{"full_name": "Atendente 240"}'),
  ('00000000-0000-4000-8240-000000000003', 'gestor240@teste.invalid', '{"full_name": "Gestor 240"}'),
  ('00000000-0000-4000-8240-000000000006', 'gestorb240@teste.invalid', '{"full_name": "Gestor B 240"}'),
  ('00000000-0000-4000-8240-000000000005', 'admin240@teste.invalid', '{"full_name": "Admin 240"}');
UPDATE public.profiles SET perfil = CASE id
    WHEN '00000000-0000-4000-8240-000000000001' THEN 'atendente'
    WHEN '00000000-0000-4000-8240-000000000005' THEN 'admin'
    ELSE 'gestor_unidade' END
 WHERE id::text LIKE '00000000-0000-4000-8240-00000000000_';
INSERT INTO public.user_units (user_id, unit_id) VALUES
  ('00000000-0000-4000-8240-000000000001', '00000000-0000-4000-8240-0000000000a0'),
  ('00000000-0000-4000-8240-000000000003', '00000000-0000-4000-8240-0000000000a0'),
  ('00000000-0000-4000-8240-000000000006', '00000000-0000-4000-8240-0000000000b0');

INSERT INTO public.funnels (id, nome, unit_id) VALUES
  ('00000000-0000-4000-8240-0000000000d0', 'Comercial 240', '00000000-0000-4000-8240-0000000000a0'),
  ('00000000-0000-4000-8240-0000000000d1', 'Vacinas 240', '00000000-0000-4000-8240-0000000000a0');
INSERT INTO public.wa_queues (id, unit_id, nome)
VALUES ('00000000-0000-4000-8240-0000000000e0', '00000000-0000-4000-8240-0000000000a0', 'Plantão 240');

-- Itu: seg a sex 8h–12h e 13h–18h, sáb 8h–12h. Funil comercial: seg a sex 9h–21h.
-- Fila plantão: todo dia 0h–24h (00:00–23:59:59). Manaus: seg a sex 8h–17h (hora de Manaus).
INSERT INTO public.horarios_atendimento (id, unit_id, escopo) VALUES
  ('00000000-0000-4000-8240-000000000101', '00000000-0000-4000-8240-0000000000a0', 'unidade'),
  ('00000000-0000-4000-8240-000000000103', '00000000-0000-4000-8240-0000000000b0', 'unidade');
INSERT INTO public.horarios_atendimento (id, unit_id, escopo, funnel_id) VALUES
  ('00000000-0000-4000-8240-000000000102', '00000000-0000-4000-8240-0000000000a0', 'funil', '00000000-0000-4000-8240-0000000000d0');
INSERT INTO public.horarios_atendimento (id, unit_id, escopo, fila_id) VALUES
  ('00000000-0000-4000-8240-000000000104', '00000000-0000-4000-8240-0000000000a0', 'fila', '00000000-0000-4000-8240-0000000000e0');

INSERT INTO public.horario_faixas (horario_id, dia_semana, inicio, fim)
SELECT '00000000-0000-4000-8240-000000000101'::uuid, d, f.inicio, f.fim
  FROM generate_series(1, 5) d CROSS JOIN (VALUES ('08:00'::time, '12:00'::time), ('13:00', '18:00')) f (inicio, fim)
UNION ALL SELECT '00000000-0000-4000-8240-000000000101', 6, '08:00', '12:00'
UNION ALL SELECT '00000000-0000-4000-8240-000000000102', d, '09:00', '21:00' FROM generate_series(1, 5) d
UNION ALL SELECT '00000000-0000-4000-8240-000000000104', d, '00:00', '23:59:59' FROM generate_series(0, 6) d
UNION ALL SELECT '00000000-0000-4000-8240-000000000103', d, '08:00', '17:00' FROM generate_series(1, 5) d;

-- 2026-11-20 (sexta): feriado nacional da marca; Itu abre só 9h–11h nele.
-- 2026-11-23 (segunda): feriado municipal de Itu, fechado.
INSERT INTO public.feriados (unit_id, data, nome, fechado, inicio, fim) VALUES
  (NULL, '2026-11-20', 'Consciência Negra', true, NULL, NULL),
  ('00000000-0000-4000-8240-0000000000a0', '2026-11-20', 'Consciência Negra (Itu abre de manhã)', false, '09:00', '11:00'),
  ('00000000-0000-4000-8240-0000000000a0', '2026-11-23', 'Aniversário de Itu', true, NULL, NULL);

CREATE FUNCTION pg_temp.esperar(caso text, obtido text, esperado text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF obtido IS DISTINCT FROM esperado THEN
    RAISE EXCEPTION '%: esperado %, obtido %', caso, esperado, obtido;
  END IF;
END $$;

CREATE FUNCTION pg_temp.aberto(unidade char, instante timestamptz, fila uuid DEFAULT NULL, funil uuid DEFAULT NULL) RETURNS text
LANGUAGE sql AS $$
  SELECT public.dentro_do_horario(('00000000-0000-4000-8240-0000000000' || unidade || '0')::uuid, instante, fila, funil)::text
$$;

-- 2026-11-10 é terça. Horários de Brasília (-03).
SELECT pg_temp.esperar('terça 10h em Itu',             pg_temp.aberto('a', '2026-11-10 10:00-03'), 'true');
SELECT pg_temp.esperar('terça 12h30 (almoço) em Itu',   pg_temp.aberto('a', '2026-11-10 12:30-03'), 'false');
SELECT pg_temp.esperar('terça 13h em Itu (segunda faixa)', pg_temp.aberto('a', '2026-11-10 13:00-03'), 'true');
SELECT pg_temp.esperar('terça 18h em Itu (fim é aberto)', pg_temp.aberto('a', '2026-11-10 18:00-03'), 'false');
SELECT pg_temp.esperar('sábado 11h59 em Itu',           pg_temp.aberto('a', '2026-11-14 11:59-03'), 'true');
SELECT pg_temp.esperar('domingo 10h em Itu',            pg_temp.aberto('a', '2026-11-15 10:00-03'), 'false');
SELECT pg_temp.esperar('virada do dia: sábado 0h30 de Brasília é sexta 23h30 em Manaus',
  pg_temp.aberto('b', '2026-11-14 00:30-03'), 'false');
SELECT pg_temp.esperar('terça 8h30 de Brasília é 7h30 em Manaus: fechado',
  pg_temp.aberto('b', '2026-11-10 08:30-03'), 'false');
SELECT pg_temp.esperar('terça 17h30 de Brasília é 16h30 em Manaus: aberto',
  pg_temp.aberto('b', '2026-11-10 17:30-03'), 'true');
SELECT pg_temp.esperar('funil comercial abre até 21h na terça',
  pg_temp.aberto('a', '2026-11-10 20:00-03', NULL, '00000000-0000-4000-8240-0000000000d0'), 'true');
SELECT pg_temp.esperar('outro funil segue a unidade',
  pg_temp.aberto('a', '2026-11-10 20:00-03', NULL, gen_random_uuid()), 'false');
SELECT pg_temp.esperar('fila de plantão no domingo',
  pg_temp.aberto('a', '2026-11-15 03:00-03', '00000000-0000-4000-8240-0000000000e0'), 'true');
SELECT pg_temp.esperar('fila vence o funil',
  pg_temp.aberto('a', '2026-11-15 03:00-03', '00000000-0000-4000-8240-0000000000e0', '00000000-0000-4000-8240-0000000000d0'), 'true');
SELECT pg_temp.esperar('feriado nacional fecha Manaus',     pg_temp.aberto('b', '2026-11-20 10:00-03'), 'false');
SELECT pg_temp.esperar('Itu abre de manhã no feriado nacional', pg_temp.aberto('a', '2026-11-20 10:00-03'), 'true');
SELECT pg_temp.esperar('Itu fecha 11h no feriado nacional',  pg_temp.aberto('a', '2026-11-20 11:00-03'), 'false');
SELECT pg_temp.esperar('feriado municipal fecha Itu numa segunda', pg_temp.aberto('a', '2026-11-23 10:00-03'), 'false');
SELECT pg_temp.esperar('feriado municipal de Itu não fecha Manaus', pg_temp.aberto('b', '2026-11-23 10:00-03'), 'true');
SELECT pg_temp.esperar('unidade sem horário configurado é sempre aberta',
  public.dentro_do_horario(gen_random_uuid(), '2026-11-15 03:00-03')::text, 'true');

-- Próxima abertura
SELECT pg_temp.esperar('aberto: a próxima abertura é agora',
  public.proxima_abertura('00000000-0000-4000-8240-0000000000a0', '2026-11-10 10:00-03')::text,
  ('2026-11-10 10:00-03'::timestamptz)::text);
SELECT pg_temp.esperar('almoço: abre 13h',
  public.proxima_abertura('00000000-0000-4000-8240-0000000000a0', '2026-11-10 12:30-03')::text,
  ('2026-11-10 13:00-03'::timestamptz)::text);
SELECT pg_temp.esperar('sábado à tarde: abre segunda 8h',
  public.proxima_abertura('00000000-0000-4000-8240-0000000000a0', '2026-11-14 15:00-03')::text,
  ('2026-11-16 08:00-03'::timestamptz)::text);
SELECT pg_temp.esperar('quinta à noite, véspera do feriado: abre sexta 9h (horário do feriado)',
  public.proxima_abertura('00000000-0000-4000-8240-0000000000a0', '2026-11-19 19:00-03')::text,
  ('2026-11-20 09:00-03'::timestamptz)::text);
SELECT pg_temp.esperar('sábado à tarde antes do feriado municipal: abre terça 8h',
  public.proxima_abertura('00000000-0000-4000-8240-0000000000a0', '2026-11-21 15:00-03')::text,
  ('2026-11-24 08:00-03'::timestamptz)::text);
SELECT pg_temp.esperar('Manaus: abre 8h de Manaus (9h de Brasília)',
  public.proxima_abertura('00000000-0000-4000-8240-0000000000b0', '2026-11-10 06:00-03')::text,
  ('2026-11-10 08:00-04'::timestamptz)::text);

-- Validações
DO $$
BEGIN
  BEGIN
    UPDATE public.units SET fuso = 'Brasil/Itu' WHERE id = '00000000-0000-4000-8240-0000000000a0';
    RAISE EXCEPTION 'fuso inexistente deveria ser recusado';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;
  BEGIN
    INSERT INTO public.horario_faixas (horario_id, dia_semana, inicio, fim)
    VALUES ('00000000-0000-4000-8240-000000000101', 2, '18:00', '08:00');
    RAISE EXCEPTION 'faixa com fim antes do início deveria ser recusada';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO public.horarios_atendimento (unit_id, escopo) VALUES ('00000000-0000-4000-8240-0000000000a0', 'unidade');
    RAISE EXCEPTION 'segundo horário da unidade deveria ser recusado';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO public.horarios_atendimento (unit_id, escopo, fila_id)
    VALUES ('00000000-0000-4000-8240-0000000000b0', 'fila', '00000000-0000-4000-8240-0000000000e0');
    RAISE EXCEPTION 'exceção de fila de outra unidade deveria ser recusada';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO public.feriados (unit_id, data, nome) VALUES (NULL, '2026-11-20', 'repetido');
    RAISE EXCEPTION 'feriado nacional repetido na mesma data deveria ser recusado';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  BEGIN
    DELETE FROM public.funnels WHERE id = '00000000-0000-4000-8240-0000000000d0';
    RAISE EXCEPTION 'funil com exceção de horário não deveria ser excluído';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;
END $$;

-- Acesso
CREATE FUNCTION pg_temp.linhas_afetadas_como(papel text, usuario uuid, comando text) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE linhas bigint; resultado text;
BEGIN
  BEGIN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', usuario, 'role', papel)::text, true);
    EXECUTE format('SET LOCAL ROLE %I', papel);
    EXECUTE comando;
    GET DIAGNOSTICS linhas = ROW_COUNT;
    RAISE EXCEPTION USING ERRCODE = 'VCT01', MESSAGE = linhas::text;
  EXCEPTION
    WHEN SQLSTATE 'VCT01' THEN resultado := SQLERRM;
    WHEN OTHERS THEN resultado := 'erro ' || SQLSTATE;
  END;
  RETURN resultado;
END $$;

CREATE TEMP TABLE casos (ordem serial, caso text, papel text, usuario uuid, comando text, esperado text);
INSERT INTO casos (caso, papel, usuario, comando, esperado) VALUES
  ('atendente lê os horários da unidade', 'authenticated', '00000000-0000-4000-8240-000000000001',
   $c$SELECT * FROM public.horarios_atendimento$c$, '3'),
  ('atendente lê as faixas da unidade', 'authenticated', '00000000-0000-4000-8240-000000000001',
   $c$SELECT * FROM public.horario_faixas$c$, '23'),
  ('atendente lê feriados nacionais e os da unidade', 'authenticated', '00000000-0000-4000-8240-000000000001',
   $c$SELECT * FROM public.feriados WHERE data >= '2026-11-01'$c$, '3'),
  ('gestor de Manaus não vê os feriados de Itu', 'authenticated', '00000000-0000-4000-8240-000000000006',
   $c$SELECT * FROM public.feriados WHERE data >= '2026-11-01'$c$, '1'),
  ('atendente não muda faixas', 'authenticated', '00000000-0000-4000-8240-000000000001',
   $c$UPDATE public.horario_faixas SET fim = '19:00' WHERE horario_id = '00000000-0000-4000-8240-000000000101'$c$, '0'),
  ('gestor da unidade muda faixas', 'authenticated', '00000000-0000-4000-8240-000000000003',
   $c$UPDATE public.horario_faixas SET fim = '19:00' WHERE horario_id = '00000000-0000-4000-8240-000000000101' AND fim = '18:00'$c$, '5'),
  ('gestor de outra unidade não muda faixas de Itu', 'authenticated', '00000000-0000-4000-8240-000000000006',
   $c$UPDATE public.horario_faixas SET fim = '19:00' WHERE horario_id = '00000000-0000-4000-8240-000000000101'$c$, '0'),
  ('gestor cria feriado da unidade', 'authenticated', '00000000-0000-4000-8240-000000000003',
   $c$INSERT INTO public.feriados (unit_id, data, nome) VALUES ('00000000-0000-4000-8240-0000000000a0', '2026-12-08', 'Imaculada')$c$, '1'),
  ('gestor não cria feriado nacional', 'authenticated', '00000000-0000-4000-8240-000000000003',
   $c$INSERT INTO public.feriados (unit_id, data, nome) VALUES (NULL, '2026-12-25', 'Natal')$c$, 'erro 42501'),
  ('admin da marca cria feriado nacional', 'authenticated', '00000000-0000-4000-8240-000000000005',
   $c$INSERT INTO public.feriados (unit_id, data, nome) VALUES (NULL, '2026-12-25', 'Natal')$c$, '1'),
  ('gestor não muda o fuso da unidade', 'authenticated', '00000000-0000-4000-8240-000000000003',
   $c$UPDATE public.units SET fuso = 'America/Manaus' WHERE id = '00000000-0000-4000-8240-0000000000a0'$c$, '0'),
  ('gestor cria exceção de horário para o funil', 'authenticated', '00000000-0000-4000-8240-000000000003',
   $c$INSERT INTO public.horarios_atendimento (unit_id, escopo, funnel_id) SELECT '00000000-0000-4000-8240-0000000000a0', 'funil', f.id FROM public.funnels f WHERE f.id = '00000000-0000-4000-8240-0000000000d1'$c$, '1'),
  ('atendente consulta se está no horário', 'authenticated', '00000000-0000-4000-8240-000000000001',
   $c$SELECT public.dentro_do_horario('00000000-0000-4000-8240-0000000000a0', '2026-11-10 10:00-03')$c$, '1'),
  ('anon não consulta o horário', 'anon', NULL,
   $c$SELECT public.dentro_do_horario('00000000-0000-4000-8240-0000000000a0', now())$c$, 'erro 42501');

DO $$
DECLARE c record; obtido text; divergentes text[] := '{}';
BEGIN
  FOR c IN SELECT * FROM casos ORDER BY ordem LOOP
    obtido := pg_temp.linhas_afetadas_como(c.papel, c.usuario, c.comando);
    IF obtido IS DISTINCT FROM c.esperado THEN
      divergentes := divergentes || format('%s: esperado %s, obtido %s', c.caso, c.esperado, obtido);
    END IF;
  END LOOP;
  IF cardinality(divergentes) > 0 THEN
    RAISE EXCEPTION E'horário de atendimento:\n%', array_to_string(divergentes, E'\n');
  END IF;
END $$;
