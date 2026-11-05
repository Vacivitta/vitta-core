-- Perdido na etapa de perda do funil, visível no kanban (migração 131).

CREATE FUNCTION pg_temp.esperar(caso text, obtido text, esperado text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF obtido IS DISTINCT FROM esperado THEN
    RAISE EXCEPTION '%: esperado %, obtido %', caso, esperado, obtido;
  END IF;
END $$;

-- Roda o comando com o papel e o usuário dados e MANTÉM o efeito. Devolve as
-- linhas afetadas ou o erro.
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

CREATE FUNCTION pg_temp.id(n int) RETURNS uuid LANGUAGE sql AS $$
  SELECT ('00000000-0000-4000-8131-' || lpad(n::text, 12, '0'))::uuid
$$;
GRANT EXECUTE ON FUNCTION pg_temp.id(int) TO PUBLIC;

-- Etapa (nome), status, motivo, perdido_em e entrada na etapa de um lead
CREATE FUNCTION pg_temp.lead(n int) RETURNS text LANGUAGE sql AS $$
  SELECT concat_ws(' | ', coalesce(fs.nome, 'sem etapa'), l.status,
                   'motivo=' || coalesce(m.nome, '-'), 'texto=' || coalesce(l.motivo_perda, '-'),
                   'perdido_em=' || coalesce(to_char(l.perdido_em AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI'), '-'),
                   'na_etapa_desde=' || to_char(l.stage_changed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI'))
    FROM public.leads l
    LEFT JOIN public.funnel_stages fs ON fs.id = l.stage_id
    LEFT JOIN public.motivos_perda m ON m.id = l.motivo_perda_id
   WHERE l.id = pg_temp.id(n)
$$;

CREATE FUNCTION pg_temp.historico(n int) RETURNS text LANGUAGE sql AS $$
  SELECT coalesce(string_agg(concat_ws(' ', coalesce(de.nome, 'sem etapa'), '->', para.nome,
                                       'via=' || h.movido_via, 'por=' || coalesce(h.movido_por::text, '-'),
                                       'em=' || to_char(h.criado_em AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI')),
                             '; ' ORDER BY h.criado_em), '-')
    FROM public.lead_stage_history h
    LEFT JOIN public.funnel_stages de ON de.id = h.de_stage_id
    JOIN public.funnel_stages para ON para.id = h.para_stage_id
   WHERE h.lead_id = pg_temp.id(n)
$$;

CREATE FUNCTION pg_temp.no_kanban(n int) RETURNS text LANGUAGE sql AS $$
  SELECT (count(*) = 1)::text FROM public.leads_kanban WHERE id = pg_temp.id(n)
$$;

-- ── Migração de dados: leads do dados_antes_131.sql, movidos pela 131 ───────
SELECT pg_temp.esperar('perdido em etapa sem resultado vai para a etapa de perda', pg_temp.lead(201),
  'Perdido | perdido | motivo=Timing ruim | texto=- | perdido_em=2026-03-10 12:00 | na_etapa_desde=2026-03-10 12:00');
SELECT pg_temp.esperar('histórico com a etapa de onde saiu, na data da perda', pg_temp.historico(201),
  'Negociação -> Perdido via=perdido por=- em=2026-03-10 12:00');
SELECT pg_temp.esperar('perdido sem etapa vai para a etapa de perda', pg_temp.lead(202),
  'Perdido | perdido | motivo=- | texto=Arquivado sem motivo da lista | perdido_em=2026-03-11 12:00 | na_etapa_desde=2026-03-11 12:00');
SELECT pg_temp.esperar('histórico do lead sem etapa', pg_temp.historico(202),
  'sem etapa -> Perdido via=perdido por=- em=2026-03-11 12:00');
SELECT pg_temp.esperar('perdido que mudou de etapa depois da perda', pg_temp.lead(203),
  'Perdido | perdido | motivo=Sem contato | texto=- | perdido_em=2026-03-12 12:00 | na_etapa_desde=2026-04-01 12:00');
SELECT pg_temp.esperar('histórico depois da última mudança de etapa', pg_temp.historico(203),
  'Novo -> Perdido via=perdido por=- em=2026-04-01 12:00');
SELECT pg_temp.esperar('perdido já na etapa de perda não muda', pg_temp.lead(204),
  'Perdido | perdido | motivo=Outro | texto=- | perdido_em=2026-03-13 12:00 | na_etapa_desde=2026-03-13 12:00');
SELECT pg_temp.esperar('perdido já na etapa de perda: sem histórico novo', pg_temp.historico(204), '-');
SELECT pg_temp.esperar('funil sem etapa de perda: não mexe', pg_temp.lead(205),
  'Novo | perdido | motivo=Sem interesse | texto=- | perdido_em=2026-03-14 12:00 | na_etapa_desde=2026-02-01 12:00');
SELECT pg_temp.esperar('funil sem etapa de perda: sem histórico', pg_temp.historico(205), '-');
SELECT pg_temp.esperar('aberto não mexe', pg_temp.lead(206),
  'Novo | aberto | motivo=- | texto=- | perdido_em=- | na_etapa_desde=2026-02-01 12:00');
SELECT pg_temp.esperar('aberto: sem histórico', pg_temp.historico(206), '-');

-- Os perdidos do dados_antes_126 também: arquivados na etapa Novo do funil com
-- etapa " perdido " foram movidos; o do funil comercial (sem etapa de perda) não
SELECT pg_temp.esperar('perdidos da 126 movidos para a etapa de perda',
  (SELECT string_agg(right(l.id::text, 3) || '=' || btrim(fs.nome), ', ' ORDER BY l.id)
     FROM public.leads l JOIN public.funnel_stages fs ON fs.id = l.stage_id
    WHERE l.id::text LIKE '00000000-0000-4000-8126-%' AND l.status = 'perdido'),
  '101=perdido, 102=perdido, 103=perdido, 104=perdido, 105=perdido, 109=Novo, 110=perdido');

-- ── View leads_kanban ────────────────────────────────────────────────────────
SELECT pg_temp.esperar('kanban mostra perdidos na etapa de perda e abertos',
  pg_temp.no_kanban(201) || pg_temp.no_kanban(202) || pg_temp.no_kanban(203) || pg_temp.no_kanban(204)
    || pg_temp.no_kanban(206),
  'truetruetruetruetrue');
SELECT pg_temp.esperar('kanban esconde perdido fora da etapa de perda', pg_temp.no_kanban(205), 'false');
SELECT pg_temp.esperar('painel Perdidos continua com todos os perdidos',
  (SELECT count(*)::text FROM public.leads_arquivados WHERE id::text LIKE '00000000-0000-4000-8131-%'), '5');
SELECT pg_temp.esperar('perdido no kanban traz o resultado da etapa e o motivo',
  (SELECT stage_resultado || ' ' || motivo_perda_nome FROM public.leads_kanban WHERE id = pg_temp.id(201)),
  'perdido Timing ruim');
SELECT pg_temp.esperar('nenhum perdido no kanban fora de etapa de perda',
  (SELECT count(*)::text FROM public.leads_kanban WHERE status = 'perdido' AND stage_resultado IS DISTINCT FROM 'perdido'), '0');
SELECT pg_temp.esperar('leads_kanban com security_invoker',
  (SELECT ('security_invoker=true' = ANY (reloptions))::text FROM pg_class WHERE oid = 'public.leads_kanban'::regclass),
  'true');

-- ── Comportamento com o app (authenticated) ─────────────────────────────────
INSERT INTO public.units (id, tenant_id, nome, tipo) VALUES
  ('00000000-0000-4000-8131-0000000000b0', '00000000-0000-4000-8131-0000000000f0', 'Outra 131', 'clinica');
INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('00000000-0000-4000-8131-000000000001', 'pe-atendente@teste.invalid', '{"full_name": "Atendente"}'),
  ('00000000-0000-4000-8131-000000000002', 'pe-outra@teste.invalid', '{"full_name": "Outra"}');
UPDATE public.profiles SET
  unit_id = CASE id WHEN '00000000-0000-4000-8131-000000000002' THEN '00000000-0000-4000-8131-0000000000b0'::uuid
                    ELSE '00000000-0000-4000-8131-0000000000a0'::uuid END,
  perfil  = 'atendente'
 WHERE id::text LIKE '00000000-0000-4000-8131-00000000000_';
INSERT INTO public.user_units (user_id, unit_id) VALUES
  ('00000000-0000-4000-8131-000000000001', '00000000-0000-4000-8131-0000000000a0'),
  ('00000000-0000-4000-8131-000000000002', '00000000-0000-4000-8131-0000000000b0');

INSERT INTO public.leads (id, nome, funnel_id, stage_id, unit_id) VALUES
  (pg_temp.id(301), 'Lead 131 301', '00000000-0000-4000-8131-0000000000d0', '00000000-0000-4000-8131-0000000000d2',
   '00000000-0000-4000-8131-0000000000a0'),
  (pg_temp.id(302), 'Lead 131 302', '00000000-0000-4000-8131-0000000000d0', '00000000-0000-4000-8131-0000000000d1',
   '00000000-0000-4000-8131-0000000000a0');

-- marcarPerdido: status, motivo e etapa de perda no mesmo update
SELECT pg_temp.esperar('ficha marca perdido e move para a etapa de perda',
  pg_temp.como('authenticated', '00000000-0000-4000-8131-000000000001', format(
    $c$UPDATE public.leads SET status = 'perdido', motivo_perda_id = %L, motivo_perda = 'caro demais',
              stage_id = '00000000-0000-4000-8131-0000000000d3' WHERE id = pg_temp.id(301)$c$,
    (SELECT id FROM public.motivos_perda WHERE funnel_id = '00000000-0000-4000-8131-0000000000d0' AND nome = 'Outro'))),
  '1');
SELECT pg_temp.esperar('motivo escolhido fica (não vira "Movido para a etapa")',
  (SELECT concat_ws(' | ', fs.nome, l.status, m.nome, l.motivo_perda, (l.perdido_em IS NOT NULL)::text)
     FROM public.leads l JOIN public.funnel_stages fs ON fs.id = l.stage_id
     JOIN public.motivos_perda m ON m.id = l.motivo_perda_id WHERE l.id = pg_temp.id(301)),
  'Perdido | perdido | Outro | caro demais | true');
SELECT pg_temp.esperar('atendente vê o perdido no kanban',
  pg_temp.como('authenticated', '00000000-0000-4000-8131-000000000001',
    $c$SELECT * FROM public.leads_kanban WHERE id = pg_temp.id(301)$c$), '1');
SELECT pg_temp.esperar('usuário de outra unidade não vê',
  pg_temp.como('authenticated', '00000000-0000-4000-8131-000000000002',
    $c$SELECT * FROM public.leads_kanban WHERE id = pg_temp.id(301)$c$), '0');
SELECT pg_temp.esperar('anon não lê leads_kanban',
  pg_temp.como('anon', NULL, $c$SELECT * FROM public.leads_kanban$c$), 'erro 42501');

-- Arrastar para fora da coluna de perda reabre e limpa o motivo
SELECT pg_temp.esperar('arrasta para fora da etapa de perda',
  pg_temp.como('authenticated', '00000000-0000-4000-8131-000000000001',
    $c$UPDATE public.leads SET stage_id = '00000000-0000-4000-8131-0000000000d2' WHERE id = pg_temp.id(301)$c$), '1');
SELECT pg_temp.esperar('reaberto, sem motivo, no kanban',
  (SELECT concat_ws(' | ', l.status, coalesce(l.motivo_perda_id::text, '-'), coalesce(l.motivo_perda, '-'))
     FROM public.leads l WHERE l.id = pg_temp.id(301)) || ' | ' || pg_temp.no_kanban(301),
  'aberto | - | - | true');

-- Arrastar para dentro da coluna de perda perde com motivo automático (como antes)
SELECT pg_temp.esperar('arrasta para a etapa de perda',
  pg_temp.como('authenticated', '00000000-0000-4000-8131-000000000001',
    $c$UPDATE public.leads SET stage_id = '00000000-0000-4000-8131-0000000000d3' WHERE id = pg_temp.id(302)$c$), '1');
SELECT pg_temp.esperar('perdido pela etapa e continua no kanban',
  (SELECT concat_ws(' | ', l.status, l.motivo_perda) FROM public.leads l WHERE l.id = pg_temp.id(302))
    || ' | ' || pg_temp.no_kanban(302),
  'perdido | Movido para a etapa Perdido | true');
