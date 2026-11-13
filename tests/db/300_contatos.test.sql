-- Contatos (148): backfill 1:1, espelho do lead, dependentes, conversa, mesclar e RLS.
-- Dados de antes da 148 em dados_antes_148.sql (prefixo 8148).

DO $$
BEGIN
  -- Backfill: cada lead tem um contato com o mesmo id e os mesmos dados de pessoa
  IF EXISTS (SELECT 1 FROM public.leads l LEFT JOIN public.contatos c ON c.id = l.contato_id
              WHERE c.id IS NULL OR l.contato_id <> l.id) THEN
    RAISE EXCEPTION 'todo lead existente deveria ter contato com o mesmo id';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.contatos c
                  WHERE c.id = '00000000-0000-4000-8148-000000000101' AND c.nome = 'Ana' AND c.sobrenome = 'Antiga'
                    AND c.telefone_norm = '5511900001481' AND c.email = 'ana@teste.invalid' AND c.cliente
                    AND c.observacoes = 'gosta de manhã' AND c.wa_optout_at IS NOT NULL) THEN
    RAISE EXCEPTION 'o contato do backfill deveria trazer os dados de pessoa do lead';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.contatos c
                  WHERE c.id = '00000000-0000-4000-8148-000000000201' AND c.responsavel_id = '00000000-0000-4000-8148-000000000101'
                    AND c.nome = 'Filha da Ana' AND c.relacao = 'filha' AND c.unit_id = '00000000-0000-4000-8148-0000000000a0') THEN
    RAISE EXCEPTION 'o dependente deveria virar contato ligado ao responsável';
  END IF;
  IF (SELECT contato_id FROM public.wa_conversations WHERE id = '00000000-0000-4000-8148-000000000301')
     IS DISTINCT FROM '00000000-0000-4000-8148-000000000101' THEN
    RAISE EXCEPTION 'a conversa deveria receber o contato do lead';
  END IF;
END $$;

-- Espelho: lead novo, alteração, transferência, dependente, conversa
INSERT INTO public.leads (id, nome, telefone, funnel_id, unit_id) VALUES
  ('00000000-0000-4000-8148-000000000102', 'Bruno', '(11) 90000-1482', '00000000-0000-4000-8148-0000000000d0', '00000000-0000-4000-8148-0000000000a0');
UPDATE public.leads SET email = 'bruno@teste.invalid', is_converted = true WHERE id = '00000000-0000-4000-8148-000000000102';
INSERT INTO public.lead_contacts (id, lead_id, nome, relacao, unit_id) VALUES
  ('00000000-0000-4000-8148-000000000202', '00000000-0000-4000-8148-000000000102', 'Filho do Bruno', 'filho', '00000000-0000-4000-8148-0000000000a0');
UPDATE public.lead_contacts SET nome = 'Pedrinho' WHERE id = '00000000-0000-4000-8148-000000000202';
INSERT INTO public.wa_conversations (id, unit_id, wa_phone) VALUES
  ('00000000-0000-4000-8148-000000000302', '00000000-0000-4000-8148-0000000000a0', '5511900001482');

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.contatos WHERE id = '00000000-0000-4000-8148-000000000102'
                    AND email = 'bruno@teste.invalid' AND cliente AND telefone_norm = '5511900001482') THEN
    RAISE EXCEPTION 'lead novo e alterado deveria espelhar no contato';
  END IF;
  IF (SELECT contato_id FROM public.leads WHERE id = '00000000-0000-4000-8148-000000000102')
     IS DISTINCT FROM '00000000-0000-4000-8148-000000000102' THEN
    RAISE EXCEPTION 'lead novo recebe contato com o mesmo id';
  END IF;
  IF (SELECT nome FROM public.contatos WHERE id = '00000000-0000-4000-8148-000000000202') <> 'Pedrinho' THEN
    RAISE EXCEPTION 'dependente alterado deveria espelhar';
  END IF;
  IF (SELECT contato_id FROM public.wa_conversations WHERE id = '00000000-0000-4000-8148-000000000302')
     IS DISTINCT FROM '00000000-0000-4000-8148-000000000102' THEN
    RAISE EXCEPTION 'conversa nova ligada pelo telefone deveria receber o contato';
  END IF;

  DELETE FROM public.lead_contacts WHERE id = '00000000-0000-4000-8148-000000000202';
  IF EXISTS (SELECT 1 FROM public.contatos WHERE id = '00000000-0000-4000-8148-000000000202') THEN
    RAISE EXCEPTION 'dependente apagado deveria apagar o contato';
  END IF;

  -- Transferência de unidade: contato e dependentes acompanham
  UPDATE public.leads SET unit_id = '00000000-0000-4000-8148-0000000000b0', funnel_id = '00000000-0000-4000-8148-0000000000d1',
                          stage_id = NULL
   WHERE id = '00000000-0000-4000-8148-000000000101';
  IF (SELECT unit_id FROM public.contatos WHERE id = '00000000-0000-4000-8148-000000000101') <> '00000000-0000-4000-8148-0000000000b0'
     OR (SELECT unit_id FROM public.contatos WHERE id = '00000000-0000-4000-8148-000000000201') <> '00000000-0000-4000-8148-0000000000b0' THEN
    RAISE EXCEPTION 'contato e dependente deveriam seguir o lead para a outra unidade';
  END IF;
  UPDATE public.leads SET unit_id = '00000000-0000-4000-8148-0000000000a0', funnel_id = '00000000-0000-4000-8148-0000000000d0'
   WHERE id = '00000000-0000-4000-8148-000000000101';
END $$;

-- Mesclar: o contato do lead removido some; conversa e dependente vão para o contato mantido
DO $$
BEGIN
  PERFORM public.mesclar_leads('00000000-0000-4000-8148-000000000102', '00000000-0000-4000-8148-000000000101', NULL);
  IF EXISTS (SELECT 1 FROM public.contatos WHERE id = '00000000-0000-4000-8148-000000000101') THEN
    RAISE EXCEPTION 'o contato do lead removido deveria ser apagado';
  END IF;
  IF (SELECT responsavel_id FROM public.contatos WHERE id = '00000000-0000-4000-8148-000000000201')
     IS DISTINCT FROM '00000000-0000-4000-8148-000000000102' THEN
    RAISE EXCEPTION 'o dependente deveria passar para o contato mantido';
  END IF;
  IF (SELECT contato_id FROM public.wa_conversations WHERE id = '00000000-0000-4000-8148-000000000301')
     IS DISTINCT FROM '00000000-0000-4000-8148-000000000102' THEN
    RAISE EXCEPTION 'a conversa do lead removido deveria ir para o contato mantido';
  END IF;
  -- Opt-out é obrigação legal: o do removido passa para o contato mantido
  IF (SELECT wa_optout_at FROM public.contatos WHERE id = '00000000-0000-4000-8148-000000000102') IS NULL THEN
    RAISE EXCEPTION 'o opt-out do lead removido deveria chegar ao contato mantido';
  END IF;

  DELETE FROM public.leads WHERE id = '00000000-0000-4000-8148-000000000102';
  IF EXISTS (SELECT 1 FROM public.contatos WHERE id IN ('00000000-0000-4000-8148-000000000102', '00000000-0000-4000-8148-000000000201')) THEN
    RAISE EXCEPTION 'lead apagado deveria apagar o contato e os dependentes';
  END IF;
  IF (SELECT contato_id FROM public.wa_conversations WHERE id = '00000000-0000-4000-8148-000000000301') IS NOT NULL THEN
    RAISE EXCEPTION 'a conversa fica sem contato quando ele é apagado';
  END IF;
END $$;

-- RLS: lê quem está na unidade; o app não grava contatos ainda
INSERT INTO public.leads (id, nome, telefone, funnel_id, unit_id) VALUES
  ('00000000-0000-4000-8148-000000000103', 'Carla', '(11) 90000-1483', '00000000-0000-4000-8148-0000000000d0', '00000000-0000-4000-8148-0000000000a0');

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
  ('quem está na unidade lê o contato', 'authenticated', '00000000-0000-4000-8148-000000000001',
   $c$SELECT * FROM public.contatos WHERE id = '00000000-0000-4000-8148-000000000103'$c$, '1'),
  ('quem é de outra unidade não lê', 'authenticated', '00000000-0000-4000-8148-000000000002',
   $c$SELECT * FROM public.contatos WHERE id = '00000000-0000-4000-8148-000000000103'$c$, '0'),
  ('o app não muda a unidade do contato (a 149 abre só as colunas de pessoa)', 'authenticated', '00000000-0000-4000-8148-000000000001',
   $c$UPDATE public.contatos SET unit_id = '00000000-0000-4000-8148-0000000000b0' WHERE id = '00000000-0000-4000-8148-000000000103'$c$, 'erro 42501'),
  ('anon não lê', 'anon', NULL, $c$SELECT * FROM public.contatos$c$, 'erro 42501');

-- Alteração feita pelo app (authenticated) fica gravada e espelha no contato
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8148-000000000001", "role": "authenticated"}', false);
SET ROLE authenticated;
UPDATE public.leads SET sobrenome = 'Pelo app' WHERE id = '00000000-0000-4000-8148-000000000103';
RESET ROLE;
SELECT set_config('request.jwt.claims', '', false);

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
    RAISE EXCEPTION 'contatos:%', falhas;
  END IF;
  IF (SELECT sobrenome FROM public.contatos WHERE id = '00000000-0000-4000-8148-000000000103') IS DISTINCT FROM 'Pelo app' THEN
    RAISE EXCEPTION 'o lead alterado pelo app (authenticated) deveria espelhar no contato';
  END IF;
  IF has_function_privilege('authenticated', 'public.fn_lead_contato()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.fn_lead_contato_espelho()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.fn_dependente_contato()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.fn_conversa_contato()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.fn_lead_contato_apaga()', 'EXECUTE') THEN
    RAISE EXCEPTION 'as funções do espelho são só do banco';
  END IF;
END $$;
