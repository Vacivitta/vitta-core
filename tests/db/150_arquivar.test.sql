-- Arquivar separado de Perdido (migração 132).

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
  SELECT ('00000000-0000-4000-8132-' || lpad(n::text, 12, '0'))::uuid
$$;
GRANT EXECUTE ON FUNCTION pg_temp.id(int) TO PUBLIC;

-- Etapa, status, motivo da perda e arquivamento de um lead
CREATE FUNCTION pg_temp.lead(n int) RETURNS text LANGUAGE sql AS $$
  SELECT concat_ws(' | ', coalesce(fs.nome, 'sem etapa'), l.status,
                   'perda=' || coalesce(nullif(concat_ws(': ', m.nome, l.motivo_perda), ''), '-'),
                   'arquivado=' || l.arquivado,
                   'em=' || coalesce(to_char(l.arquivado_em AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI'), '-'),
                   'motivo=' || coalesce(l.arquivado_motivo, '-'),
                   'por=' || coalesce(l.arquivado_por::text, '-'))
    FROM public.leads l
    LEFT JOIN public.funnel_stages fs ON fs.id = l.stage_id
    LEFT JOIN public.motivos_perda m ON m.id = l.motivo_perda_id
   WHERE l.id = pg_temp.id(n)
$$;

CREATE FUNCTION pg_temp.no_kanban(n int) RETURNS text LANGUAGE sql AS $$
  SELECT (count(*) = 1)::text FROM public.leads_kanban WHERE id = pg_temp.id(n)
$$;
CREATE FUNCTION pg_temp.nos_arquivados(n int) RETURNS text LANGUAGE sql AS $$
  SELECT (count(*) = 1)::text FROM public.leads_arquivados WHERE id = pg_temp.id(n)
$$;

-- ── Migração de dados: dados_antes_132.sql ───────────────────────────────────
SELECT pg_temp.esperar('arquivado antes da 126 e levado pela 131: volta a ser arquivado', pg_temp.lead(401),
  'Perdido | perdido | perda=Sem interesse: spam | arquivado=true | em=2026-06-01 10:00 | motivo=Sem interesse: spam | por=-');
SELECT pg_temp.esperar('arquivado antes da 126 com texto livre', pg_temp.lead(402),
  'Perdido | perdido | perda=Fornecedor de seringas | arquivado=true | em=2026-07-01 10:00 | motivo=Fornecedor de seringas | por=-');
SELECT pg_temp.esperar('perdido depois da 126, levado pela 131: só perdido', pg_temp.lead(403),
  'Perdido | perdido | perda=Timing ruim | arquivado=false | em=- | motivo=- | por=-');
SELECT pg_temp.esperar('perdido pela etapa "Perdido" antes da 126: só perdido', pg_temp.lead(404),
  'Perdido | perdido | perda=Outro: Estava na etapa Perdido | arquivado=false | em=- | motivo=- | por=-');
SELECT pg_temp.esperar('arquivado antes da 126 em funil sem etapa de perda: arquivado', pg_temp.lead(405),
  'Novo | perdido | perda=Sem contato | arquivado=true | em=2026-08-01 10:00 | motivo=Sem contato | por=-');
SELECT pg_temp.esperar('perdido depois da 126 em funil sem etapa de perda: só perdido', pg_temp.lead(406),
  'Novo | perdido | perda=Sem orçamento | arquivado=false | em=- | motivo=- | por=-');
SELECT pg_temp.esperar('aberto não muda', pg_temp.lead(407),
  'Novo | aberto | perda=- | arquivado=false | em=- | motivo=- | por=-');

-- Os dados das migrações anteriores: antigos arquivados da 126 (dados_antes_126) e
-- da 131 (dados_antes_131) voltam a ser arquivados; os da etapa "Perdido", não
SELECT pg_temp.esperar('antigos arquivados de dados_antes_126 e dados_antes_131',
  (SELECT string_agg(substr(l.id::text, 20, 4) || '-' || right(l.id::text, 3) || '=' || l.arquivado, ', ' ORDER BY l.id)
     FROM public.leads l
    WHERE (l.id::text LIKE '00000000-0000-4000-8126-%' OR l.id::text LIKE '00000000-0000-4000-8131-%')
      AND l.status = 'perdido'),
  '8126-101=true, 8126-102=true, 8126-103=true, 8126-104=true, 8126-105=false, 8126-109=true, 8126-110=false, '
  || '8131-201=true, 8131-202=true, 8131-203=true, 8131-204=false, 8131-205=true');
SELECT pg_temp.esperar('nenhum aberto ou ganho foi arquivado pela migração',
  (SELECT count(*)::text FROM public.leads WHERE arquivado AND status <> 'perdido'), '0');

-- ── Views ────────────────────────────────────────────────────────────────────
SELECT pg_temp.esperar('kanban esconde só os arquivados',
  pg_temp.no_kanban(401) || pg_temp.no_kanban(402) || pg_temp.no_kanban(403) || pg_temp.no_kanban(404)
    || pg_temp.no_kanban(405) || pg_temp.no_kanban(406) || pg_temp.no_kanban(407),
  'falsefalsetruetruefalsetruetrue');
SELECT pg_temp.esperar('painel Arquivados lista só os arquivados',
  (SELECT string_agg(right(id::text, 3), ',' ORDER BY arquivado_em DESC) FROM public.leads_arquivados
    WHERE id::text LIKE '00000000-0000-4000-8132-%'),
  '405,402,401');
SELECT pg_temp.esperar('painel traz motivo, data e o status do negócio',
  (SELECT concat_ws(' | ', arquivado_motivo, to_char(arquivado_em AT TIME ZONE 'UTC', 'YYYY-MM-DD'), status, motivo_perda_nome)
     FROM public.leads_arquivados WHERE id = pg_temp.id(401)),
  'Sem interesse: spam | 2026-06-01 | perdido | Sem interesse');
SELECT pg_temp.esperar('views com security_invoker',
  (SELECT string_agg(('security_invoker=true' = ANY (reloptions))::text, ',' ORDER BY relname) FROM pg_class
    WHERE oid IN ('public.leads_kanban'::regclass, 'public.leads_arquivados'::regclass)),
  'true,true');
SELECT pg_temp.esperar('anon não lê leads_arquivados',
  pg_temp.como('anon', NULL, $c$SELECT * FROM public.leads_arquivados$c$), 'erro 42501');
SELECT pg_temp.esperar('fn_lead_arquivado não é executável por authenticated nem anon',
  has_function_privilege('authenticated', 'public.fn_lead_arquivado()', 'EXECUTE')::text || ' '
    || has_function_privilege('anon', 'public.fn_lead_arquivado()', 'EXECUTE')::text,
  'false false');

-- ── Arquivar e desarquivar pelo app (authenticated) ──────────────────────────
INSERT INTO public.units (id, tenant_id, nome, tipo) VALUES
  ('00000000-0000-4000-8132-0000000000b0', '00000000-0000-4000-8132-0000000000f0', 'Outra 132', 'clinica');
INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('00000000-0000-4000-8132-000000000001', 'arq-gestor@teste.invalid', '{"full_name": "Gestor"}'),
  ('00000000-0000-4000-8132-000000000002', 'arq-outra@teste.invalid', '{"full_name": "Outra"}'),
  ('00000000-0000-4000-8132-000000000003', 'arq-atendente@teste.invalid', '{"full_name": "Atendente"}');
UPDATE public.profiles SET
  unit_id = CASE id WHEN '00000000-0000-4000-8132-000000000002' THEN '00000000-0000-4000-8132-0000000000b0'::uuid
                    ELSE '00000000-0000-4000-8132-0000000000a0'::uuid END,
  perfil  = CASE id WHEN '00000000-0000-4000-8132-000000000003' THEN 'atendente' ELSE 'gestor_unidade' END
 WHERE id::text LIKE '00000000-0000-4000-8132-00000000000_';
INSERT INTO public.user_units (user_id, unit_id) VALUES
  ('00000000-0000-4000-8132-000000000001', '00000000-0000-4000-8132-0000000000a0'),
  ('00000000-0000-4000-8132-000000000002', '00000000-0000-4000-8132-0000000000b0'),
  ('00000000-0000-4000-8132-000000000003', '00000000-0000-4000-8132-0000000000a0');

SELECT pg_temp.esperar('arquivar sem motivo viola o CHECK',
  pg_temp.como('authenticated', '00000000-0000-4000-8132-000000000001',
    $c$UPDATE public.leads SET arquivado_em = now(), arquivado_motivo = '  ' WHERE id = pg_temp.id(407)$c$), 'erro 23514');
SELECT pg_temp.esperar('usuário de outra unidade não arquiva',
  pg_temp.como('authenticated', '00000000-0000-4000-8132-000000000002',
    $c$UPDATE public.leads SET arquivado_em = now(), arquivado_motivo = 'Spam' WHERE id = pg_temp.id(407)$c$), '0');
SELECT pg_temp.esperar('arquivado continua só de leitura',
  pg_temp.como('authenticated', '00000000-0000-4000-8132-000000000001',
    $c$UPDATE public.leads SET arquivado = true WHERE id = pg_temp.id(407)$c$), 'erro 428C9');

-- A data e o autor vêm do banco, não do navegador
SELECT pg_temp.esperar('gestor da unidade arquiva um lead aberto',
  pg_temp.como('authenticated', '00000000-0000-4000-8132-000000000001',
    $c$UPDATE public.leads SET arquivado_em = '2000-01-01', arquivado_motivo = 'Spam',
              arquivado_por = '00000000-0000-4000-8132-000000000002' WHERE id = pg_temp.id(407)$c$), '1');
SELECT pg_temp.esperar('arquivado agora, pelo próprio usuário, status intacto',
  (SELECT concat_ws(' | ', l.status, l.arquivado::text, (l.arquivado_em = now())::text, l.arquivado_motivo, l.arquivado_por::text)
     FROM public.leads l WHERE l.id = pg_temp.id(407)),
  'aberto | true | true | Spam | 00000000-0000-4000-8132-000000000001');
SELECT pg_temp.esperar('arquivado sai do kanban e entra no painel',
  pg_temp.no_kanban(407) || ' ' || pg_temp.nos_arquivados(407), 'false true');
SELECT pg_temp.esperar('atendente da unidade lê o painel Arquivados',
  pg_temp.como('authenticated', '00000000-0000-4000-8132-000000000003',
    $c$SELECT * FROM public.leads_arquivados WHERE id = pg_temp.id(407)$c$), '1');
SELECT pg_temp.esperar('usuário de outra unidade não lê o painel',
  pg_temp.como('authenticated', '00000000-0000-4000-8132-000000000002',
    $c$SELECT * FROM public.leads_arquivados WHERE id = pg_temp.id(407)$c$), '0');

-- O app só deixa gestor arquivar pela ficha; o banco segue a regra de update de
-- leads (membro da unidade), como o status
SELECT pg_temp.esperar('pessoa num lead já arquivado só troca o motivo',
  pg_temp.como('authenticated', '00000000-0000-4000-8132-000000000003',
    $c$UPDATE public.leads SET arquivado_em = '2000-01-01', arquivado_motivo = 'Duplicado',
              arquivado_por = NULL WHERE id = pg_temp.id(407)$c$), '1');
SELECT pg_temp.esperar('data e autor do arquivamento mantidos',
  (SELECT concat_ws(' | ', (l.arquivado_em = now())::text, l.arquivado_motivo, l.arquivado_por::text)
     FROM public.leads l WHERE l.id = pg_temp.id(407)),
  'true | Duplicado | 00000000-0000-4000-8132-000000000001');

SELECT pg_temp.esperar('desarquivar',
  pg_temp.como('authenticated', '00000000-0000-4000-8132-000000000001',
    $c$UPDATE public.leads SET arquivado_em = NULL WHERE id = pg_temp.id(407)$c$), '1');
SELECT pg_temp.esperar('desarquivado limpa motivo e autor e volta ao kanban',
  pg_temp.lead(407) || ' | ' || pg_temp.no_kanban(407),
  'Novo | aberto | perda=- | arquivado=false | em=- | motivo=- | por=- | true');

-- Arquivar um perdido não mexe no negócio; desarquivar volta para a coluna de perda
SELECT pg_temp.esperar('arquivar um perdido',
  pg_temp.como('authenticated', '00000000-0000-4000-8132-000000000001',
    $c$UPDATE public.leads SET arquivado_em = now(), arquivado_motivo = 'Contato errado ou engano'
        WHERE id = pg_temp.id(403)$c$), '1');
SELECT pg_temp.esperar('perdido arquivado mantém etapa, status e motivo da perda',
  (SELECT concat_ws(' | ', fs.nome, l.status, m.nome, l.arquivado::text)
     FROM public.leads l JOIN public.funnel_stages fs ON fs.id = l.stage_id
     JOIN public.motivos_perda m ON m.id = l.motivo_perda_id WHERE l.id = pg_temp.id(403))
    || ' | ' || pg_temp.no_kanban(403),
  'Perdido | perdido | Timing ruim | true | false');

-- service_role (servidor, sem usuário) grava a data informada
SELECT pg_temp.esperar('service_role arquiva com a data informada',
  pg_temp.como('service_role', NULL,
    $c$UPDATE public.leads SET arquivado_em = '2026-10-01 12:00+00', arquivado_motivo = 'Outro: teste'
        WHERE id = pg_temp.id(404)$c$), '1');
SELECT pg_temp.esperar('data do service_role mantida', pg_temp.lead(404),
  'Perdido | perdido | perda=Outro: Estava na etapa Perdido | arquivado=true | em=2026-10-01 12:00 | motivo=Outro: teste | por=-');

-- Lead novo nasce não arquivado (importação, webhook, ficha)
INSERT INTO public.leads (id, nome, funnel_id, stage_id, unit_id) VALUES
  (pg_temp.id(408), 'Lead 132 408', '00000000-0000-4000-8132-0000000000d0', '00000000-0000-4000-8132-0000000000d1',
   '00000000-0000-4000-8132-0000000000a0');
SELECT pg_temp.esperar('lead novo não arquivado', pg_temp.lead(408),
  'Novo | aberto | perda=- | arquivado=false | em=- | motivo=- | por=-');

-- ── Reaplicar a 132 não rearquiva quem foi desarquivado ──────────────────────
UPDATE public.leads SET arquivado_em = NULL WHERE id = pg_temp.id(401);
\i /migracoes/132_arquivar.sql
SELECT pg_temp.esperar('reaplicar a 132 não rearquiva o desarquivado', pg_temp.lead(401),
  'Perdido | perdido | perda=Sem interesse: spam | arquivado=false | em=- | motivo=- | por=-');
SELECT pg_temp.esperar('reaplicar a 132 mantém os arquivados', pg_temp.lead(402),
  'Perdido | perdido | perda=Fornecedor de seringas | arquivado=true | em=2026-07-01 10:00 | motivo=Fornecedor de seringas | por=-');
SELECT pg_temp.esperar('desarquivado no kanban depois da reaplicação', pg_temp.no_kanban(401), 'true');
