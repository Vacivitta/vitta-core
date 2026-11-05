-- Comportamento do banco de que POST /api/leads/importar depende (sem migração
-- própria): telefone repetido na unidade (122), status no INSERT (126), tags
-- no lead (127) e campos exigidos pela etapa (130), gravando como gestor logado
-- (o client do usuário).

CREATE FUNCTION pg_temp.esperar(caso text, obtido text, esperado text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF obtido IS DISTINCT FROM esperado THEN
    RAISE EXCEPTION '%: esperado %, obtido %', caso, esperado, obtido;
  END IF;
END $$;

-- Roda o comando com o papel e o usuário dados e MANTÉM o efeito. Devolve as
-- linhas afetadas ou 'erro <sqlstate>'.
CREATE FUNCTION pg_temp.como(papel text, usuario uuid, comando text) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE
  linhas bigint;
  resultado text;
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', usuario, 'role', papel)::text, true);
  EXECUTE format('SET LOCAL ROLE %I', papel);
  BEGIN
    EXECUTE comando;
    GET DIAGNOSTICS linhas = ROW_COUNT;
    resultado := linhas::text;
  EXCEPTION WHEN OTHERS THEN
    resultado := 'erro ' || SQLSTATE;
  END;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '', true);
  RETURN resultado;
END $$;

-- ── Cenário ──────────────────────────────────────────────────────────────────
INSERT INTO public.tenants (id, nome) VALUES ('00000000-0000-4000-8135-0000000000f0', 'Rede Importação');
INSERT INTO public.units (id, tenant_id, nome, tipo) VALUES
  ('00000000-0000-4000-8135-0000000000a0', '00000000-0000-4000-8135-0000000000f0', 'Unidade A', 'clinica'),
  ('00000000-0000-4000-8135-0000000000b0', '00000000-0000-4000-8135-0000000000f0', 'Unidade B', 'clinica');

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('00000000-0000-4000-8135-000000000001', 'imp-gestor-a@teste.invalid', '{"full_name": "Gestor A"}'),
  ('00000000-0000-4000-8135-000000000002', 'imp-gestor-b@teste.invalid', '{"full_name": "Gestor B"}');
UPDATE public.profiles SET
  unit_id = CASE id WHEN '00000000-0000-4000-8135-000000000001' THEN '00000000-0000-4000-8135-0000000000a0'::uuid
                    ELSE '00000000-0000-4000-8135-0000000000b0'::uuid END,
  perfil  = 'gestor_unidade'
 WHERE id::text LIKE '00000000-0000-4000-8135-00000000000_';
INSERT INTO public.user_units (user_id, unit_id) VALUES
  ('00000000-0000-4000-8135-000000000001', '00000000-0000-4000-8135-0000000000a0'),
  ('00000000-0000-4000-8135-000000000002', '00000000-0000-4000-8135-0000000000b0');

INSERT INTO public.funnels (id, nome, unit_id) VALUES
  ('00000000-0000-4000-8135-0000000000d0', 'Funil A', '00000000-0000-4000-8135-0000000000a0'),
  ('00000000-0000-4000-8135-0000000000e0', 'Funil B', '00000000-0000-4000-8135-0000000000b0');
INSERT INTO public.funnel_stages (id, funnel_id, nome, ordem, resultado, unit_id) VALUES
  ('00000000-0000-4000-8135-0000000000d1', '00000000-0000-4000-8135-0000000000d0', 'Novo',    0, NULL,      '00000000-0000-4000-8135-0000000000a0'),
  ('00000000-0000-4000-8135-0000000000d2', '00000000-0000-4000-8135-0000000000d0', 'Perdido', 1, 'perdido', '00000000-0000-4000-8135-0000000000a0'),
  ('00000000-0000-4000-8135-0000000000e1', '00000000-0000-4000-8135-0000000000e0', 'Novo',    0, NULL,      '00000000-0000-4000-8135-0000000000b0');

INSERT INTO public.wa_tags (id, unit_id, name, tipo) VALUES
  ('00000000-0000-4000-8135-0000000000c1', '00000000-0000-4000-8135-0000000000a0', 'Evento', 'lead');

-- Lead que já existe na unidade A
INSERT INTO public.leads (id, nome, telefone, funnel_id, stage_id, unit_id) VALUES
  ('00000000-0000-4000-8135-000000000101', 'Já existe', '(31) 99667-4494',
   '00000000-0000-4000-8135-0000000000d0', '00000000-0000-4000-8135-0000000000d1', '00000000-0000-4000-8135-0000000000a0');

-- ── Telefone repetido ────────────────────────────────────────────────────────
SELECT pg_temp.esperar('lote com um telefone já existente (outro formato) é recusado inteiro',
  pg_temp.como('authenticated', '00000000-0000-4000-8135-000000000001', $c$
    INSERT INTO public.leads (nome, telefone, funnel_id, stage_id, unit_id) VALUES
      ('Novo 1', '(34) 3333-4444', '00000000-0000-4000-8135-0000000000d0', '00000000-0000-4000-8135-0000000000d1', '00000000-0000-4000-8135-0000000000a0'),
      ('Repetido', '+55 31 99667-4494', '00000000-0000-4000-8135-0000000000d0', '00000000-0000-4000-8135-0000000000d1', '00000000-0000-4000-8135-0000000000a0')
  $c$), 'erro 23505');
SELECT pg_temp.esperar('nada do lote recusado ficou gravado',
  (SELECT count(*)::text FROM public.leads WHERE nome IN ('Novo 1', 'Repetido')), '0');

SELECT pg_temp.esperar('linha a linha: a nova entra',
  pg_temp.como('authenticated', '00000000-0000-4000-8135-000000000001', $c$
    INSERT INTO public.leads (nome, telefone, funnel_id, stage_id, unit_id) VALUES
      ('Novo 1', '(34) 3333-4444', '00000000-0000-4000-8135-0000000000d0', '00000000-0000-4000-8135-0000000000d1', '00000000-0000-4000-8135-0000000000a0')
  $c$), '1');
SELECT pg_temp.esperar('linha a linha: a repetida dá 23505 (vira "já existe")',
  pg_temp.como('authenticated', '00000000-0000-4000-8135-000000000001', $c$
    INSERT INTO public.leads (nome, telefone, funnel_id, stage_id, unit_id) VALUES
      ('Repetido', '31 9667-4494', '00000000-0000-4000-8135-0000000000d0', '00000000-0000-4000-8135-0000000000d1', '00000000-0000-4000-8135-0000000000a0')
  $c$), 'erro 23505');
SELECT pg_temp.esperar('reenviar a mesma linha também dá 23505 (importação idempotente)',
  pg_temp.como('authenticated', '00000000-0000-4000-8135-000000000001', $c$
    INSERT INTO public.leads (nome, telefone, funnel_id, stage_id, unit_id) VALUES
      ('Novo 1', '34 3333 4444', '00000000-0000-4000-8135-0000000000d0', '00000000-0000-4000-8135-0000000000d1', '00000000-0000-4000-8135-0000000000a0')
  $c$), 'erro 23505');

-- O índice é parcial (WHERE telefone_norm IS NOT NULL): ON CONFLICT só com as
-- colunas, que é o que o PostgREST manda no upsert, não acha o índice
SELECT pg_temp.esperar('ON CONFLICT (unit_id, telefone_norm) sem o predicado não infere o índice parcial',
  pg_temp.como('authenticated', '00000000-0000-4000-8135-000000000001', $c$
    INSERT INTO public.leads (nome, telefone, funnel_id, stage_id, unit_id) VALUES
      ('Upsert', '(34) 3333-4444', '00000000-0000-4000-8135-0000000000d0', '00000000-0000-4000-8135-0000000000d1', '00000000-0000-4000-8135-0000000000a0')
    ON CONFLICT (unit_id, telefone_norm) DO NOTHING
  $c$), 'erro 42P10');

SELECT pg_temp.esperar('mesmo telefone em outra unidade entra',
  pg_temp.como('authenticated', '00000000-0000-4000-8135-000000000002', $c$
    INSERT INTO public.leads (nome, telefone, funnel_id, stage_id, unit_id) VALUES
      ('Outra unidade', '(31) 99667-4494', '00000000-0000-4000-8135-0000000000e0', '00000000-0000-4000-8135-0000000000e1', '00000000-0000-4000-8135-0000000000b0')
  $c$), '1');
SELECT pg_temp.esperar('gestor não importa na unidade alheia',
  pg_temp.como('authenticated', '00000000-0000-4000-8135-000000000002', $c$
    INSERT INTO public.leads (nome, telefone, funnel_id, stage_id, unit_id) VALUES
      ('Intruso', '(11) 98888-7777', '00000000-0000-4000-8135-0000000000d0', '00000000-0000-4000-8135-0000000000d1', '00000000-0000-4000-8135-0000000000a0')
  $c$), 'erro 42501');

-- ── "Já são clientes": ganho sem data de ganho ──────────────────────────────
SELECT pg_temp.esperar('cliente importado entra como ganho',
  pg_temp.como('authenticated', '00000000-0000-4000-8135-000000000001', $c$
    INSERT INTO public.leads (id, nome, telefone, funnel_id, stage_id, unit_id, status, is_converted) VALUES
      ('00000000-0000-4000-8135-000000000201', 'Cliente antigo', '(31) 98888-1111',
       '00000000-0000-4000-8135-0000000000d0', '00000000-0000-4000-8135-0000000000d1', '00000000-0000-4000-8135-0000000000a0',
       'ganho', true)
  $c$), '1');
SELECT pg_temp.esperar('o trigger da 126 grava ganho_em = agora no INSERT',
  (SELECT (ganho_em IS NOT NULL)::text FROM public.leads WHERE id = '00000000-0000-4000-8135-000000000201'), 'true');
SELECT pg_temp.esperar('a rota limpa ganho_em',
  pg_temp.como('authenticated', '00000000-0000-4000-8135-000000000001',
    $c$UPDATE public.leads SET ganho_em = NULL WHERE id IN ('00000000-0000-4000-8135-000000000201')$c$), '1');
SELECT pg_temp.esperar('continua ganho e cliente, sem data de ganho',
  (SELECT concat_ws(' | ', status, 'cliente=' || is_converted, 'ganho_em=' || coalesce(ganho_em::text, '-'))
     FROM public.leads WHERE id = '00000000-0000-4000-8135-000000000201'),
  'ganho | cliente=true | ganho_em=-');

-- Por isso a rota recusa etapa com resultado
SELECT pg_temp.esperar('INSERT direto na etapa Perdido vira perdido',
  pg_temp.como('authenticated', '00000000-0000-4000-8135-000000000001', $c$
    INSERT INTO public.leads (id, nome, telefone, funnel_id, stage_id, unit_id) VALUES
      ('00000000-0000-4000-8135-000000000202', 'Na etapa perdido', '(31) 98888-2222',
       '00000000-0000-4000-8135-0000000000d0', '00000000-0000-4000-8135-0000000000d2', '00000000-0000-4000-8135-0000000000a0')
  $c$), '1');
SELECT pg_temp.esperar('status veio da etapa',
  (SELECT status FROM public.leads WHERE id = '00000000-0000-4000-8135-000000000202'), 'perdido');

-- ── Tags em lote ─────────────────────────────────────────────────────────────
SELECT pg_temp.esperar('gestor aplica tag nos importados (upsert ignorando repetidas)',
  pg_temp.como('authenticated', '00000000-0000-4000-8135-000000000001', $c$
    INSERT INTO public.lead_tags (lead_id, tag_id) VALUES
      ('00000000-0000-4000-8135-000000000201', '00000000-0000-4000-8135-0000000000c1'),
      ('00000000-0000-4000-8135-000000000101', '00000000-0000-4000-8135-0000000000c1')
    ON CONFLICT (lead_id, tag_id) DO NOTHING
  $c$), '2');
SELECT pg_temp.esperar('reaplicar as mesmas tags não duplica nem falha',
  pg_temp.como('authenticated', '00000000-0000-4000-8135-000000000001', $c$
    INSERT INTO public.lead_tags (lead_id, tag_id) VALUES
      ('00000000-0000-4000-8135-000000000201', '00000000-0000-4000-8135-0000000000c1')
    ON CONFLICT (lead_id, tag_id) DO NOTHING
  $c$), '0');
SELECT pg_temp.esperar('criado_por é o gestor (JWT), não escolhido pelo app',
  (SELECT criado_por::text FROM public.lead_tags WHERE lead_id = '00000000-0000-4000-8135-000000000201'),
  '00000000-0000-4000-8135-000000000001');

-- ── Etapa com campos obrigatórios (130) ──────────────────────────────────────
-- A rota grava como authenticated, que o trigger da 130 confere: a linha sem o
-- campo dá VC001 (prepararImportacao barra antes; classificarErroDeLinha trata
-- como inválida se ainda vier) e não pode derrubar o lote inteiro.
INSERT INTO public.funnel_stages (id, funnel_id, nome, ordem, resultado, unit_id, campos_obrigatorios) VALUES
  ('00000000-0000-4000-8135-0000000000d3', '00000000-0000-4000-8135-0000000000d0', 'Qualificado', 2, NULL,
   '00000000-0000-4000-8135-0000000000a0', '{lead:email}');

-- Mensagem e HINT do erro, que a rota grava como motivo da linha
CREATE FUNCTION pg_temp.erro_de(papel text, usuario uuid, comando text) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE
  estado text; mensagem text; dica text;
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', usuario, 'role', papel)::text, true);
  EXECUTE format('SET LOCAL ROLE %I', papel);
  BEGIN
    EXECUTE comando;
    estado := 'sem erro';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS estado = RETURNED_SQLSTATE, mensagem = MESSAGE_TEXT, dica = PG_EXCEPTION_HINT;
  END;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '', true);
  RETURN concat_ws(' | ', estado, mensagem, dica);
END $$;

SELECT pg_temp.esperar('INSERT authenticated sem o campo exigido pela etapa dá VC001 com o HINT que o app lê',
  pg_temp.erro_de('authenticated', '00000000-0000-4000-8135-000000000001', $c$
    INSERT INTO public.leads (nome, telefone, funnel_id, stage_id, unit_id) VALUES
      ('Sem e-mail', '(31) 97777-1111', '00000000-0000-4000-8135-0000000000d0', '00000000-0000-4000-8135-0000000000d3', '00000000-0000-4000-8135-0000000000a0')
  $c$),
  'VC001 | Para entrar na etapa "Qualificado", preencha: E-mail | '
  || '{"etapa_id": "00000000-0000-4000-8135-0000000000d3", "faltando": ["lead:email"]}');
SELECT pg_temp.esperar('e-mail só com espaços também falta',
  pg_temp.como('authenticated', '00000000-0000-4000-8135-000000000001', $c$
    INSERT INTO public.leads (nome, telefone, email, funnel_id, stage_id, unit_id) VALUES
      ('E-mail vazio', '(31) 97777-1111', '   ', '00000000-0000-4000-8135-0000000000d0', '00000000-0000-4000-8135-0000000000d3', '00000000-0000-4000-8135-0000000000a0')
  $c$), 'erro VC001');
SELECT pg_temp.esperar('lote com uma linha sem o campo é recusado inteiro (a rota refaz linha a linha)',
  pg_temp.como('authenticated', '00000000-0000-4000-8135-000000000001', $c$
    INSERT INTO public.leads (nome, telefone, email, funnel_id, stage_id, unit_id) VALUES
      ('Com e-mail', '(31) 97777-2222', 'com@teste.invalid', '00000000-0000-4000-8135-0000000000d0', '00000000-0000-4000-8135-0000000000d3', '00000000-0000-4000-8135-0000000000a0'),
      ('Sem e-mail', '(31) 97777-1111', NULL, '00000000-0000-4000-8135-0000000000d0', '00000000-0000-4000-8135-0000000000d3', '00000000-0000-4000-8135-0000000000a0')
  $c$), 'erro VC001');
SELECT pg_temp.esperar('com o campo exigido, a linha entra',
  pg_temp.como('authenticated', '00000000-0000-4000-8135-000000000001', $c$
    INSERT INTO public.leads (nome, telefone, email, funnel_id, stage_id, unit_id) VALUES
      ('Com e-mail', '(31) 97777-2222', 'com@teste.invalid', '00000000-0000-4000-8135-0000000000d0', '00000000-0000-4000-8135-0000000000d3', '00000000-0000-4000-8135-0000000000a0')
  $c$), '1');
SELECT pg_temp.esperar('só a linha com o campo ficou gravada na etapa',
  (SELECT string_agg(nome, ',' ORDER BY nome) FROM public.leads WHERE stage_id = '00000000-0000-4000-8135-0000000000d3'),
  'Com e-mail');
