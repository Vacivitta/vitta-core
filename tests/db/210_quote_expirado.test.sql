INSERT INTO public.tenants (id, nome) VALUES ('00000000-0000-4000-8210-0000000000f0', 'Rede 210');
INSERT INTO public.units (id, tenant_id, nome, tipo) VALUES
  ('00000000-0000-4000-8210-0000000000a0', '00000000-0000-4000-8210-0000000000f0', 'Clínica 210', 'clinica');

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('00000000-0000-4000-8210-000000000003', 'gestor210@teste.invalid', '{"full_name": "Gestor 210"}');
UPDATE public.profiles SET perfil = 'gestor_unidade', unit_id = '00000000-0000-4000-8210-0000000000a0'
 WHERE id = '00000000-0000-4000-8210-000000000003';
INSERT INTO public.user_units (user_id, unit_id)
VALUES ('00000000-0000-4000-8210-000000000003', '00000000-0000-4000-8210-0000000000a0');

-- d1 Novo; d2 Expirou; d3 Perdido (perda); d4 Exige e-mail
INSERT INTO public.funnels (id, nome, unit_id)
VALUES ('00000000-0000-4000-8210-0000000000d0', 'Funil 210', '00000000-0000-4000-8210-0000000000a0');
INSERT INTO public.funnel_stages (id, funnel_id, nome, ordem, resultado, unit_id) VALUES
  ('00000000-0000-4000-8210-0000000000d1', '00000000-0000-4000-8210-0000000000d0', 'Novo',    0, NULL,      '00000000-0000-4000-8210-0000000000a0'),
  ('00000000-0000-4000-8210-0000000000d2', '00000000-0000-4000-8210-0000000000d0', 'Expirou', 1, NULL,      '00000000-0000-4000-8210-0000000000a0'),
  ('00000000-0000-4000-8210-0000000000d3', '00000000-0000-4000-8210-0000000000d0', 'Perdido', 2, 'perdido', '00000000-0000-4000-8210-0000000000a0'),
  ('00000000-0000-4000-8210-0000000000d4', '00000000-0000-4000-8210-0000000000d0', 'Exige e-mail', 3, NULL, '00000000-0000-4000-8210-0000000000a0');
UPDATE public.funnel_stages SET campos_obrigatorios = '{lead:email}' WHERE id = '00000000-0000-4000-8210-0000000000d4';

CREATE FUNCTION pg_temp.id(n int) RETURNS uuid LANGUAGE sql AS $$
  SELECT ('00000000-0000-4000-8210-' || lpad(n::text, 12, '0'))::uuid
$$;

-- Lead 10n e orçamento 40n
CREATE FUNCTION pg_temp.caso(n int, etapa char, com_lead boolean DEFAULT true) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.leads (id, nome, funnel_id, stage_id, unit_id)
  VALUES (pg_temp.id(100 + n), 'Lead 210 ' || n, '00000000-0000-4000-8210-0000000000d0',
          ('00000000-0000-4000-8210-0000000000d' || etapa)::uuid, '00000000-0000-4000-8210-0000000000a0');
  INSERT INTO public.quotes (id, unit_id, lead_id, status)
  VALUES (pg_temp.id(400 + n), '00000000-0000-4000-8210-0000000000a0',
          CASE WHEN com_lead THEN pg_temp.id(100 + n) END, 'enviado');
END $$;

SELECT pg_temp.caso(1, '1');
SELECT pg_temp.caso(2, '2');
SELECT pg_temp.caso(3, '1');
SELECT pg_temp.caso(4, '1');
SELECT pg_temp.caso(5, '1', false);
SELECT pg_temp.caso(6, '1');
SELECT pg_temp.caso(7, '3');

INSERT INTO public.quote_automations (id, unit_id, quote_status, action, stage_id) VALUES
  (pg_temp.id(701), '00000000-0000-4000-8210-0000000000a0', 'expirado', 'move_stage', '00000000-0000-4000-8210-0000000000d2');

-- Expira como o gestor (a página /orcamento roda com a sessão dele)
CREATE FUNCTION pg_temp.expirar_como_gestor(n int) RETURNS text LANGUAGE plpgsql AS $$
DECLARE linhas bigint; orcamento uuid := pg_temp.id(400 + n);
BEGIN
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', '00000000-0000-4000-8210-000000000003', 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  UPDATE public.quotes SET status = 'expirado' WHERE id = orcamento;
  GET DIAGNOSTICS linhas = ROW_COUNT;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '', true);
  RETURN linhas::text;
END $$;
CREATE FUNCTION pg_temp.execucoes(n int) RETURNS text LANGUAGE sql AS $$
  SELECT coalesce(string_agg(format('%s/%s/%s/%s/%s', origem, gatilho, acao, resultado, coalesce(motivo, '-')), ' | '
                             ORDER BY criado_em), 'nenhuma')
    FROM public.automation_runs WHERE lead_id = pg_temp.id(100 + n)
$$;

CREATE FUNCTION pg_temp.esperar(caso text, obtido text, esperado text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF obtido IS DISTINCT FROM esperado THEN
    RAISE EXCEPTION '%: esperado %, obtido %', caso, esperado, obtido;
  END IF;
END $$;

-- Expirar pelo app (gestor) move o lead e grava a execução, sem desfazer a expiração
SELECT pg_temp.esperar('gestor expira o orçamento', pg_temp.expirar_como_gestor(1), '1');
SELECT pg_temp.esperar('expirar move o lead para a etapa da regra',
  (SELECT stage_id::text FROM public.leads WHERE id = pg_temp.id(101)), '00000000-0000-4000-8210-0000000000d2');
SELECT pg_temp.esperar('expirar grava a execução', pg_temp.execucoes(1),
  'evento/quote_expirado/move_stage/etapa_movida/-');
SELECT pg_temp.esperar('detalhe da execução tem de e para',
  (SELECT detalhe::text FROM public.automation_runs WHERE lead_id = pg_temp.id(101)),
  '{"de": "00000000-0000-4000-8210-0000000000d1", "para": "00000000-0000-4000-8210-0000000000d2"}');
SELECT pg_temp.esperar('a execução aponta para a regra',
  (SELECT automation_id::text FROM public.automation_runs WHERE lead_id = pg_temp.id(101)), pg_temp.id(701)::text);

-- Só na passagem para expirado
UPDATE public.quotes SET status = 'expirado' WHERE id = pg_temp.id(401);
SELECT pg_temp.esperar('atualizar um orçamento já expirado não dispara de novo',
  (SELECT count(*)::text FROM public.automation_runs WHERE lead_id = pg_temp.id(101)), '1');

-- Lead já na etapa da regra (pelo cron: service_role)
UPDATE public.quotes SET status = 'expirado' WHERE id = pg_temp.id(402);
SELECT pg_temp.esperar('lead já na etapa', pg_temp.execucoes(2), 'evento/quote_expirado/move_stage/pulado/ja_na_etapa');

-- Regra que arquiva: o lead vira perdido na etapa de perda
UPDATE public.quote_automations SET action = 'archive', stage_id = NULL WHERE id = pg_temp.id(701);
UPDATE public.quotes SET status = 'expirado' WHERE id = pg_temp.id(403);
SELECT pg_temp.esperar('arquivar marca o lead como perdido na etapa de perda',
  (SELECT status || '/' || stage_id FROM public.leads WHERE id = pg_temp.id(103)),
  'perdido/00000000-0000-4000-8210-0000000000d3');
SELECT pg_temp.esperar('arquivar grava lead_perdido', pg_temp.execucoes(3), 'evento/quote_expirado/archive/lead_perdido/-');

UPDATE public.quotes SET status = 'expirado' WHERE id = pg_temp.id(407);
SELECT pg_temp.esperar('lead já perdido', pg_temp.execucoes(7), 'evento/quote_expirado/archive/pulado/ja_perdido');

-- Regra desligada: nada acontece e nada é gravado
UPDATE public.quote_automations SET ativo = false WHERE id = pg_temp.id(701);
UPDATE public.quotes SET status = 'expirado' WHERE id = pg_temp.id(404);
SELECT pg_temp.esperar('regra desligada não grava', pg_temp.execucoes(4), 'nenhuma');
SELECT pg_temp.esperar('regra desligada não mexe no lead',
  (SELECT status || '/' || stage_id FROM public.leads WHERE id = pg_temp.id(104)),
  'aberto/00000000-0000-4000-8210-0000000000d1');

-- Orçamento sem lead
UPDATE public.quote_automations SET ativo = true WHERE id = pg_temp.id(701);
UPDATE public.quotes SET status = 'expirado' WHERE id = pg_temp.id(405);
SELECT pg_temp.esperar('orçamento sem lead expira sem execução',
  (SELECT count(*)::text FROM public.automation_runs WHERE automation_id = pg_temp.id(701) AND lead_id IS NULL), '0');

-- Falha da automação não desfaz a expiração: etapa que exige e-mail, lead sem e-mail, gestor expirando
UPDATE public.quote_automations SET action = 'move_stage', stage_id = '00000000-0000-4000-8210-0000000000d4'
 WHERE id = pg_temp.id(701);
SELECT pg_temp.esperar('gestor expira mesmo com a automação barrada', pg_temp.expirar_como_gestor(6), '1');
SELECT pg_temp.esperar('o orçamento fica expirado',
  (SELECT status FROM public.quotes WHERE id = pg_temp.id(406)), 'expirado');
SELECT pg_temp.esperar('o lead fica onde estava',
  (SELECT stage_id::text FROM public.leads WHERE id = pg_temp.id(106)), '00000000-0000-4000-8210-0000000000d1');
SELECT pg_temp.esperar('a falha fica registrada', pg_temp.execucoes(6), 'evento/quote_expirado/move_stage/falhou/VC001');

DO $$
BEGIN
  IF has_function_privilege('authenticated', 'public.fn_quote_expirado_automacao()', 'EXECUTE')
     OR has_function_privilege('anon', 'public.fn_quote_expirado_automacao()', 'EXECUTE') THEN
    RAISE EXCEPTION 'fn_quote_expirado_automacao executável por authenticated/anon';
  END IF;
END $$;
