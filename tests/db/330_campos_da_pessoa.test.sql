-- Campos da pessoa e do negócio (151): objeto do campo, contatos.campos validado,
-- lead novo leva os campos da pessoa ao contato, obrigatórios leem o contato e o
-- quadro vê os dois. Dados fictícios, prefixo 8151.

INSERT INTO public.tenants (id, nome) VALUES ('00000000-0000-4000-8151-0000000000f0', 'Rede 151');
INSERT INTO public.units (id, tenant_id, nome, tipo) VALUES
  ('00000000-0000-4000-8151-0000000000a0', '00000000-0000-4000-8151-0000000000f0', 'Unidade 151', 'clinica');
INSERT INTO public.funnels (id, nome, unit_id) VALUES
  ('00000000-0000-4000-8151-0000000000d0', 'Funil 151', '00000000-0000-4000-8151-0000000000a0');
INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('00000000-0000-4000-8151-000000000001', 'membro151@teste.invalid', '{"full_name": "Membro"}');
INSERT INTO public.user_units (user_id, unit_id) VALUES
  ('00000000-0000-4000-8151-000000000001', '00000000-0000-4000-8151-0000000000a0');

INSERT INTO public.campos_lead (id, unit_id, objeto, rotulo, tipo, opcoes) VALUES
  ('00000000-0000-4000-8151-0000000000c1', '00000000-0000-4000-8151-0000000000a0', 'contato', 'Convênio', 'selecao', '["Unimed", "Particular"]'),
  ('00000000-0000-4000-8151-0000000000c2', '00000000-0000-4000-8151-0000000000a0', 'negocio', 'Vacina de interesse', 'texto', NULL);

INSERT INTO public.funnel_stages (id, funnel_id, nome, ordem, unit_id, campos_obrigatorios) VALUES
  ('00000000-0000-4000-8151-0000000000e0', '00000000-0000-4000-8151-0000000000d0', 'Novo', 0, '00000000-0000-4000-8151-0000000000a0', '{}'),
  ('00000000-0000-4000-8151-0000000000e1', '00000000-0000-4000-8151-0000000000d0', 'Agendado', 1, '00000000-0000-4000-8151-0000000000a0', '{convenio}');

-- Lead novo trazendo os dois campos: o da pessoa vai para o contato
INSERT INTO public.leads (id, nome, telefone, funnel_id, stage_id, unit_id, campos) VALUES
  ('00000000-0000-4000-8151-000000000101', 'Ana', '(11) 90000-1511', '00000000-0000-4000-8151-0000000000d0',
   '00000000-0000-4000-8151-0000000000e0', '00000000-0000-4000-8151-0000000000a0',
   '{"convenio": "Unimed", "vacina_de_interesse": "Gripe"}');
-- Outro negócio da mesma pessoa trazendo outro convênio: o que o contato já tem vence
INSERT INTO public.leads (id, nome, telefone, funnel_id, stage_id, unit_id, campos) VALUES
  ('00000000-0000-4000-8151-000000000102', 'Ana', '11 900001511', '00000000-0000-4000-8151-0000000000d0',
   '00000000-0000-4000-8151-0000000000e0', '00000000-0000-4000-8151-0000000000a0',
   '{"convenio": "Particular"}');
-- Pessoa sem convênio, para o obrigatório
INSERT INTO public.leads (id, nome, telefone, funnel_id, stage_id, unit_id) VALUES
  ('00000000-0000-4000-8151-000000000103', 'Bia', '(11) 90000-1512', '00000000-0000-4000-8151-0000000000d0',
   '00000000-0000-4000-8151-0000000000e0', '00000000-0000-4000-8151-0000000000a0');

DO $$
BEGIN
  IF (SELECT campos FROM public.leads WHERE id = '00000000-0000-4000-8151-000000000101')
     IS DISTINCT FROM '{"vacina_de_interesse": "Gripe"}'::jsonb THEN
    RAISE EXCEPTION 'o negócio deveria ficar só com o campo do negócio';
  END IF;
  IF (SELECT campos FROM public.contatos WHERE id = '00000000-0000-4000-8151-000000000101')
     IS DISTINCT FROM '{"convenio": "Unimed"}'::jsonb THEN
    RAISE EXCEPTION 'o campo da pessoa deveria ir para o contato';
  END IF;
  IF (SELECT campos FROM public.leads WHERE id = '00000000-0000-4000-8151-000000000102') <> '{}'::jsonb THEN
    RAISE EXCEPTION 'o 2º negócio não deveria guardar o campo da pessoa';
  END IF;
  IF (SELECT campos ->> 'convenio' FROM public.leads_kanban WHERE id = '00000000-0000-4000-8151-000000000102') <> 'Unimed' THEN
    RAISE EXCEPTION 'o quadro deveria ver o campo da pessoa (o que o contato já tinha vence)';
  END IF;
  IF (SELECT campos ->> 'vacina_de_interesse' FROM public.leads_kanban WHERE id = '00000000-0000-4000-8151-000000000101') <> 'Gripe' THEN
    RAISE EXCEPTION 'o quadro deveria continuar vendo o campo do negócio';
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
  ('o app grava campo da pessoa no contato', 'authenticated', '00000000-0000-4000-8151-000000000001',
   $c$UPDATE public.contatos SET campos = '{"convenio": "Particular"}' WHERE id = '00000000-0000-4000-8151-000000000103'$c$, '1'),
  ('valor fora das opções é recusado no contato', 'authenticated', '00000000-0000-4000-8151-000000000001',
   $c$UPDATE public.contatos SET campos = '{"convenio": "Outro"}' WHERE id = '00000000-0000-4000-8151-000000000103'$c$, 'erro 23514'),
  ('campo do negócio não vai no contato', 'authenticated', '00000000-0000-4000-8151-000000000001',
   $c$UPDATE public.contatos SET campos = '{"vacina_de_interesse": "x"}' WHERE id = '00000000-0000-4000-8151-000000000103'$c$, 'erro 23514'),
  ('campo da pessoa não é gravado no negócio depois de criado', 'authenticated', '00000000-0000-4000-8151-000000000001',
   $c$UPDATE public.leads SET campos = '{"convenio": "Unimed"}' WHERE id = '00000000-0000-4000-8151-000000000103'$c$, 'erro 23514'),
  ('etapa que exige campo da pessoa vazio no contato recusa', 'authenticated', '00000000-0000-4000-8151-000000000001',
   $c$UPDATE public.leads SET stage_id = '00000000-0000-4000-8151-0000000000e1' WHERE id = '00000000-0000-4000-8151-000000000103'$c$, 'erro VC001'),
  ('etapa que exige campo da pessoa preenchido no contato aceita', 'authenticated', '00000000-0000-4000-8151-000000000001',
   $c$UPDATE public.leads SET stage_id = '00000000-0000-4000-8151-0000000000e1' WHERE id = '00000000-0000-4000-8151-000000000101'$c$, '1'),
  ('campo da pessoa não tem funil', 'supabase_admin', NULL,
   $c$INSERT INTO public.campos_lead (unit_id, funnel_id, objeto, rotulo, tipo) VALUES
      ('00000000-0000-4000-8151-0000000000a0', '00000000-0000-4000-8151-0000000000d0', 'contato', 'Alergia', 'texto')$c$, 'erro 23514'),
  ('o campo não troca de pessoa para negócio', 'supabase_admin', NULL,
   $c$UPDATE public.campos_lead SET objeto = 'negocio' WHERE id = '00000000-0000-4000-8151-0000000000c1'$c$, 'erro 23514');

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
    RAISE EXCEPTION 'campos da pessoa:%', falhas;
  END IF;
  IF has_function_privilege('authenticated', 'public.fn_contato_campos()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.fn_lead_contato()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.fn_lead_obrigatorios()', 'EXECUTE') THEN
    RAISE EXCEPTION 'as funções da 151 são só do banco';
  END IF;
  IF NOT has_column_privilege('authenticated', 'public.contatos', 'campos', 'UPDATE') THEN
    RAISE EXCEPTION 'o app deveria poder gravar contatos.campos';
  END IF;
END $$;
