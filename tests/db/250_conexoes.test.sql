-- Conexões (143): backfill, conversa da conexão e conexão pessoal (ADR 0007).
-- Usa os dados de dados_antes_143.sql (prefixo 8143).

DO $$
BEGIN
  IF (SELECT count(*) FROM public.conexoes
       WHERE unit_id = '00000000-0000-4000-8143-0000000000a0' AND tipo = 'oficial'
         AND wa_config_id = '00000000-0000-4000-8143-0000000000e0'
         AND status = 'conectada' AND ativo AND numero = '+55 11 4000-0143') <> 1 THEN
    RAISE EXCEPTION 'a 143 deveria criar a conexão oficial conectada da unidade A a partir do wa_config';
  END IF;
  IF (SELECT count(*) FROM public.conexoes
       WHERE unit_id = '00000000-0000-4000-8143-0000000000c0' AND tipo = 'oficial'
         AND wa_config_id IS NULL AND status = 'desconectada' AND NOT ativo) <> 1 THEN
    RAISE EXCEPTION 'unidade com conversa e sem wa_config deveria ganhar uma conexão oficial desconectada';
  END IF;
  IF EXISTS (SELECT 1 FROM public.wa_conversations wc
              WHERE wc.id::text LIKE '00000000-0000-4000-8143-%'
                AND NOT EXISTS (SELECT 1 FROM public.conexoes c
                                 WHERE c.id = wc.conexao_id AND c.unit_id = wc.unit_id AND c.tipo = 'oficial')) THEN
    RAISE EXCEPTION 'toda conversa existente deveria ficar na conexão oficial da sua unidade';
  END IF;
END $$;

-- Módulo QR Code (146) ligado na unidade A
INSERT INTO public.unidade_modulos (unit_id, modulo, ativo) VALUES ('00000000-0000-4000-8143-0000000000a0', 'qrcode', true);

-- Usuários: 1 e 2 na unidade A (1 é a dona da conexão pessoal); 3 fora; 5 admin da marca
INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('00000000-0000-4000-8143-000000000001', 'dona143@teste.invalid', '{"full_name": "Dona"}'),
  ('00000000-0000-4000-8143-000000000002', 'colega143@teste.invalid', '{"full_name": "Colega"}'),
  ('00000000-0000-4000-8143-000000000003', 'fora143@teste.invalid', '{"full_name": "Fora"}'),
  ('00000000-0000-4000-8143-000000000005', 'admin143@teste.invalid', '{"full_name": "Admin"}');
UPDATE public.profiles SET perfil = 'admin' WHERE id = '00000000-0000-4000-8143-000000000005';
UPDATE public.profiles SET perfil = 'gestor_unidade' WHERE id = '00000000-0000-4000-8143-000000000002';
INSERT INTO public.user_units (user_id, unit_id) VALUES
  ('00000000-0000-4000-8143-000000000001', '00000000-0000-4000-8143-0000000000a0'),
  ('00000000-0000-4000-8143-000000000002', '00000000-0000-4000-8143-0000000000a0'),
  ('00000000-0000-4000-8143-000000000003', '00000000-0000-4000-8143-0000000000c0');

-- Validações da conexão
DO $$
BEGIN
  BEGIN
    INSERT INTO public.conexoes (unit_id, tipo, nome, pessoal)
    VALUES ('00000000-0000-4000-8143-0000000000a0', 'qrcode', 'Sem dona', true);
    RAISE EXCEPTION 'conexão pessoal sem dona deveria ser recusada';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO public.conexoes (unit_id, tipo, nome, pessoal, dona_id)
    VALUES ('00000000-0000-4000-8143-0000000000a0', 'oficial', 'Oficial pessoal', true, '00000000-0000-4000-8143-000000000001');
    RAISE EXCEPTION 'conexão pessoal só pode ser por QR Code';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO public.conexoes (unit_id, tipo, nome, pessoal, dona_id)
    VALUES ('00000000-0000-4000-8143-0000000000a0', 'qrcode', 'Dona de fora', true, '00000000-0000-4000-8143-000000000003');
    RAISE EXCEPTION 'dona fora da unidade deveria ser recusada (23514)';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO public.conexoes (unit_id, tipo, nome) VALUES ('00000000-0000-4000-8143-0000000000a0', 'oficial', 'Segunda oficial');
    RAISE EXCEPTION 'a unidade só pode ter uma conexão oficial';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
END $$;

INSERT INTO public.conexoes (id, unit_id, tipo, nome, numero, pessoal, dona_id, instancia, status) VALUES
  ('00000000-0000-4000-8143-0000000000d1', '00000000-0000-4000-8143-0000000000a0', 'qrcode', 'WhatsApp da Dona',
   '+55 11 98888-0143', true, '00000000-0000-4000-8143-000000000001', 'ci-143-dona', 'conectada');

-- Conversa nova sem conexão vai para a oficial; conexão de outra unidade é recusada
INSERT INTO public.wa_conversations (id, unit_id, wa_phone) VALUES
  ('00000000-0000-4000-8143-000000000104', '00000000-0000-4000-8143-0000000000a0', '5511900000104');
INSERT INTO public.wa_conversations (id, unit_id, wa_phone, conexao_id) VALUES
  ('00000000-0000-4000-8143-000000000201', '00000000-0000-4000-8143-0000000000a0', '5511900000201',
   '00000000-0000-4000-8143-0000000000d1');
INSERT INTO public.wa_messages (conversation_id, unit_id, direction, content) VALUES
  ('00000000-0000-4000-8143-000000000201', '00000000-0000-4000-8143-0000000000a0', 'inbound', 'mensagem no número pessoal'),
  ('00000000-0000-4000-8143-000000000101', '00000000-0000-4000-8143-0000000000a0', 'inbound', 'mensagem no número oficial');
INSERT INTO public.wa_internal_notes (conversation_id, unit_id, content, author_id) VALUES
  ('00000000-0000-4000-8143-000000000201', '00000000-0000-4000-8143-0000000000a0', 'nota da dona',
   '00000000-0000-4000-8143-000000000001');

DO $$
BEGIN
  IF (SELECT c.tipo FROM public.wa_conversations wc JOIN public.conexoes c ON c.id = wc.conexao_id
       WHERE wc.id = '00000000-0000-4000-8143-000000000104') <> 'oficial' THEN
    RAISE EXCEPTION 'conversa inserida sem conexão (app de hoje) deveria ir para a oficial da unidade';
  END IF;
  BEGIN
    INSERT INTO public.wa_conversations (unit_id, wa_phone, conexao_id) VALUES
      ('00000000-0000-4000-8143-0000000000c0', '5511900000999', '00000000-0000-4000-8143-0000000000d1');
    RAISE EXCEPTION 'conversa com conexão de outra unidade deveria ser recusada';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END $$;

-- wa_config novo cria a conexão oficial da unidade
INSERT INTO public.units (id, tenant_id, nome, tipo) VALUES
  ('00000000-0000-4000-8143-0000000000b0', '00000000-0000-4000-8143-0000000000f0', 'Unidade 143 B', 'clinica');
INSERT INTO public.wa_config (unit_id, phone_number_id, access_token, display_phone, is_active) VALUES
  ('00000000-0000-4000-8143-0000000000b0', '1430000002', 'token-ficticio', '+55 11 4000-0002', true);
UPDATE public.wa_config SET is_active = false WHERE unit_id = '00000000-0000-4000-8143-0000000000a0';

DO $$
BEGIN
  IF (SELECT count(*) FROM public.conexoes
       WHERE unit_id = '00000000-0000-4000-8143-0000000000b0' AND tipo = 'oficial' AND status = 'conectada'
         AND wa_config_id IS NOT NULL) <> 1 THEN
    RAISE EXCEPTION 'wa_config novo deveria criar a conexão oficial da unidade';
  END IF;
  IF (SELECT ativo OR status <> 'desconectada' FROM public.conexoes
       WHERE unit_id = '00000000-0000-4000-8143-0000000000a0' AND tipo = 'oficial') THEN
    RAISE EXCEPTION 'desativar o wa_config deveria desconectar a conexão oficial';
  END IF;
END $$;

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
  ('dona vê a conversa do número pessoal', 'authenticated', '00000000-0000-4000-8143-000000000001',
   $c$SELECT * FROM public.wa_conversations WHERE id = '00000000-0000-4000-8143-000000000201'$c$, '1'),
  ('gestor da unidade não vê a conversa do número pessoal', 'authenticated', '00000000-0000-4000-8143-000000000002',
   $c$SELECT * FROM public.wa_conversations WHERE id = '00000000-0000-4000-8143-000000000201'$c$, '0'),
  ('admin da marca vê a conversa do número pessoal', 'authenticated', '00000000-0000-4000-8143-000000000005',
   $c$SELECT * FROM public.wa_conversations WHERE id = '00000000-0000-4000-8143-000000000201'$c$, '1'),
  ('gestor vê as conversas do número oficial (3 da unidade A)', 'authenticated', '00000000-0000-4000-8143-000000000002',
   $c$SELECT * FROM public.wa_conversations WHERE unit_id = '00000000-0000-4000-8143-0000000000a0'$c$, '3'),
  ('dona vê as 4 da unidade A', 'authenticated', '00000000-0000-4000-8143-000000000001',
   $c$SELECT * FROM public.wa_conversations WHERE unit_id = '00000000-0000-4000-8143-0000000000a0'$c$, '4'),
  ('gestor não lê as mensagens do número pessoal', 'authenticated', '00000000-0000-4000-8143-000000000002',
   $c$SELECT * FROM public.wa_messages WHERE conversation_id = '00000000-0000-4000-8143-000000000201'$c$, '0'),
  ('dona lê as mensagens do número pessoal', 'authenticated', '00000000-0000-4000-8143-000000000001',
   $c$SELECT * FROM public.wa_messages WHERE conversation_id = '00000000-0000-4000-8143-000000000201'$c$, '1'),
  ('gestor lê as mensagens do número oficial', 'authenticated', '00000000-0000-4000-8143-000000000002',
   $c$SELECT * FROM public.wa_messages WHERE conversation_id = '00000000-0000-4000-8143-000000000101'$c$, '1'),
  ('gestor não lê a nota da conversa pessoal', 'authenticated', '00000000-0000-4000-8143-000000000002',
   $c$SELECT * FROM public.wa_internal_notes WHERE conversation_id = '00000000-0000-4000-8143-000000000201'$c$, '0'),
  ('gestor não altera a conversa pessoal', 'authenticated', '00000000-0000-4000-8143-000000000002',
   $c$UPDATE public.wa_conversations SET status = 'resolved' WHERE id = '00000000-0000-4000-8143-000000000201'$c$, '0'),
  ('gestor não grava mensagem na conversa pessoal', 'authenticated', '00000000-0000-4000-8143-000000000002',
   $c$INSERT INTO public.wa_messages (conversation_id, unit_id, direction, content) VALUES ('00000000-0000-4000-8143-000000000201', '00000000-0000-4000-8143-0000000000a0', 'outbound', 'x')$c$, 'erro 42501'),
  ('gestor não cria conversa no número pessoal', 'authenticated', '00000000-0000-4000-8143-000000000002',
   $c$INSERT INTO public.wa_conversations (unit_id, wa_phone, conexao_id) VALUES ('00000000-0000-4000-8143-0000000000a0', '5511900000777', '00000000-0000-4000-8143-0000000000d1')$c$, 'erro 42501'),
  ('dona grava mensagem na própria conversa', 'authenticated', '00000000-0000-4000-8143-000000000001',
   $c$INSERT INTO public.wa_messages (conversation_id, unit_id, direction, content) VALUES ('00000000-0000-4000-8143-000000000201', '00000000-0000-4000-8143-0000000000a0', 'outbound', 'x')$c$, '1'),
  ('quem é de fora não vê a conexão da unidade A', 'authenticated', '00000000-0000-4000-8143-000000000003',
   $c$SELECT * FROM public.conexoes WHERE unit_id = '00000000-0000-4000-8143-0000000000a0'$c$, '0'),
  ('gestor vê as conexões da unidade (a pessoal aparece, as conversas não)', 'authenticated', '00000000-0000-4000-8143-000000000002',
   $c$SELECT * FROM public.conexoes WHERE unit_id = '00000000-0000-4000-8143-0000000000a0'$c$, '2'),
  ('gestor não cria conexão direto (só o service_role)', 'authenticated', '00000000-0000-4000-8143-000000000002',
   $c$INSERT INTO public.conexoes (unit_id, tipo, nome, instancia) VALUES ('00000000-0000-4000-8143-0000000000a0', 'qrcode', 'x', 'x')$c$, 'erro 42501'),
  ('anon não lê conexões', 'anon', NULL,
   $c$SELECT * FROM public.conexoes$c$, 'erro 42501');

DO $$
DECLARE
  r record;
  obtido text;
  falhas text := '';
BEGIN
  FOR r IN SELECT * FROM casos ORDER BY ordem LOOP
    obtido := pg_temp.linhas_afetadas_como(r.papel, r.usuario, r.comando);
    IF obtido IS DISTINCT FROM r.esperado THEN
      falhas := falhas || format(E'\n  %s: esperado %s, obtido %s', r.caso, r.esperado, obtido);
    END IF;
  END LOOP;
  IF falhas <> '' THEN
    RAISE EXCEPTION 'conexões:%', falhas;
  END IF;
END $$;
