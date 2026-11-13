-- Status do negócio do lead, motivos de perda e configuração de funil (migração 126).

CREATE FUNCTION pg_temp.esperar(caso text, obtido text, esperado text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF obtido IS DISTINCT FROM esperado THEN
    RAISE EXCEPTION '%: esperado %, obtido %', caso, esperado, obtido;
  END IF;
END $$;

-- Roda o comando com o papel e o usuário dados e MANTÉM o efeito (os casos em
-- sequência dependem do estado anterior). Devolve as linhas afetadas ou o erro.
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

CREATE FUNCTION pg_temp.lead(n int) RETURNS uuid LANGUAGE sql AS $$
  SELECT ('00000000-0000-4000-8090-' || lpad(n::text, 12, '0'))::uuid
$$;
GRANT EXECUTE ON FUNCTION pg_temp.lead(int) TO PUBLIC;

CREATE FUNCTION pg_temp.estado(n int) RETURNS text LANGUAGE sql AS $$
  SELECT concat_ws(' | ', l.status, 'cliente=' || l.is_converted,
                   'motivo=' || coalesce(m.nome, '-'), 'texto=' || coalesce(l.motivo_perda, '-'),
                   'ganho_em=' || (l.ganho_em IS NOT NULL), 'perdido_em=' || (l.perdido_em IS NOT NULL))
    FROM public.leads l LEFT JOIN public.motivos_perda m ON m.id = l.motivo_perda_id
   WHERE l.id = pg_temp.lead(n)
$$;

CREATE FUNCTION pg_temp.motivo(funil uuid, nome text) RETURNS uuid LANGUAGE sql AS $$
  SELECT id FROM public.motivos_perda WHERE funnel_id = funil AND motivos_perda.nome = motivo.nome
$$;

-- ── Migração de dados: leads do dados_antes_126.sql, migrados pela 126 ──────
CREATE FUNCTION pg_temp.migrado(n int) RETURNS text LANGUAGE sql AS $$
  SELECT concat_ws(' | ', l.status, 'cliente=' || l.is_converted,
                   'motivo=' || coalesce(m.nome, '-'), 'texto=' || coalesce(l.motivo_perda, '-'),
                   'ganho_em=' || coalesce(to_char(l.ganho_em AT TIME ZONE 'UTC', 'YYYY-MM-DD'), '-'),
                   'perdido_em=' || coalesce(to_char(l.perdido_em AT TIME ZONE 'UTC', 'YYYY-MM-DD'), '-'))
    FROM public.leads l LEFT JOIN public.motivos_perda m ON m.id = l.motivo_perda_id
   WHERE l.id = ('00000000-0000-4000-8126-' || lpad(n::text, 12, '0'))::uuid
$$;

SELECT pg_temp.esperar('etapas marcadas pelo nome',
  (SELECT string_agg(nome || '=' || coalesce(resultado, '-'), ', ' ORDER BY id) FROM public.funnel_stages
    WHERE id::text LIKE '00000000-0000-4000-8126-%'),
  'Novo=-, Finalizados=-,  perdido =perdido, Novo=-, Contrato assinado=ganho');
SELECT pg_temp.esperar('motivos padrão do funil da clínica',
  (SELECT string_agg(nome, ', ' ORDER BY ordem) FROM public.motivos_perda
    WHERE funnel_id = '00000000-0000-4000-8126-0000000000d0'),
  'Sem orçamento, Escolheu concorrente, Sem interesse, Sem contato, Timing ruim, Não é cliente (erro, spam, fornecedor), Outro');
SELECT pg_temp.esperar('motivos padrão do funil comercial',
  (SELECT string_agg(nome, ', ' ORDER BY ordem) FROM public.motivos_perda
    WHERE funnel_id = '00000000-0000-4000-8126-0000000000e0'),
  'Sem capital, Cidade indisponível, Sem perfil, Desistiu, Sem resposta, Outro');

SELECT pg_temp.esperar('arquivado com motivo da lista', pg_temp.migrado(101),
  'perdido | cliente=false | motivo=Sem orçamento | texto=- | ganho_em=- | perdido_em=2026-01-10');
SELECT pg_temp.esperar('arquivado com "Outro: x"', pg_temp.migrado(102),
  'perdido | cliente=false | motivo=Outro | texto=spam do fornecedor | ganho_em=- | perdido_em=2026-01-10');
SELECT pg_temp.esperar('arquivado com texto fora da lista', pg_temp.migrado(103),
  'perdido | cliente=false | motivo=Outro | texto=Orçamento recusado: caro | ganho_em=- | perdido_em=2026-01-10');
SELECT pg_temp.esperar('arquivado e cliente (motivo com caixa/espaço diferentes)', pg_temp.migrado(104),
  'perdido | cliente=true | motivo=Sem interesse | texto=- | ganho_em=- | perdido_em=2026-01-10');
SELECT pg_temp.esperar('ativo na etapa Perdido', pg_temp.migrado(105),
  'perdido | cliente=false | motivo=Outro | texto=Estava na etapa perdido | ganho_em=- | perdido_em=2026-02-20');
SELECT pg_temp.esperar('cliente ativo vira ganho sem data', pg_temp.migrado(106),
  'ganho | cliente=true | motivo=- | texto=- | ganho_em=- | perdido_em=-');
SELECT pg_temp.esperar('Finalizados sem conversão fica aberto', pg_temp.migrado(107),
  'aberto | cliente=false | motivo=- | texto=- | ganho_em=- | perdido_em=-');
SELECT pg_temp.esperar('ativo em Contrato assinado', pg_temp.migrado(108),
  'ganho | cliente=true | motivo=- | texto=- | ganho_em=2026-02-20 | perdido_em=-');
SELECT pg_temp.esperar('arquivado no funil comercial', pg_temp.migrado(109),
  'perdido | cliente=false | motivo=Sem capital | texto=- | ganho_em=- | perdido_em=2026-01-10');
SELECT pg_temp.esperar('cliente na etapa Perdido: a etapa manda', pg_temp.migrado(110),
  'perdido | cliente=true | motivo=Outro | texto=Estava na etapa perdido | ganho_em=- | perdido_em=2026-02-20');
SELECT pg_temp.esperar('lead comum fica aberto', pg_temp.migrado(111),
  'aberto | cliente=false | motivo=- | texto=- | ganho_em=- | perdido_em=-');

-- ── Cenário ──────────────────────────────────────────────────────────────────
INSERT INTO public.tenants (id, nome) VALUES ('00000000-0000-4000-8090-0000000000f0', 'Rede Status');
INSERT INTO public.units (id, tenant_id, nome, tipo) VALUES
  ('00000000-0000-4000-8090-0000000000a0', '00000000-0000-4000-8090-0000000000f0', 'Unidade A', 'clinica'),
  ('00000000-0000-4000-8090-0000000000b0', '00000000-0000-4000-8090-0000000000f0', 'Unidade B', 'clinica');

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('00000000-0000-4000-8090-000000000001', 'st-atendente@teste.invalid', '{"full_name": "Atendente"}'),
  ('00000000-0000-4000-8090-000000000002', 'st-gestor-a@teste.invalid', '{"full_name": "Gestor A"}'),
  ('00000000-0000-4000-8090-000000000003', 'st-gestor-b@teste.invalid', '{"full_name": "Gestor B"}');
UPDATE public.profiles SET
  unit_id = CASE id WHEN '00000000-0000-4000-8090-000000000003' THEN '00000000-0000-4000-8090-0000000000b0'::uuid
                    ELSE '00000000-0000-4000-8090-0000000000a0'::uuid END,
  perfil  = CASE id WHEN '00000000-0000-4000-8090-000000000001' THEN 'atendente' ELSE 'gestor_unidade' END
 WHERE id::text LIKE '00000000-0000-4000-8090-00000000000_';
INSERT INTO public.user_units (user_id, unit_id) VALUES
  ('00000000-0000-4000-8090-000000000001', '00000000-0000-4000-8090-0000000000a0'),
  ('00000000-0000-4000-8090-000000000002', '00000000-0000-4000-8090-0000000000a0'),
  ('00000000-0000-4000-8090-000000000003', '00000000-0000-4000-8090-0000000000b0');

INSERT INTO public.funnels (id, nome, unit_id) VALUES
  ('00000000-0000-4000-8090-0000000000d0', 'Funil A', '00000000-0000-4000-8090-0000000000a0'),
  ('00000000-0000-4000-8090-0000000000e0', 'Funil B', '00000000-0000-4000-8090-0000000000b0');
INSERT INTO public.funnel_stages (id, funnel_id, nome, ordem, resultado, unit_id) VALUES
  ('00000000-0000-4000-8090-0000000000d1', '00000000-0000-4000-8090-0000000000d0', 'Novo',       0, NULL,      '00000000-0000-4000-8090-0000000000a0'),
  ('00000000-0000-4000-8090-0000000000d2', '00000000-0000-4000-8090-0000000000d0', 'Negociação', 1, NULL,      '00000000-0000-4000-8090-0000000000a0'),
  ('00000000-0000-4000-8090-0000000000d3', '00000000-0000-4000-8090-0000000000d0', 'Perdido',    2, 'perdido', '00000000-0000-4000-8090-0000000000a0'),
  ('00000000-0000-4000-8090-0000000000d4', '00000000-0000-4000-8090-0000000000d0', 'Fechado',    3, 'ganho',   '00000000-0000-4000-8090-0000000000a0'),
  ('00000000-0000-4000-8090-0000000000e1', '00000000-0000-4000-8090-0000000000e0', 'Novo',       0, NULL,      '00000000-0000-4000-8090-0000000000b0');

SELECT pg_temp.esperar('funil novo nasce com os motivos padrão',
  (SELECT count(*)::text FROM public.motivos_perda WHERE funnel_id = '00000000-0000-4000-8090-0000000000d0'), '7');

INSERT INTO public.leads (id, nome, funnel_id, stage_id, unit_id)
SELECT pg_temp.lead(n), 'Lead ' || n, '00000000-0000-4000-8090-0000000000d0',
       '00000000-0000-4000-8090-0000000000d1', '00000000-0000-4000-8090-0000000000a0'
  FROM generate_series(1, 30) n;

-- ── Trigger: etapa com resultado ─────────────────────────────────────────────
SELECT pg_temp.esperar('atendente move para a etapa Perdido',
  pg_temp.como('authenticated', '00000000-0000-4000-8090-000000000001',
    $c$UPDATE public.leads SET stage_id = '00000000-0000-4000-8090-0000000000d3' WHERE id = pg_temp.lead(1)$c$), '1');
SELECT pg_temp.esperar('lead perde pela etapa, com motivo automático', pg_temp.estado(1),
  'perdido | cliente=false | motivo=- | texto=Movido para a etapa Perdido | ganho_em=false | perdido_em=true');
SELECT pg_temp.esperar('atendente tira da etapa Perdido',
  pg_temp.como('authenticated', '00000000-0000-4000-8090-000000000001',
    $c$UPDATE public.leads SET stage_id = '00000000-0000-4000-8090-0000000000d1' WHERE id = pg_temp.lead(1)$c$), '1');
SELECT pg_temp.esperar('sair da etapa com resultado reabre e limpa o motivo', pg_temp.estado(1),
  'aberto | cliente=false | motivo=- | texto=- | ganho_em=false | perdido_em=true');

SELECT pg_temp.esperar('service_role (automação) move para a etapa de ganho',
  pg_temp.como('service_role', NULL,
    $c$UPDATE public.leads SET stage_id = '00000000-0000-4000-8090-0000000000d4' WHERE id = pg_temp.lead(2)$c$), '1');
SELECT pg_temp.esperar('lead ganha pela etapa e vira cliente', pg_temp.estado(2),
  'ganho | cliente=true | motivo=- | texto=- | ganho_em=true | perdido_em=false');
SELECT pg_temp.esperar('service_role move de volta para Novo',
  pg_temp.como('service_role', NULL,
    $c$UPDATE public.leads SET stage_id = '00000000-0000-4000-8090-0000000000d1' WHERE id = pg_temp.lead(2)$c$), '1');
SELECT pg_temp.esperar('reaberto continua cliente', pg_temp.estado(2),
  'aberto | cliente=true | motivo=- | texto=- | ganho_em=true | perdido_em=false');

SELECT pg_temp.esperar('service_role move para Perdido',
  pg_temp.como('service_role', NULL,
    $c$UPDATE public.leads SET stage_id = '00000000-0000-4000-8090-0000000000d3' WHERE id = pg_temp.lead(3)$c$), '1');
SELECT pg_temp.esperar('service_role também perde pela etapa', pg_temp.estado(3),
  'perdido | cliente=false | motivo=- | texto=Movido para a etapa Perdido | ganho_em=false | perdido_em=true');
SELECT pg_temp.esperar('reabrir: status e etapa no mesmo comando',
  pg_temp.como('authenticated', '00000000-0000-4000-8090-000000000001',
    $c$UPDATE public.leads SET status = 'aberto', stage_id = '00000000-0000-4000-8090-0000000000d1' WHERE id = pg_temp.lead(3)$c$), '1');
SELECT pg_temp.esperar('reaberto', pg_temp.estado(3),
  'aberto | cliente=false | motivo=- | texto=- | ganho_em=false | perdido_em=true');

SELECT pg_temp.esperar('status explícito vence a etapa de destino',
  pg_temp.como('authenticated', '00000000-0000-4000-8090-000000000001',
    $c$UPDATE public.leads SET status = 'ganho', stage_id = '00000000-0000-4000-8090-0000000000d3' WHERE id = pg_temp.lead(4)$c$), '1');
SELECT pg_temp.esperar('ganho mesmo na etapa Perdido', (SELECT status FROM public.leads WHERE id = pg_temp.lead(4)), 'ganho');

-- ── Trigger: mudança de status ───────────────────────────────────────────────
SELECT pg_temp.esperar('atendente marca ganho',
  pg_temp.como('authenticated', '00000000-0000-4000-8090-000000000001',
    $c$UPDATE public.leads SET status = 'ganho' WHERE id = pg_temp.lead(5)$c$), '1');
SELECT pg_temp.esperar('ganho preenche ganho_em e is_converted', pg_temp.estado(5),
  'ganho | cliente=true | motivo=- | texto=- | ganho_em=true | perdido_em=false');
SELECT pg_temp.esperar('ganho movido entre etapas sem resultado',
  pg_temp.como('authenticated', '00000000-0000-4000-8090-000000000001',
    $c$UPDATE public.leads SET stage_id = '00000000-0000-4000-8090-0000000000d2' WHERE id = pg_temp.lead(5)$c$), '1');
SELECT pg_temp.esperar('continua ganho', (SELECT status FROM public.leads WHERE id = pg_temp.lead(5)), 'ganho');

SELECT pg_temp.esperar('perdido sem motivo viola o CHECK',
  pg_temp.como('authenticated', '00000000-0000-4000-8090-000000000001',
    $c$UPDATE public.leads SET status = 'perdido' WHERE id = pg_temp.lead(6)$c$), 'erro 23514');
SELECT pg_temp.esperar('perdido com motivo da lista',
  pg_temp.como('authenticated', '00000000-0000-4000-8090-000000000001',
    format($c$UPDATE public.leads SET status = 'perdido', motivo_perda_id = %L WHERE id = pg_temp.lead(6)$c$,
           pg_temp.motivo('00000000-0000-4000-8090-0000000000d0', 'Sem interesse'))), '1');
SELECT pg_temp.esperar('perdido preenche perdido_em', pg_temp.estado(6),
  'perdido | cliente=false | motivo=Sem interesse | texto=- | ganho_em=false | perdido_em=true');
SELECT pg_temp.esperar('reabrir limpa o motivo',
  pg_temp.como('authenticated', '00000000-0000-4000-8090-000000000001',
    $c$UPDATE public.leads SET status = 'aberto' WHERE id = pg_temp.lead(6)$c$), '1');
SELECT pg_temp.esperar('reaberto sem motivo', pg_temp.estado(6),
  'aberto | cliente=false | motivo=- | texto=- | ganho_em=false | perdido_em=true');

SELECT pg_temp.esperar('perdido só com texto também vale',
  pg_temp.como('service_role', NULL,
    $c$UPDATE public.leads SET status = 'perdido', motivo_perda = 'detalhe livre' WHERE id = pg_temp.lead(7)$c$), '1');
SELECT pg_temp.esperar('INSERT perdido sem motivo viola o CHECK',
  pg_temp.como('service_role', NULL,
    $c$INSERT INTO public.leads (nome, funnel_id, stage_id, unit_id, status) VALUES ('X',
       '00000000-0000-4000-8090-0000000000d0', '00000000-0000-4000-8090-0000000000d1',
       '00000000-0000-4000-8090-0000000000a0', 'perdido')$c$), 'erro 23514');
SELECT pg_temp.esperar('status fora da lista',
  pg_temp.como('service_role', NULL,
    $c$UPDATE public.leads SET status = 'arquivado' WHERE id = pg_temp.lead(8)$c$), 'erro 23514');
SELECT pg_temp.esperar('arquivado é gerado (status na 126, arquivado_em desde a 132): não aceita escrita',
  pg_temp.como('service_role', NULL,
    $c$UPDATE public.leads SET arquivado = true WHERE id = pg_temp.lead(8)$c$), 'erro 428C9');

UPDATE public.leads SET status = 'ganho', ganho_em = '2026-01-01 00:00+00' WHERE id = pg_temp.lead(9);
SELECT pg_temp.esperar('ganho_em explícito é mantido',
  (SELECT ganho_em::date::text FROM public.leads WHERE id = pg_temp.lead(9)), '2026-01-01');

SELECT pg_temp.esperar('INSERT direto na etapa de ganho',
  pg_temp.como('service_role', NULL,
    $c$INSERT INTO public.leads (id, nome, funnel_id, stage_id, unit_id) VALUES (pg_temp.lead(40), 'Novo ganho',
       '00000000-0000-4000-8090-0000000000d0', '00000000-0000-4000-8090-0000000000d4',
       '00000000-0000-4000-8090-0000000000a0')$c$), '1');
SELECT pg_temp.esperar('INSERT na etapa de ganho', pg_temp.estado(40),
  'ganho | cliente=true | motivo=- | texto=- | ganho_em=true | perdido_em=false');
SELECT pg_temp.esperar('cliente cadastrado como ganho (tela Clientes)',
  pg_temp.como('authenticated', '00000000-0000-4000-8090-000000000001',
    $c$INSERT INTO public.leads (id, nome, funnel_id, stage_id, unit_id, status) VALUES (pg_temp.lead(41), 'Cliente',
       '00000000-0000-4000-8090-0000000000d0', '00000000-0000-4000-8090-0000000000d1',
       '00000000-0000-4000-8090-0000000000a0', 'ganho')$c$), '1');
SELECT pg_temp.esperar('cliente cadastrado', pg_temp.estado(41),
  'ganho | cliente=true | motivo=- | texto=- | ganho_em=true | perdido_em=false');

-- ── RLS de motivos_perda ─────────────────────────────────────────────────────
SELECT pg_temp.esperar('atendente lê os motivos da unidade',
  pg_temp.como('authenticated', '00000000-0000-4000-8090-000000000001',
    $c$SELECT * FROM public.motivos_perda WHERE funnel_id = '00000000-0000-4000-8090-0000000000d0'$c$), '7');
SELECT pg_temp.esperar('atendente cria motivo',
  pg_temp.como('authenticated', '00000000-0000-4000-8090-000000000001',
    $c$INSERT INTO public.motivos_perda (funnel_id, nome) VALUES ('00000000-0000-4000-8090-0000000000d0', 'Atendente')$c$),
  'erro 42501');
SELECT pg_temp.esperar('atendente renomeia motivo',
  pg_temp.como('authenticated', '00000000-0000-4000-8090-000000000001',
    $c$UPDATE public.motivos_perda SET nome = 'x' WHERE funnel_id = '00000000-0000-4000-8090-0000000000d0'$c$), '0');
SELECT pg_temp.esperar('atendente apaga motivo',
  pg_temp.como('authenticated', '00000000-0000-4000-8090-000000000001',
    $c$DELETE FROM public.motivos_perda WHERE funnel_id = '00000000-0000-4000-8090-0000000000d0'$c$), '0');
SELECT pg_temp.esperar('gestor cria motivo (unit_id forjado é trocado pelo do funil)',
  pg_temp.como('authenticated', '00000000-0000-4000-8090-000000000002',
    $c$INSERT INTO public.motivos_perda (funnel_id, unit_id, nome, ordem) VALUES ('00000000-0000-4000-8090-0000000000d0',
       '00000000-0000-4000-8090-0000000000b0', 'Preço', 9)$c$), '1');
SELECT pg_temp.esperar('motivo novo ficou na unidade do funil',
  (SELECT unit_id::text FROM public.motivos_perda
    WHERE funnel_id = '00000000-0000-4000-8090-0000000000d0' AND nome = 'Preço'), '00000000-0000-4000-8090-0000000000a0');
SELECT pg_temp.esperar('gestor desativa motivo',
  pg_temp.como('authenticated', '00000000-0000-4000-8090-000000000002',
    $c$UPDATE public.motivos_perda SET ativo = false WHERE funnel_id = '00000000-0000-4000-8090-0000000000d0' AND nome = 'Preço'$c$), '1');
SELECT pg_temp.esperar('gestor de outra unidade não lê',
  pg_temp.como('authenticated', '00000000-0000-4000-8090-000000000003',
    $c$SELECT * FROM public.motivos_perda WHERE funnel_id = '00000000-0000-4000-8090-0000000000d0'$c$), '0');
SELECT pg_temp.esperar('gestor de outra unidade não altera',
  pg_temp.como('authenticated', '00000000-0000-4000-8090-000000000003',
    $c$UPDATE public.motivos_perda SET nome = 'x' WHERE funnel_id = '00000000-0000-4000-8090-0000000000d0'$c$), '0');
SELECT pg_temp.esperar('gestor de outra unidade não cria no funil alheio',
  left(pg_temp.como('authenticated', '00000000-0000-4000-8090-000000000003',
    $c$INSERT INTO public.motivos_perda (funnel_id, unit_id, nome) VALUES ('00000000-0000-4000-8090-0000000000d0',
       '00000000-0000-4000-8090-0000000000b0', 'Invasor')$c$), 5), 'erro ');
SELECT pg_temp.esperar('anon não lê motivos',
  pg_temp.como('anon', NULL, $c$SELECT * FROM public.motivos_perda$c$), 'erro 42501');

UPDATE public.leads SET status = 'perdido', motivo_perda = 'ligou 3x',
       motivo_perda_id = pg_temp.motivo('00000000-0000-4000-8090-0000000000d0', 'Sem contato')
 WHERE id = pg_temp.lead(10);
SELECT pg_temp.esperar('gestor apaga motivo em uso',
  pg_temp.como('authenticated', '00000000-0000-4000-8090-000000000002',
    $c$DELETE FROM public.motivos_perda WHERE funnel_id = '00000000-0000-4000-8090-0000000000d0' AND nome = 'Sem contato'$c$), '1');
SELECT pg_temp.esperar('o nome do motivo apagado vai para o texto', pg_temp.estado(10),
  'perdido | cliente=false | motivo=- | texto=Sem contato: ligou 3x | ganho_em=false | perdido_em=true');

-- ── funnels e funnel_stages: escrita só gestor ───────────────────────────────
SELECT pg_temp.esperar('atendente lê as etapas',
  pg_temp.como('authenticated', '00000000-0000-4000-8090-000000000001',
    $c$SELECT * FROM public.funnel_stages WHERE funnel_id = '00000000-0000-4000-8090-0000000000d0'$c$), '4');
SELECT pg_temp.esperar('atendente renomeia etapa',
  pg_temp.como('authenticated', '00000000-0000-4000-8090-000000000001',
    $c$UPDATE public.funnel_stages SET nome = 'x' WHERE funnel_id = '00000000-0000-4000-8090-0000000000d0'$c$), '0');
SELECT pg_temp.esperar('atendente cria etapa',
  pg_temp.como('authenticated', '00000000-0000-4000-8090-000000000001',
    $c$INSERT INTO public.funnel_stages (funnel_id, nome, ordem, unit_id) VALUES ('00000000-0000-4000-8090-0000000000d0',
       'Nova', 9, '00000000-0000-4000-8090-0000000000a0')$c$), 'erro 42501');
SELECT pg_temp.esperar('atendente apaga etapa',
  pg_temp.como('authenticated', '00000000-0000-4000-8090-000000000001',
    $c$DELETE FROM public.funnel_stages WHERE id = '00000000-0000-4000-8090-0000000000d2'$c$), '0');
SELECT pg_temp.esperar('atendente renomeia funil',
  pg_temp.como('authenticated', '00000000-0000-4000-8090-000000000001',
    $c$UPDATE public.funnels SET nome = 'x' WHERE id = '00000000-0000-4000-8090-0000000000d0'$c$), '0');
SELECT pg_temp.esperar('atendente cria funil',
  pg_temp.como('authenticated', '00000000-0000-4000-8090-000000000001',
    $c$INSERT INTO public.funnels (nome, unit_id) VALUES ('Meu funil', '00000000-0000-4000-8090-0000000000a0')$c$), 'erro 42501');
SELECT pg_temp.esperar('gestor marca resultado da etapa',
  pg_temp.como('authenticated', '00000000-0000-4000-8090-000000000002',
    $c$UPDATE public.funnel_stages SET resultado = 'ganho' WHERE id = '00000000-0000-4000-8090-0000000000d2'$c$), '1');
SELECT pg_temp.esperar('gestor cria funil',
  pg_temp.como('authenticated', '00000000-0000-4000-8090-000000000002',
    $c$INSERT INTO public.funnels (id, nome, unit_id) VALUES ('00000000-0000-4000-8090-0000000000c0', 'Funil do gestor',
       '00000000-0000-4000-8090-0000000000a0')$c$), '1');
SELECT pg_temp.esperar('funil criado pelo gestor nasce com motivos',
  (SELECT count(*)::text FROM public.motivos_perda WHERE funnel_id = '00000000-0000-4000-8090-0000000000c0'), '7');
SELECT pg_temp.esperar('gestor de outra unidade altera etapa alheia',
  pg_temp.como('authenticated', '00000000-0000-4000-8090-000000000003',
    $c$UPDATE public.funnel_stages SET nome = 'x' WHERE funnel_id = '00000000-0000-4000-8090-0000000000d0'$c$), '0');

-- ── mesclar_leads consolida o status ─────────────────────────────────────────
UPDATE public.leads SET status = 'perdido', motivo_perda = 'a', perdido_em = '2026-01-01 00:00+00' WHERE id = pg_temp.lead(11);
UPDATE public.leads SET status = 'ganho' WHERE id = pg_temp.lead(12);
SELECT public.mesclar_leads(pg_temp.lead(11), pg_temp.lead(12));
SELECT pg_temp.esperar('perdido + ganho = ganho', pg_temp.estado(11),
  'ganho | cliente=true | motivo=- | texto=- | ganho_em=true | perdido_em=true');

UPDATE public.leads SET status = 'perdido', motivo_perda = 'b' WHERE id = pg_temp.lead(14);
SELECT public.mesclar_leads(pg_temp.lead(13), pg_temp.lead(14));
SELECT pg_temp.esperar('aberto + perdido = aberto', pg_temp.estado(13),
  'aberto | cliente=false | motivo=- | texto=- | ganho_em=false | perdido_em=true');

UPDATE public.leads SET status = 'perdido', motivo_perda = 'antiga', perdido_em = '2026-01-01 00:00+00' WHERE id = pg_temp.lead(15);
UPDATE public.leads SET status = 'perdido', perdido_em = '2026-03-01 00:00+00',
       motivo_perda_id = pg_temp.motivo('00000000-0000-4000-8090-0000000000d0', 'Timing ruim') WHERE id = pg_temp.lead(16);
SELECT public.mesclar_leads(pg_temp.lead(15), pg_temp.lead(16));
SELECT pg_temp.esperar('perdido + perdido = motivo da perda mais recente', pg_temp.estado(15),
  'perdido | cliente=false | motivo=Timing ruim | texto=- | ganho_em=false | perdido_em=true');
SELECT pg_temp.esperar('perdido_em mais recente',
  (SELECT perdido_em::date::text FROM public.leads WHERE id = pg_temp.lead(15)), '2026-03-01');

-- ── execute_quote_automation ─────────────────────────────────────────────────
INSERT INTO public.quote_automations (unit_id, quote_status, action, stage_id) VALUES
  ('00000000-0000-4000-8090-0000000000a0', 'recusado', 'archive', NULL),
  ('00000000-0000-4000-8090-0000000000a0', 'aceito', 'move_stage', '00000000-0000-4000-8090-0000000000d4');
SELECT public.execute_quote_automation('00000000-0000-4000-8090-0000000000a0', pg_temp.lead(17), 'recusado', 'caro');
SELECT pg_temp.esperar('automação de orçamento recusado perde o lead', pg_temp.estado(17),
  'perdido | cliente=false | motivo=- | texto=Orçamento recusado: caro | ganho_em=false | perdido_em=true');
SELECT public.execute_quote_automation('00000000-0000-4000-8090-0000000000a0', pg_temp.lead(18), 'aceito');
SELECT pg_temp.esperar('automação que move para a etapa de ganho', pg_temp.estado(18),
  'ganho | cliente=true | motivo=- | texto=- | ganho_em=true | perdido_em=false');

-- ── Views ────────────────────────────────────────────────────────────────────
-- Desde a 132 o kanban esconde só os arquivados: perdidos aparecem (na etapa de
-- perda, como o 17, levado para lá pela automação de orçamento) e o painel
-- leads_arquivados lista os arquivados (150_arquivar.test.sql)
SELECT pg_temp.esperar('kanban tem abertos, ganhos e perdidos',
  (SELECT string_agg(DISTINCT status, ',' ORDER BY status) FROM public.leads_kanban
    WHERE funnel_id = '00000000-0000-4000-8090-0000000000d0'),
  'aberto,ganho,perdido');
SELECT pg_temp.esperar('perdido não arquivado não está no painel',
  (SELECT count(*)::text FROM public.leads_arquivados WHERE id = pg_temp.lead(15)), '0');
UPDATE public.leads SET arquivado_em = now(), arquivado_motivo = 'Duplicado' WHERE id = pg_temp.lead(15);
SELECT pg_temp.esperar('perdido arquivado no painel, com o nome do motivo da perda',
  (SELECT motivo_perda_nome FROM public.leads_arquivados WHERE id = pg_temp.lead(15)), 'Timing ruim');
SELECT pg_temp.esperar('atendente lê os arquivados da unidade',
  pg_temp.como('authenticated', '00000000-0000-4000-8090-000000000001',
    $c$SELECT * FROM public.leads_arquivados WHERE id = pg_temp.lead(15)$c$), '1');
SELECT pg_temp.esperar('gestor de outra unidade não lê os arquivados',
  pg_temp.como('authenticated', '00000000-0000-4000-8090-000000000003',
    $c$SELECT * FROM public.leads_arquivados WHERE id = pg_temp.lead(15)$c$), '0');
SELECT pg_temp.esperar('anon não lê as views',
  pg_temp.como('anon', NULL, $c$SELECT * FROM public.leads_kanban$c$), 'erro 42501');
