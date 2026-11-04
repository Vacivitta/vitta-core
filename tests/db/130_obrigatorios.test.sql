-- Campos obrigatórios por etapa (migração 130).

\set fixos `cat /testes/obrigatorios_fixos.json`

CREATE FUNCTION pg_temp.esperar(caso text, obtido text, esperado text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF obtido IS DISTINCT FROM esperado THEN
    RAISE EXCEPTION '%: esperado %, obtido %', caso, esperado, obtido;
  END IF;
END $$;

-- Roda o comando com o papel e o usuário dados e MANTÉM o efeito. Devolve as
-- linhas afetadas ou 'erro <sqlstate>'; com detalhe, também a mensagem e o HINT.
CREATE FUNCTION pg_temp.como(papel text, usuario uuid, comando text, detalhe boolean DEFAULT false) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE
  linhas bigint;
  resultado text;
  msg text;
  dica text;
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', usuario, 'role', papel)::text, true);
  EXECUTE format('SET LOCAL ROLE %I', papel);
  BEGIN
    EXECUTE comando;
    GET DIAGNOSTICS linhas = ROW_COUNT;
    resultado := linhas::text;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS msg = MESSAGE_TEXT, dica = PG_EXCEPTION_HINT;
    resultado := 'erro ' || SQLSTATE || CASE WHEN detalhe THEN ' | ' || msg || ' | ' || dica ELSE '' END;
  END;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '', true);
  RETURN resultado;
END $$;

-- ── Lista de campos fixos: a mesma de src/lib/obrigatorios.ts ────────────────
CREATE TEMP TABLE fixos_json AS SELECT :'fixos'::jsonb AS j;

SELECT pg_temp.esperar('campos_fixos_lead() igual a tests/db/obrigatorios_fixos.json',
  (SELECT jsonb_agg(jsonb_build_object('chave', chave, 'rotulo', rotulo) ORDER BY ordem)::text
     FROM public.campos_fixos_lead()),
  (SELECT j::text FROM fixos_json));

-- ── Cenário ──────────────────────────────────────────────────────────────────
INSERT INTO public.tenants (id, nome) VALUES ('00000000-0000-4000-8130-0000000000f0', 'Rede Obrigatórios');
INSERT INTO public.units (id, tenant_id, nome, tipo) VALUES
  ('00000000-0000-4000-8130-0000000000a0', '00000000-0000-4000-8130-0000000000f0', 'Unidade A', 'comercial');

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('00000000-0000-4000-8130-000000000001', 'ob-atendente@teste.invalid', '{"full_name": "Atendente"}'),
  ('00000000-0000-4000-8130-000000000002', 'ob-gestor@teste.invalid', '{"full_name": "Gestor"}');
UPDATE public.profiles SET
  unit_id = '00000000-0000-4000-8130-0000000000a0',
  perfil  = CASE id WHEN '00000000-0000-4000-8130-000000000001' THEN 'atendente' ELSE 'gestor_unidade' END
 WHERE id::text LIKE '00000000-0000-4000-8130-00000000000_';
INSERT INTO public.user_units (user_id, unit_id) VALUES
  ('00000000-0000-4000-8130-000000000001', '00000000-0000-4000-8130-0000000000a0'),
  ('00000000-0000-4000-8130-000000000002', '00000000-0000-4000-8130-0000000000a0');

INSERT INTO public.funnels (id, nome, unit_id) VALUES
  ('00000000-0000-4000-8130-0000000000d0', 'Licenças', '00000000-0000-4000-8130-0000000000a0'),
  ('00000000-0000-4000-8130-0000000000d1', 'Empresas', '00000000-0000-4000-8130-0000000000a0');
INSERT INTO public.funnel_stages (id, funnel_id, nome, ordem, resultado, unit_id) VALUES
  ('00000000-0000-4000-8130-0000000000c0', '00000000-0000-4000-8130-0000000000d0', 'Novo', 0, NULL, '00000000-0000-4000-8130-0000000000a0'),
  ('00000000-0000-4000-8130-0000000000c1', '00000000-0000-4000-8130-0000000000d0', 'Orçamento enviado', 1, NULL, '00000000-0000-4000-8130-0000000000a0'),
  ('00000000-0000-4000-8130-0000000000c2', '00000000-0000-4000-8130-0000000000d0', 'Contrato assinado', 2, 'ganho', '00000000-0000-4000-8130-0000000000a0'),
  ('00000000-0000-4000-8130-0000000000c3', '00000000-0000-4000-8130-0000000000d0', 'Perdido', 3, 'perdido', '00000000-0000-4000-8130-0000000000a0'),
  ('00000000-0000-4000-8130-0000000000c4', '00000000-0000-4000-8130-0000000000d0', 'Tudo', 4, NULL, '00000000-0000-4000-8130-0000000000a0'),
  ('00000000-0000-4000-8130-0000000000c5', '00000000-0000-4000-8130-0000000000d1', 'Novo', 0, NULL, '00000000-0000-4000-8130-0000000000a0');

SELECT pg_temp.esperar('etapa nasce sem exigências',
  (SELECT campos_obrigatorios::text FROM public.funnel_stages WHERE id = '00000000-0000-4000-8130-0000000000c0'), '{}');

INSERT INTO public.campos_lead (unit_id, funnel_id, rotulo, tipo, opcoes, ordem, ativo) VALUES
  ('00000000-0000-4000-8130-0000000000a0', NULL, 'Vacinas de interesse', 'multipla', '["Gripe", "HPV"]', 1, true),
  ('00000000-0000-4000-8130-0000000000a0', NULL, 'Cidade pretendida', 'texto', NULL, 2, true),
  ('00000000-0000-4000-8130-0000000000a0', NULL, 'Capital disponível', 'moeda', NULL, 3, true),
  ('00000000-0000-4000-8130-0000000000a0', NULL, 'Antigo', 'texto', NULL, 4, false),
  ('00000000-0000-4000-8130-0000000000a0', '00000000-0000-4000-8130-0000000000d1', 'CNPJ', 'texto', NULL, 5, true);

INSERT INTO public.leads (id, nome, funnel_id, stage_id, unit_id) VALUES
  ('00000000-0000-4000-8130-000000000101', 'Lead Um', '00000000-0000-4000-8130-0000000000d0', '00000000-0000-4000-8130-0000000000c0', '00000000-0000-4000-8130-0000000000a0'),
  ('00000000-0000-4000-8130-000000000102', 'Lead Dois', '00000000-0000-4000-8130-0000000000d0', '00000000-0000-4000-8130-0000000000c0', '00000000-0000-4000-8130-0000000000a0'),
  ('00000000-0000-4000-8130-000000000103', 'Lead Três', '00000000-0000-4000-8130-0000000000d0', '00000000-0000-4000-8130-0000000000c0', '00000000-0000-4000-8130-0000000000a0'),
  ('00000000-0000-4000-8130-000000000104', 'Lead Quatro', '00000000-0000-4000-8130-0000000000d0', '00000000-0000-4000-8130-0000000000c0', '00000000-0000-4000-8130-0000000000a0');

-- ── Configuração ─────────────────────────────────────────────────────────────
SELECT pg_temp.esperar('gestor exige e-mail e vacinas (repetido sai)',
  pg_temp.como('authenticated', '00000000-0000-4000-8130-000000000002', $c$
    UPDATE public.funnel_stages SET campos_obrigatorios = '{lead:email,vacinas_de_interesse,lead:email}'
     WHERE id = '00000000-0000-4000-8130-0000000000c1'$c$), '1');
SELECT pg_temp.esperar('lista gravada sem repetição, na ordem',
  (SELECT campos_obrigatorios::text FROM public.funnel_stages WHERE id = '00000000-0000-4000-8130-0000000000c1'),
  '{lead:email,vacinas_de_interesse}');
SELECT pg_temp.esperar('gestor exige cidade pretendida e capital na etapa de ganho',
  pg_temp.como('authenticated', '00000000-0000-4000-8130-000000000002', $c$
    UPDATE public.funnel_stages SET campos_obrigatorios = '{cidade_pretendida,capital_disponivel}'
     WHERE id = '00000000-0000-4000-8130-0000000000c2'$c$), '1');

SELECT pg_temp.esperar('atendente não altera a configuração (RLS filtra a linha)',
  pg_temp.como('authenticated', '00000000-0000-4000-8130-000000000001', $c$
    UPDATE public.funnel_stages SET campos_obrigatorios = '{}'
     WHERE id = '00000000-0000-4000-8130-0000000000c1'$c$), '0');
SELECT pg_temp.esperar('exigências seguem depois da tentativa do atendente',
  (SELECT campos_obrigatorios::text FROM public.funnel_stages WHERE id = '00000000-0000-4000-8130-0000000000c1'),
  '{lead:email,vacinas_de_interesse}');

SELECT pg_temp.esperar('chave inexistente na unidade',
  pg_temp.como('authenticated', '00000000-0000-4000-8130-000000000002', $c$
    UPDATE public.funnel_stages SET campos_obrigatorios = '{nao_existe}'
     WHERE id = '00000000-0000-4000-8130-0000000000c0'$c$), 'erro 23514');
SELECT pg_temp.esperar('campo fixo desconhecido',
  pg_temp.como('authenticated', '00000000-0000-4000-8130-000000000002', $c$
    UPDATE public.funnel_stages SET campos_obrigatorios = '{lead:instagram}'
     WHERE id = '00000000-0000-4000-8130-0000000000c0'$c$), 'erro 23514');
SELECT pg_temp.esperar('campo de outro funil',
  pg_temp.como('authenticated', '00000000-0000-4000-8130-000000000002', $c$
    UPDATE public.funnel_stages SET campos_obrigatorios = '{cnpj}'
     WHERE id = '00000000-0000-4000-8130-0000000000c0'$c$), 'erro 23514');
SELECT pg_temp.esperar('campo do próprio funil vale',
  pg_temp.como('authenticated', '00000000-0000-4000-8130-000000000002', $c$
    UPDATE public.funnel_stages SET campos_obrigatorios = '{cnpj}'
     WHERE id = '00000000-0000-4000-8130-0000000000c5'$c$), '1');
SELECT pg_temp.esperar('campo desativado não entra na lista',
  pg_temp.como('authenticated', '00000000-0000-4000-8130-000000000002', $c$
    UPDATE public.funnel_stages SET campos_obrigatorios = '{antigo}'
     WHERE id = '00000000-0000-4000-8130-0000000000c0'$c$), 'erro 23514');
SELECT pg_temp.esperar('etapa de perda não exige nada',
  pg_temp.como('authenticated', '00000000-0000-4000-8130-000000000002', $c$
    UPDATE public.funnel_stages SET campos_obrigatorios = '{lead:email}'
     WHERE id = '00000000-0000-4000-8130-0000000000c3'$c$), 'erro 23514');
SELECT pg_temp.esperar('virar etapa de perda com exigências é recusado',
  pg_temp.como('authenticated', '00000000-0000-4000-8130-000000000002', $c$
    UPDATE public.funnel_stages SET resultado = 'perdido'
     WHERE id = '00000000-0000-4000-8130-0000000000c1'$c$), 'erro 23514');
SELECT pg_temp.esperar('virar etapa de perda limpando as exigências passa',
  pg_temp.como('authenticated', '00000000-0000-4000-8130-000000000002', $c$
    UPDATE public.funnel_stages SET resultado = 'perdido', campos_obrigatorios = '{}'
     WHERE id = '00000000-0000-4000-8130-0000000000c4'$c$), '1');
SELECT pg_temp.esperar('nova etapa de perda já com exigências é recusada',
  pg_temp.como('service_role', NULL, $c$
    INSERT INTO public.funnel_stages (funnel_id, nome, ordem, resultado, campos_obrigatorios, unit_id) VALUES
      ('00000000-0000-4000-8130-0000000000d0', 'Perdido 2', 9, 'perdido', '{lead:email}',
       '00000000-0000-4000-8130-0000000000a0')$c$), 'erro 23514');
UPDATE public.funnel_stages SET resultado = NULL WHERE id = '00000000-0000-4000-8130-0000000000c4';

-- ── Humano entrando na etapa ─────────────────────────────────────────────────
SELECT pg_temp.esperar('humano move lead vazio: erro com rótulos e chaves',
  pg_temp.como('authenticated', '00000000-0000-4000-8130-000000000001', $c$
    UPDATE public.leads SET stage_id = '00000000-0000-4000-8130-0000000000c1'
     WHERE id = '00000000-0000-4000-8130-000000000101'$c$, true),
  'erro VC001 | Para entrar na etapa "Orçamento enviado", preencha: E-mail, Vacinas de interesse'
  || ' | {"etapa_id": "00000000-0000-4000-8130-0000000000c1", "faltando": ["lead:email", "vacinas_de_interesse"]}');
SELECT pg_temp.esperar('lead ficou na etapa de origem',
  (SELECT right(stage_id::text, 2) FROM public.leads WHERE id = '00000000-0000-4000-8130-000000000101'), 'c0');

SELECT pg_temp.esperar('humano preenche só o e-mail',
  pg_temp.como('authenticated', '00000000-0000-4000-8130-000000000001', $c$
    UPDATE public.leads SET email = 'um@teste.invalid'
     WHERE id = '00000000-0000-4000-8130-000000000101'$c$), '1');
SELECT pg_temp.esperar('falta só vacinas',
  pg_temp.como('authenticated', '00000000-0000-4000-8130-000000000001', $c$
    UPDATE public.leads SET stage_id = '00000000-0000-4000-8130-0000000000c1'
     WHERE id = '00000000-0000-4000-8130-000000000101'$c$, true),
  'erro VC001 | Para entrar na etapa "Orçamento enviado", preencha: Vacinas de interesse'
  || ' | {"etapa_id": "00000000-0000-4000-8130-0000000000c1", "faltando": ["vacinas_de_interesse"]}');
SELECT pg_temp.esperar('e-mail só com espaços conta como vazio',
  pg_temp.como('authenticated', '00000000-0000-4000-8130-000000000001', $c$
    UPDATE public.leads SET email = '   ', campos = '{"vacinas_de_interesse": ["HPV"]}',
           stage_id = '00000000-0000-4000-8130-0000000000c1'
     WHERE id = '00000000-0000-4000-8130-000000000101'$c$), 'erro VC001');
-- Preencher e mover no mesmo UPDATE: trg_lead_campos roda antes e já validou campos
SELECT pg_temp.esperar('preenchido no mesmo comando que move',
  pg_temp.como('authenticated', '00000000-0000-4000-8130-000000000001', $c$
    UPDATE public.leads SET campos = '{"vacinas_de_interesse": ["HPV"]}',
           stage_id = '00000000-0000-4000-8130-0000000000c1'
     WHERE id = '00000000-0000-4000-8130-000000000101'$c$), '1');

SELECT pg_temp.esperar('humano cria lead direto na etapa sem os campos',
  pg_temp.como('authenticated', '00000000-0000-4000-8130-000000000001', $c$
    INSERT INTO public.leads (nome, funnel_id, stage_id, unit_id) VALUES ('Novo', '00000000-0000-4000-8130-0000000000d0',
      '00000000-0000-4000-8130-0000000000c1', '00000000-0000-4000-8130-0000000000a0')$c$), 'erro VC001');
SELECT pg_temp.esperar('humano cria lead direto na etapa com os campos',
  pg_temp.como('authenticated', '00000000-0000-4000-8130-000000000001', $c$
    INSERT INTO public.leads (nome, email, campos, funnel_id, stage_id, unit_id) VALUES ('Novo', 'n@teste.invalid',
      '{"vacinas_de_interesse": ["Gripe"]}', '00000000-0000-4000-8130-0000000000d0',
      '00000000-0000-4000-8130-0000000000c1', '00000000-0000-4000-8130-0000000000a0')$c$), '1');

-- ── Servidor e automações não são barrados ───────────────────────────────────
SELECT pg_temp.esperar('service_role move sem preencher',
  pg_temp.como('service_role', NULL, $c$
    UPDATE public.leads SET stage_id = '00000000-0000-4000-8130-0000000000c1'
     WHERE id = '00000000-0000-4000-8130-000000000102'$c$), '1');
SELECT pg_temp.esperar('service_role cria lead na etapa sem preencher (webhook, importação)',
  pg_temp.como('service_role', NULL, $c$
    INSERT INTO public.leads (nome, funnel_id, stage_id, unit_id) VALUES ('Do WhatsApp', '00000000-0000-4000-8130-0000000000d0',
      '00000000-0000-4000-8130-0000000000c1', '00000000-0000-4000-8130-0000000000a0')$c$), '1');

-- ── Lead já na etapa: editar não revalida ────────────────────────────────────
SELECT pg_temp.esperar('humano edita outro campo de lead incompleto já na etapa',
  pg_temp.como('authenticated', '00000000-0000-4000-8130-000000000001', $c$
    UPDATE public.leads SET cidade = 'Belo Horizonte'
     WHERE id = '00000000-0000-4000-8130-000000000102'$c$), '1');
SELECT pg_temp.esperar('regravar a mesma etapa (ficha salva o formulário inteiro) não revalida',
  pg_temp.como('authenticated', '00000000-0000-4000-8130-000000000001', $c$
    UPDATE public.leads SET stage_id = '00000000-0000-4000-8130-0000000000c1', ordem = 3
     WHERE id = '00000000-0000-4000-8130-000000000102'$c$), '1');

-- ── Perda nunca é barrada ────────────────────────────────────────────────────
SELECT pg_temp.esperar('humano perde lead incompleto pela etapa de perda',
  pg_temp.como('authenticated', '00000000-0000-4000-8130-000000000001', $c$
    UPDATE public.leads SET stage_id = '00000000-0000-4000-8130-0000000000c3'
     WHERE id = '00000000-0000-4000-8130-000000000102'$c$), '1');
SELECT pg_temp.esperar('lead perdido',
  (SELECT status FROM public.leads WHERE id = '00000000-0000-4000-8130-000000000102'), 'perdido');

-- ── Etapa de ganho e marcar ganho ────────────────────────────────────────────
SELECT pg_temp.esperar('humano move para Contrato assinado sem cidade e capital',
  pg_temp.como('authenticated', '00000000-0000-4000-8130-000000000001', $c$
    UPDATE public.leads SET stage_id = '00000000-0000-4000-8130-0000000000c2'
     WHERE id = '00000000-0000-4000-8130-000000000104'$c$, true),
  'erro VC001 | Para entrar na etapa "Contrato assinado", preencha: Cidade pretendida, Capital disponível'
  || ' | {"etapa_id": "00000000-0000-4000-8130-0000000000c2", "faltando": ["cidade_pretendida", "capital_disponivel"]}');
SELECT pg_temp.esperar('marcar ganho (só status, sem mudar etapa) não é barrado',
  pg_temp.como('authenticated', '00000000-0000-4000-8130-000000000001', $c$
    UPDATE public.leads SET status = 'ganho' WHERE id = '00000000-0000-4000-8130-000000000104'$c$), '1');
SELECT pg_temp.esperar('ganho continua na etapa de origem',
  (SELECT status || ' ' || right(stage_id::text, 2) FROM public.leads WHERE id = '00000000-0000-4000-8130-000000000104'),
  'ganho c0');

-- ── Campo desativado sai da verificação ──────────────────────────────────────
SELECT pg_temp.esperar('gestor desativa vacinas',
  pg_temp.como('authenticated', '00000000-0000-4000-8130-000000000002', $c$
    UPDATE public.campos_lead SET ativo = false WHERE chave = 'vacinas_de_interesse'
       AND unit_id = '00000000-0000-4000-8130-0000000000a0'$c$), '1');
SELECT pg_temp.esperar('com vacinas desativado, só o e-mail é exigido',
  pg_temp.como('authenticated', '00000000-0000-4000-8130-000000000001', $c$
    UPDATE public.leads SET stage_id = '00000000-0000-4000-8130-0000000000c1'
     WHERE id = '00000000-0000-4000-8130-000000000103'$c$, true),
  'erro VC001 | Para entrar na etapa "Orçamento enviado", preencha: E-mail'
  || ' | {"etapa_id": "00000000-0000-4000-8130-0000000000c1", "faltando": ["lead:email"]}');
SELECT pg_temp.esperar('renomear etapa que ainda lista o campo desativado passa',
  pg_temp.como('authenticated', '00000000-0000-4000-8130-000000000002', $c$
    UPDATE public.funnel_stages SET nome = 'Proposta enviada', campos_obrigatorios = campos_obrigatorios
     WHERE id = '00000000-0000-4000-8130-0000000000c1'$c$), '1');

-- ── Todos os campos fixos: cada um é conferido ───────────────────────────────
UPDATE public.funnel_stages
   SET campos_obrigatorios = ARRAY(SELECT chave FROM public.campos_fixos_lead() ORDER BY ordem)
 WHERE id = '00000000-0000-4000-8130-0000000000c4';
SELECT pg_temp.esperar('lead sem nada: todos os fixos faltando, na ordem',
  (SELECT split_part(pg_temp.como('authenticated', '00000000-0000-4000-8130-000000000001', $c$
     UPDATE public.leads SET stage_id = '00000000-0000-4000-8130-0000000000c4'
      WHERE id = '00000000-0000-4000-8130-000000000103'$c$, true), ' | ', 3)::jsonb -> 'faltando')::text,
  (SELECT jsonb_agg(chave ORDER BY ordem)::text FROM public.campos_fixos_lead()));
SELECT pg_temp.esperar('lead com todos os fixos entra',
  pg_temp.como('authenticated', '00000000-0000-4000-8130-000000000001', $c$
    UPDATE public.leads SET email = 'tres@teste.invalid', telefone = '31996674494', sobrenome = 'Silva',
           cpf = '12345678909', data_nascimento = '1990-01-02', profissao = 'Médica', cidade = 'Contagem',
           estado = 'MG', origem = 'indicacao', responsavel_id = '00000000-0000-4000-8130-000000000001',
           stage_id = '00000000-0000-4000-8130-0000000000c4'
     WHERE id = '00000000-0000-4000-8130-000000000103'$c$), '1');

-- ── mesclar_leads não muda etapa e segue funcionando ─────────────────────────
-- O mantido (102) está em etapa de perda e o removido (101) em "Proposta enviada"
SELECT pg_temp.esperar('mesclar como service_role',
  pg_temp.como('service_role', NULL, $c$
    SELECT public.mesclar_leads('00000000-0000-4000-8130-000000000102', '00000000-0000-4000-8130-000000000101')$c$), '1');
SELECT pg_temp.esperar('mantido fica na etapa dele e recebe e-mail e campos do removido',
  (SELECT right(stage_id::text, 2) || ' ' || email || ' ' || (campos ? 'vacinas_de_interesse')::text
     FROM public.leads WHERE id = '00000000-0000-4000-8130-000000000102'),
  'c3 um@teste.invalid true');

-- ── Privilégios ──────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF has_function_privilege('authenticated', 'public.fn_lead_obrigatorios()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.fn_etapa_obrigatorios()', 'EXECUTE')
     OR has_function_privilege('anon', 'public.campos_fixos_lead()', 'EXECUTE') THEN
    RAISE EXCEPTION 'funções da 130 executáveis por quem não deveria';
  END IF;
END $$;
