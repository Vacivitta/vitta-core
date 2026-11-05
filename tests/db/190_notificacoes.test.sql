INSERT INTO public.tenants (id, nome) VALUES ('00000000-0000-4000-8000-0000000000f0', 'Rede Teste');
INSERT INTO public.units (id, tenant_id, nome, tipo) VALUES
  ('00000000-0000-4000-8000-0000000000a0', '00000000-0000-4000-8000-0000000000f0', 'Clínica A', 'clinica'),
  ('00000000-0000-4000-8000-0000000000b0', '00000000-0000-4000-8000-0000000000f0', 'Clínica B', 'clinica');

-- 1: atende A e B; 2: só A; 3: só B; 5: admin da marca, sem vínculo
INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('00000000-0000-4000-8000-000000000001', 'um@teste.invalid', '{"full_name": "Um"}'),
  ('00000000-0000-4000-8000-000000000002', 'dois@teste.invalid', '{"full_name": "Dois"}'),
  ('00000000-0000-4000-8000-000000000003', 'tres@teste.invalid', '{"full_name": "Três"}'),
  ('00000000-0000-4000-8000-000000000005', 'admin@teste.invalid', '{"full_name": "Admin"}');

UPDATE public.profiles SET perfil = 'admin' WHERE id = '00000000-0000-4000-8000-000000000005';

INSERT INTO public.user_units (user_id, unit_id) VALUES
  ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000a0'),
  ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000b0'),
  ('00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-0000000000a0'),
  ('00000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-0000000000b0');

-- 501: menção pessoal para 2 (unidade A); 502: aviso da unidade A; 503: pessoal para 1 (unidade B)
INSERT INTO public.notifications (id, unit_id, user_id, type, title) VALUES
  ('00000000-0000-4000-8000-000000000501', '00000000-0000-4000-8000-0000000000a0',
   '00000000-0000-4000-8000-000000000002', 'mention_note', 'menção para Dois'),
  ('00000000-0000-4000-8000-000000000502', '00000000-0000-4000-8000-0000000000a0',
   NULL, 'lead_transfer', 'aviso da unidade A'),
  ('00000000-0000-4000-8000-000000000503', '00000000-0000-4000-8000-0000000000b0',
   '00000000-0000-4000-8000-000000000001', 'quote_aceito', 'orçamento de Um');

-- O RAISE com SQLSTATE próprio desfaz a subtransação; a mensagem leva o ROW_COUNT para fora
CREATE FUNCTION pg_temp.linhas_afetadas_como(papel text, usuario uuid, comando text) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE
  linhas bigint;
  resultado text;
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
  ('colega da mesma unidade não lê a menção de outra pessoa', 'authenticated', '00000000-0000-4000-8000-000000000001',
   $c$SELECT * FROM public.notifications WHERE id = '00000000-0000-4000-8000-000000000501'$c$, '0'),
  ('destinatária lê a própria menção', 'authenticated', '00000000-0000-4000-8000-000000000002',
   $c$SELECT * FROM public.notifications WHERE id = '00000000-0000-4000-8000-000000000501'$c$, '1'),
  ('admin da marca não lê notificação pessoal de outra pessoa', 'authenticated', '00000000-0000-4000-8000-000000000005',
   $c$SELECT * FROM public.notifications WHERE id = '00000000-0000-4000-8000-000000000501'$c$, '0'),
  ('quem atende A e B vê: aviso de A e a própria de B', 'authenticated', '00000000-0000-4000-8000-000000000001',
   $c$SELECT * FROM public.notifications$c$, '2'),
  ('quem só atende B não vê o aviso de A', 'authenticated', '00000000-0000-4000-8000-000000000003',
   $c$SELECT * FROM public.notifications$c$, '0'),
  ('admin da marca vê avisos de unidade', 'authenticated', '00000000-0000-4000-8000-000000000005',
   $c$SELECT * FROM public.notifications WHERE id = '00000000-0000-4000-8000-000000000502'$c$, '1'),
  ('ninguém altera a notificação pelo app', 'authenticated', '00000000-0000-4000-8000-000000000002',
   $c$UPDATE public.notifications SET title = 'trocado' WHERE id = '00000000-0000-4000-8000-000000000501'$c$, 'erro 42501'),
  ('anon não lê notificações', 'anon', NULL,
   $c$SELECT * FROM public.notifications$c$, 'erro 42501'),
  ('marca o aviso da unidade como lido para si', 'authenticated', '00000000-0000-4000-8000-000000000001',
   $c$INSERT INTO public.notification_reads (notification_id, user_id)
      VALUES ('00000000-0000-4000-8000-000000000502', '00000000-0000-4000-8000-000000000001')$c$, '1'),
  ('não marca como lido em nome de outra pessoa', 'authenticated', '00000000-0000-4000-8000-000000000001',
   $c$INSERT INTO public.notification_reads (notification_id, user_id)
      VALUES ('00000000-0000-4000-8000-000000000502', '00000000-0000-4000-8000-000000000002')$c$, 'erro 42501'),
  ('não marca como lida notificação que não vê', 'authenticated', '00000000-0000-4000-8000-000000000001',
   $c$INSERT INTO public.notification_reads (notification_id, user_id)
      VALUES ('00000000-0000-4000-8000-000000000501', '00000000-0000-4000-8000-000000000001')$c$, 'erro 42501'),
  ('anon não marca leitura', 'anon', NULL,
   $c$INSERT INTO public.notification_reads (notification_id, user_id)
      VALUES ('00000000-0000-4000-8000-000000000502', '00000000-0000-4000-8000-000000000001')$c$, 'erro 42501');

DO $$
DECLARE
  c record;
  obtido text;
  divergentes text[] := '{}';
BEGIN
  FOR c IN SELECT * FROM casos ORDER BY ordem LOOP
    obtido := pg_temp.linhas_afetadas_como(c.papel, c.usuario, c.comando);
    IF obtido IS DISTINCT FROM c.esperado THEN
      divergentes := divergentes || format('%s: esperado %s, obtido %s', c.caso, c.esperado, obtido);
    END IF;
  END LOOP;
  IF cardinality(divergentes) > 0 THEN
    RAISE EXCEPTION E'notificações:\n%', array_to_string(divergentes, E'\n');
  END IF;
END $$;

-- Leitura por pessoa: Um marca o aviso de A; Dois continua com ele não lido
INSERT INTO public.notification_reads (notification_id, user_id)
VALUES ('00000000-0000-4000-8000-000000000502', '00000000-0000-4000-8000-000000000001');

CREATE FUNCTION pg_temp.lidas_como(usuario uuid) RETURNS bigint
LANGUAGE plpgsql AS $$
DECLARE n bigint;
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', usuario, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO n FROM public.notification_reads WHERE notification_id = '00000000-0000-4000-8000-000000000502';
  RESET ROLE;
  RETURN n;
END $$;

DO $$
BEGIN
  IF pg_temp.lidas_como('00000000-0000-4000-8000-000000000001') <> 1 THEN
    RAISE EXCEPTION 'quem marcou o aviso como lido deveria ver a própria leitura';
  END IF;
  IF pg_temp.lidas_como('00000000-0000-4000-8000-000000000002') <> 0 THEN
    RAISE EXCEPTION 'a leitura de uma pessoa não pode marcar o aviso como lido para a colega';
  END IF;
END $$;

-- Conversão da 136 (dados de dados_antes_136.sql): quem já tinha lido continua com lida
DO $$
DECLARE
  obtido text;
BEGIN
  SELECT string_agg(right(notification_id::text, 3) || ':' || right(user_id::text, 1), ',' ORDER BY 1)
    INTO obtido
    FROM public.notification_reads
   WHERE notification_id::text LIKE '00000000-0000-4000-8136-%';
  IF obtido IS DISTINCT FROM '901:1,903:1,903:2' THEN
    RAISE EXCEPTION 'leituras convertidas pela 136: esperado 901:1,903:1,903:2, obtido %', obtido;
  END IF;
END $$;

DO $$
BEGIN
  IF (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.notification_reads'::regclass) IS NOT TRUE THEN
    RAISE EXCEPTION 'notification_reads sem RLS';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables
                  WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'notifications') THEN
    RAISE EXCEPTION 'notifications deveria continuar no realtime';
  END IF;
END $$;
