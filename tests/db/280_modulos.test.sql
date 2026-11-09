-- Módulos por unidade (146): padrão, ligar/desligar, criar recusado com o módulo
-- desligado e quem altera.

INSERT INTO public.tenants (id, nome) VALUES ('00000000-0000-4000-8146-0000000000f0', 'Rede 146');
INSERT INTO public.units (id, tenant_id, nome, tipo) VALUES
  ('00000000-0000-4000-8146-0000000000a0', '00000000-0000-4000-8146-0000000000f0', 'Unidade 146', 'clinica');
INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('00000000-0000-4000-8146-000000000001', 'gestor146@teste.invalid', '{"full_name": "Gestor"}'),
  ('00000000-0000-4000-8146-000000000005', 'admin146@teste.invalid', '{"full_name": "Admin"}'),
  ('00000000-0000-4000-8146-000000000009', 'fora146@teste.invalid', '{"full_name": "Fora"}');
UPDATE public.profiles SET perfil = 'gestor_unidade' WHERE id = '00000000-0000-4000-8146-000000000001';
UPDATE public.profiles SET perfil = 'admin' WHERE id = '00000000-0000-4000-8146-000000000005';
INSERT INTO public.user_units (user_id, unit_id) VALUES
  ('00000000-0000-4000-8146-000000000001', '00000000-0000-4000-8146-0000000000a0');

DO $$
DECLARE
  u constant uuid := '00000000-0000-4000-8146-0000000000a0';
BEGIN
  IF NOT (public.modulo_ativo(u, 'orcamentos') AND public.modulo_ativo(u, 'catalogo') AND public.modulo_ativo(u, 'campanhas')) THEN
    RAISE EXCEPTION 'orçamentos, catálogo e campanhas nascem ligados';
  END IF;
  IF public.modulo_ativo(u, 'qrcode') OR public.modulo_ativo(u, 'empresas') OR public.modulo_ativo(u, 'tickets') THEN
    RAISE EXCEPTION 'QR Code, empresas e tickets nascem desligados';
  END IF;

  INSERT INTO public.products (unit_id, nome) VALUES (u, 'Vacina com catálogo ligado');

  INSERT INTO public.unidade_modulos (unit_id, modulo, ativo) VALUES (u, 'catalogo', false);
  BEGIN
    INSERT INTO public.products (unit_id, nome) VALUES (u, 'Vacina com catálogo desligado');
    RAISE EXCEPTION 'criar item no catálogo desligado deveria ser recusado';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  -- Desligar não apaga nem trava o que já existe
  UPDATE public.products SET nome = 'Vacina renomeada' WHERE unit_id = u AND nome = 'Vacina com catálogo ligado';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'o item que já existia continua editável';
  END IF;

  BEGIN
    INSERT INTO public.conexoes (unit_id, tipo, nome, instancia) VALUES (u, 'qrcode', 'QR', 'ci-146');
    RAISE EXCEPTION 'conexão por QR Code com o módulo desligado deveria ser recusada';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  INSERT INTO public.conexoes (unit_id, tipo, nome) VALUES (u, 'oficial', 'Oficial');

  UPDATE public.unidade_modulos SET ativo = true WHERE unit_id = u AND modulo = 'catalogo';
  INSERT INTO public.products (unit_id, nome) VALUES (u, 'Vacina com catálogo religado');

  BEGIN
    INSERT INTO public.unidade_modulos (unit_id, modulo, ativo) VALUES (u, 'agenda', true);
    RAISE EXCEPTION 'módulo fora da lista deveria ser recusado';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
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
  ('gestor da unidade lê os módulos dela', 'authenticated', '00000000-0000-4000-8146-000000000001',
   $c$SELECT * FROM public.unidade_modulos WHERE unit_id = '00000000-0000-4000-8146-0000000000a0'$c$, '1'),
  ('quem é de fora não lê', 'authenticated', '00000000-0000-4000-8146-000000000009',
   $c$SELECT * FROM public.unidade_modulos WHERE unit_id = '00000000-0000-4000-8146-0000000000a0'$c$, '0'),
  ('gestor da unidade não liga módulo', 'authenticated', '00000000-0000-4000-8146-000000000001',
   $c$INSERT INTO public.unidade_modulos (unit_id, modulo, ativo) VALUES ('00000000-0000-4000-8146-0000000000a0', 'tickets', true)$c$, 'erro 42501'),
  ('gestor da unidade não desliga módulo', 'authenticated', '00000000-0000-4000-8146-000000000001',
   $c$UPDATE public.unidade_modulos SET ativo = false WHERE unit_id = '00000000-0000-4000-8146-0000000000a0'$c$, '0'),
  ('a marca liga módulo', 'authenticated', '00000000-0000-4000-8146-000000000005',
   $c$INSERT INTO public.unidade_modulos (unit_id, modulo, ativo) VALUES ('00000000-0000-4000-8146-0000000000a0', 'tickets', true)$c$, '1'),
  ('anon não lê', 'anon', NULL, $c$SELECT * FROM public.unidade_modulos$c$, 'erro 42501');

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
    RAISE EXCEPTION 'módulos:%', falhas;
  END IF;
  IF has_function_privilege('authenticated', 'public.fn_exige_modulo()', 'EXECUTE')
     OR has_function_privilege('anon', 'public.modulo_ativo(uuid,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'fn_exige_modulo só para o servidor; modulo_ativo nunca para anon';
  END IF;
END $$;
