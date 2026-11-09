-- Contato gravado pelo app (149): privilégios por coluna, RLS de titular e espelho
-- nos dois sentidos sem laço. Dados fictícios, prefixo 8149.

INSERT INTO public.tenants (id, nome) VALUES ('00000000-0000-4000-8149-0000000000f0', 'Rede 149');
INSERT INTO public.units (id, tenant_id, nome, tipo) VALUES
  ('00000000-0000-4000-8149-0000000000a0', '00000000-0000-4000-8149-0000000000f0', 'Unidade 149 A', 'clinica'),
  ('00000000-0000-4000-8149-0000000000b0', '00000000-0000-4000-8149-0000000000f0', 'Unidade 149 B', 'clinica');
INSERT INTO public.funnels (id, nome, unit_id) VALUES
  ('00000000-0000-4000-8149-0000000000d0', 'Funil 149 A', '00000000-0000-4000-8149-0000000000a0');
INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('00000000-0000-4000-8149-000000000001', 'membro149@teste.invalid', '{"full_name": "Membro"}'),
  ('00000000-0000-4000-8149-000000000002', 'outro149@teste.invalid', '{"full_name": "Outro"}');
INSERT INTO public.user_units (user_id, unit_id) VALUES
  ('00000000-0000-4000-8149-000000000001', '00000000-0000-4000-8149-0000000000a0'),
  ('00000000-0000-4000-8149-000000000002', '00000000-0000-4000-8149-0000000000b0');

INSERT INTO public.leads (id, nome, telefone, email, funnel_id, unit_id) VALUES
  ('00000000-0000-4000-8149-000000000101', 'Ana', '(11) 90000-1491', 'ana@teste.invalid',
   '00000000-0000-4000-8149-0000000000d0', '00000000-0000-4000-8149-0000000000a0'),
  ('00000000-0000-4000-8149-000000000102', 'Bia', '(11) 90000-1492', NULL,
   '00000000-0000-4000-8149-0000000000d0', '00000000-0000-4000-8149-0000000000a0');
INSERT INTO public.lead_contacts (id, lead_id, nome, relacao, unit_id) VALUES
  ('00000000-0000-4000-8149-000000000201', '00000000-0000-4000-8149-000000000101', 'Filho da Ana', 'filho',
   '00000000-0000-4000-8149-0000000000a0');

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
  ('quem está na unidade altera a pessoa do titular', 'authenticated', '00000000-0000-4000-8149-000000000001',
   $c$UPDATE public.contatos SET profissao = 'x' WHERE id = '00000000-0000-4000-8149-000000000101'$c$, '1'),
  ('quem é de outra unidade não altera', 'authenticated', '00000000-0000-4000-8149-000000000002',
   $c$UPDATE public.contatos SET profissao = 'x' WHERE id = '00000000-0000-4000-8149-000000000101'$c$, '0'),
  ('dependente continua só pelo lead_contacts', 'authenticated', '00000000-0000-4000-8149-000000000001',
   $c$UPDATE public.contatos SET nome = 'x' WHERE id = '00000000-0000-4000-8149-000000000201'$c$, '0'),
  ('unidade do contato não é do app', 'authenticated', '00000000-0000-4000-8149-000000000001',
   $c$UPDATE public.contatos SET unit_id = '00000000-0000-4000-8149-0000000000b0' WHERE id = '00000000-0000-4000-8149-000000000101'$c$, 'erro 42501'),
  ('cliente não é do app', 'authenticated', '00000000-0000-4000-8149-000000000001',
   $c$UPDATE public.contatos SET cliente = true WHERE id = '00000000-0000-4000-8149-000000000101'$c$, 'erro 42501'),
  ('responsável não é do app', 'authenticated', '00000000-0000-4000-8149-000000000001',
   $c$UPDATE public.contatos SET responsavel_id = '00000000-0000-4000-8149-000000000102' WHERE id = '00000000-0000-4000-8149-000000000101'$c$, 'erro 42501'),
  ('app não cria contato direto (o lead cria)', 'authenticated', '00000000-0000-4000-8149-000000000001',
   $c$INSERT INTO public.contatos (unit_id, nome) VALUES ('00000000-0000-4000-8149-0000000000a0', 'x')$c$, 'erro 42501'),
  ('app não apaga contato', 'authenticated', '00000000-0000-4000-8149-000000000001',
   $c$DELETE FROM public.contatos WHERE id = '00000000-0000-4000-8149-000000000101'$c$, 'erro 42501'),
  ('telefone repetido na unidade é recusado', 'authenticated', '00000000-0000-4000-8149-000000000001',
   $c$UPDATE public.contatos SET telefone = '11 90000-1492' WHERE id = '00000000-0000-4000-8149-000000000101'$c$, 'erro 23505'),
  ('anon não altera', 'anon', NULL,
   $c$UPDATE public.contatos SET profissao = 'x'$c$, 'erro 42501');

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
    RAISE EXCEPTION 'contato gravado pelo app:%', falhas;
  END IF;
END $$;

-- Gravação real como o app (fora do helper, que desfaz o que faz)
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8149-000000000001", "role": "authenticated"}', false);
SET ROLE authenticated;
UPDATE public.contatos
   SET email = 'ana.nova@teste.invalid', profissao = 'Médica', wa_optout_at = '2026-11-09T12:00:00Z'
 WHERE id = '00000000-0000-4000-8149-000000000101';
UPDATE public.leads SET cidade = 'Itu' WHERE id = '00000000-0000-4000-8149-000000000102';
RESET ROLE;
SELECT set_config('request.jwt.claims', '', false);

DO $$
DECLARE
  l public.leads%ROWTYPE;
BEGIN
  -- contato → lead
  SELECT * INTO l FROM public.leads WHERE id = '00000000-0000-4000-8149-000000000101';
  IF l.email IS DISTINCT FROM 'ana.nova@teste.invalid' OR l.profissao IS DISTINCT FROM 'Médica'
     OR l.wa_optout_at IS NULL THEN
    RAISE EXCEPTION 'a pessoa alterada no contato deveria chegar ao negócio (lead: %, %, %)', l.email, l.profissao, l.wa_optout_at;
  END IF;
  -- lead → contato continua (o webhook, a importação e os obrigatórios ainda gravam no lead)
  IF (SELECT cidade FROM public.contatos WHERE id = '00000000-0000-4000-8149-000000000102') IS DISTINCT FROM 'Itu' THEN
    RAISE EXCEPTION 'a pessoa alterada no lead deveria continuar chegando ao contato';
  END IF;
  -- unidade e cliente do lead seguem para o contato; o contato não muda o is_converted
  UPDATE public.leads SET is_converted = true WHERE id = '00000000-0000-4000-8149-000000000102';
  IF NOT (SELECT cliente FROM public.contatos WHERE id = '00000000-0000-4000-8149-000000000102') THEN
    RAISE EXCEPTION 'is_converted do lead deveria marcar o contato como cliente';
  END IF;
  -- Dependente continua espelhado a partir de lead_contacts
  UPDATE public.lead_contacts SET nome = 'Caio' WHERE id = '00000000-0000-4000-8149-000000000201';
  IF (SELECT nome FROM public.contatos WHERE id = '00000000-0000-4000-8149-000000000201') <> 'Caio' THEN
    RAISE EXCEPTION 'dependente alterado em lead_contacts deveria espelhar no contato';
  END IF;
  -- Os dois lados iguais em todos os leads deste teste
  IF EXISTS (
    SELECT 1 FROM public.leads l2 JOIN public.contatos c2 ON c2.id = l2.contato_id
     WHERE l2.id::text LIKE '00000000-0000-4000-8149-%'
       AND (l2.nome, l2.sobrenome, l2.telefone, l2.email, l2.cidade, l2.profissao, l2.wa_optout_at)
           IS DISTINCT FROM (c2.nome, c2.sobrenome, c2.telefone, c2.email, c2.cidade, c2.profissao, c2.wa_optout_at)) THEN
    RAISE EXCEPTION 'lead e contato deveriam terminar iguais';
  END IF;
  IF has_function_privilege('authenticated', 'public.fn_contato_espelho()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.fn_contato_atualizado()', 'EXECUTE')
     OR has_function_privilege('anon', 'public.fn_contato_espelho()', 'EXECUTE') THEN
    RAISE EXCEPTION 'as funções do espelho são só do banco';
  END IF;
END $$;
