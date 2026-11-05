-- Campos personalizados do lead (migração 129).

\set casos `cat /testes/campos_casos.json`

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

-- ── Regras puras: mesma tabela de tests/campos.test.mjs ─────────────────────
-- Variável do psql não entra em DO $$: passa pela tabela temporária
CREATE TEMP TABLE casos_json AS SELECT :'casos'::jsonb AS j;

DO $$
DECLARE divergentes text;
BEGIN
  SELECT string_agg(format('%s: %L → esperado %s, obtido %s', c->>'caso', c->>'rotulo', c->>'chave',
                           public.campo_chave_slug(c->>'rotulo')), E'\n  ')
    INTO divergentes
    FROM jsonb_array_elements((SELECT j FROM casos_json)->'chaves') c
   WHERE public.campo_chave_slug(c->>'rotulo') IS DISTINCT FROM c->>'chave';
  IF divergentes IS NOT NULL THEN
    RAISE EXCEPTION E'campo_chave_slug diverge da tabela compartilhada:\n  %', divergentes;
  END IF;

  SELECT string_agg(format('%s: esperado %s', c->>'caso', c->>'valido'), E'\n  ')
    INTO divergentes
    FROM jsonb_array_elements((SELECT j FROM casos_json)->'opcoes') c
   WHERE public.campo_opcoes_validas(CASE WHEN jsonb_typeof(c->'opcoes') = 'null' THEN NULL ELSE c->'opcoes' END)
         IS DISTINCT FROM (c->>'valido')::boolean;
  IF divergentes IS NOT NULL THEN
    RAISE EXCEPTION E'campo_opcoes_validas diverge da tabela compartilhada:\n  %', divergentes;
  END IF;

  IF (SELECT count(*) FROM jsonb_array_elements((SELECT j FROM casos_json)->'valores')) < 20 THEN
    RAISE EXCEPTION 'tabela de valores não carregou';
  END IF;
  SELECT string_agg(format('%s (%s): %s → esperado %s', c->>'caso', c->>'tipo', c->'valor', c->>'valido'), E'\n  ')
    INTO divergentes
    FROM jsonb_array_elements((SELECT j FROM casos_json)->'valores') c
   WHERE public.campo_valor_valido(c->>'tipo', c->'opcoes',
                                   CASE WHEN jsonb_typeof(c->'valor') = 'null' THEN NULL ELSE c->'valor' END)
         IS DISTINCT FROM (c->>'valido')::boolean;
  IF divergentes IS NOT NULL THEN
    RAISE EXCEPTION E'campo_valor_valido diverge da tabela compartilhada:\n  %', divergentes;
  END IF;
END $$;

-- ── Cenário ──────────────────────────────────────────────────────────────────
INSERT INTO public.tenants (id, nome) VALUES ('00000000-0000-4000-8129-0000000000f0', 'Rede Campos');
INSERT INTO public.units (id, tenant_id, nome, tipo) VALUES
  ('00000000-0000-4000-8129-0000000000a0', '00000000-0000-4000-8129-0000000000f0', 'Unidade A', 'clinica'),
  ('00000000-0000-4000-8129-0000000000b0', '00000000-0000-4000-8129-0000000000f0', 'Unidade B', 'clinica');

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('00000000-0000-4000-8129-000000000001', 'cp-atendente@teste.invalid', '{"full_name": "Atendente"}'),
  ('00000000-0000-4000-8129-000000000002', 'cp-gestor-a@teste.invalid', '{"full_name": "Gestor A"}'),
  ('00000000-0000-4000-8129-000000000003', 'cp-gestor-b@teste.invalid', '{"full_name": "Gestor B"}');
UPDATE public.profiles SET
  unit_id = CASE id WHEN '00000000-0000-4000-8129-000000000003' THEN '00000000-0000-4000-8129-0000000000b0'::uuid
                    ELSE '00000000-0000-4000-8129-0000000000a0'::uuid END,
  perfil  = CASE id WHEN '00000000-0000-4000-8129-000000000001' THEN 'atendente' ELSE 'gestor_unidade' END
 WHERE id::text LIKE '00000000-0000-4000-8129-00000000000_';
INSERT INTO public.user_units (user_id, unit_id) VALUES
  ('00000000-0000-4000-8129-000000000001', '00000000-0000-4000-8129-0000000000a0'),
  ('00000000-0000-4000-8129-000000000002', '00000000-0000-4000-8129-0000000000a0'),
  ('00000000-0000-4000-8129-000000000003', '00000000-0000-4000-8129-0000000000b0');

INSERT INTO public.funnels (id, nome, unit_id) VALUES
  ('00000000-0000-4000-8129-0000000000d0', 'Vacinas', '00000000-0000-4000-8129-0000000000a0'),
  ('00000000-0000-4000-8129-0000000000d1', 'Empresas', '00000000-0000-4000-8129-0000000000a0'),
  ('00000000-0000-4000-8129-0000000000e0', 'Funil B', '00000000-0000-4000-8129-0000000000b0');
INSERT INTO public.funnel_stages (id, funnel_id, nome, ordem, unit_id) VALUES
  ('00000000-0000-4000-8129-0000000000c0', '00000000-0000-4000-8129-0000000000d0', 'Novo', 0, '00000000-0000-4000-8129-0000000000a0'),
  ('00000000-0000-4000-8129-0000000000c1', '00000000-0000-4000-8129-0000000000d1', 'Novo', 0, '00000000-0000-4000-8129-0000000000a0');

INSERT INTO public.leads (id, nome, funnel_id, stage_id, unit_id) VALUES
  ('00000000-0000-4000-8129-000000000101', 'Paciente Um', '00000000-0000-4000-8129-0000000000d0',
   '00000000-0000-4000-8129-0000000000c0', '00000000-0000-4000-8129-0000000000a0'),
  ('00000000-0000-4000-8129-000000000102', 'Paciente Dois', '00000000-0000-4000-8129-0000000000d0',
   '00000000-0000-4000-8129-0000000000c0', '00000000-0000-4000-8129-0000000000a0'),
  ('00000000-0000-4000-8129-000000000103', 'Empresa Três', '00000000-0000-4000-8129-0000000000d1',
   '00000000-0000-4000-8129-0000000000c1', '00000000-0000-4000-8129-0000000000a0');

SELECT pg_temp.esperar('lead novo nasce com campos vazio',
  (SELECT campos::text FROM public.leads WHERE id = '00000000-0000-4000-8129-000000000101'), '{}');

-- ── Configuração: só gestor/admin, por unidade ───────────────────────────────
SELECT pg_temp.esperar('gestor cria campo de cada tipo',
  pg_temp.como('authenticated', '00000000-0000-4000-8129-000000000002', $c$
    INSERT INTO public.campos_lead (unit_id, rotulo, tipo, opcoes, ordem) VALUES
      ('00000000-0000-4000-8129-0000000000a0', 'Convênio', 'selecao', '["Unimed", "Bradesco"]', 1),
      ('00000000-0000-4000-8129-0000000000a0', 'Vacinas de interesse', 'multipla', '["Gripe", "HPV", "Dengue"]', 2),
      ('00000000-0000-4000-8129-0000000000a0', 'Data de nascimento do paciente', 'data', NULL, 3),
      ('00000000-0000-4000-8129-0000000000a0', 'Observação', 'texto', NULL, 4),
      ('00000000-0000-4000-8129-0000000000a0', 'Doses', 'numero', NULL, 5),
      ('00000000-0000-4000-8129-0000000000a0', 'Capital disponível', 'moeda', NULL, 6),
      ('00000000-0000-4000-8129-0000000000a0', 'Gestante', 'sim_nao', NULL, 7),
      ('00000000-0000-4000-8129-0000000000a0', 'Telefone do responsável', 'telefone', NULL, 8),
      ('00000000-0000-4000-8129-0000000000a0', 'E-mail financeiro', 'email', NULL, 9)$c$), '9');
SELECT pg_temp.esperar('chaves geradas do rótulo',
  (SELECT string_agg(chave, ' ' ORDER BY ordem) FROM public.campos_lead
    WHERE unit_id = '00000000-0000-4000-8129-0000000000a0'),
  'convenio vacinas_de_interesse data_de_nascimento_do_paciente observacao doses capital_disponivel gestante telefone_do_responsavel e_mail_financeiro');

SELECT pg_temp.esperar('gestor cria campo só do funil Empresas (unit_id vem do funil)',
  pg_temp.como('authenticated', '00000000-0000-4000-8129-000000000002', $c$
    INSERT INTO public.campos_lead (funnel_id, rotulo, tipo) VALUES
      ('00000000-0000-4000-8129-0000000000d1', 'CNPJ', 'texto')$c$), '1');
SELECT pg_temp.esperar('campo de funil ficou na unidade do funil',
  (SELECT unit_id::text FROM public.campos_lead WHERE chave = 'cnpj'), '00000000-0000-4000-8129-0000000000a0');
SELECT pg_temp.esperar('rótulo repetido ganha sufixo na chave',
  pg_temp.como('authenticated', '00000000-0000-4000-8129-000000000002', $c$
    INSERT INTO public.campos_lead (unit_id, rotulo, tipo) VALUES
      ('00000000-0000-4000-8129-0000000000a0', 'Convênio!', 'texto')$c$), '1');
SELECT pg_temp.esperar('chave com sufixo',
  (SELECT chave FROM public.campos_lead WHERE rotulo = 'Convênio!'), 'convenio_2');

SELECT pg_temp.esperar('gestor renomeia: a chave não muda',
  pg_temp.como('authenticated', '00000000-0000-4000-8129-000000000002', $c$
    UPDATE public.campos_lead SET rotulo = 'Plano de saúde' WHERE chave = 'convenio'$c$), '1');
SELECT pg_temp.esperar('chave estável depois de renomear',
  (SELECT chave FROM public.campos_lead WHERE rotulo = 'Plano de saúde'), 'convenio');
SELECT pg_temp.esperar('trocar a chave é recusado',
  pg_temp.como('authenticated', '00000000-0000-4000-8129-000000000002', $c$
    UPDATE public.campos_lead SET chave = 'plano' WHERE chave = 'convenio'$c$), 'erro 23514');
SELECT pg_temp.esperar('trocar o tipo é recusado',
  pg_temp.como('authenticated', '00000000-0000-4000-8129-000000000002', $c$
    UPDATE public.campos_lead SET tipo = 'texto', opcoes = NULL WHERE chave = 'convenio'$c$), 'erro 23514');
SELECT pg_temp.esperar('seleção sem opções é recusada',
  pg_temp.como('authenticated', '00000000-0000-4000-8129-000000000002', $c$
    INSERT INTO public.campos_lead (unit_id, rotulo, tipo, opcoes) VALUES
      ('00000000-0000-4000-8129-0000000000a0', 'Sem opções', 'selecao', '[]')$c$), 'erro 23514');
SELECT pg_temp.esperar('funil de outra unidade é recusado',
  pg_temp.como('authenticated', '00000000-0000-4000-8129-000000000002', $c$
    INSERT INTO public.campos_lead (unit_id, funnel_id, rotulo, tipo) VALUES
      ('00000000-0000-4000-8129-0000000000a0', '00000000-0000-4000-8129-0000000000e0', 'Invasor', 'texto')$c$), 'erro 23514');

SELECT pg_temp.esperar('atendente lê os campos da unidade',
  pg_temp.como('authenticated', '00000000-0000-4000-8129-000000000001',
    $c$SELECT * FROM public.campos_lead$c$), '11');
-- WITH CHECK da policy de INSERT barra: o erro é de RLS (42501), não 0 linhas
SELECT pg_temp.esperar('atendente não cria campo',
  pg_temp.como('authenticated', '00000000-0000-4000-8129-000000000001', $c$
    INSERT INTO public.campos_lead (unit_id, rotulo, tipo) VALUES
      ('00000000-0000-4000-8129-0000000000a0', 'Do atendente', 'texto')$c$), 'erro 42501');
SELECT pg_temp.esperar('atendente não altera campo',
  pg_temp.como('authenticated', '00000000-0000-4000-8129-000000000001', $c$
    UPDATE public.campos_lead SET rotulo = 'x'$c$), '0');
SELECT pg_temp.esperar('ninguém apaga campo pelo navegador (desativa)',
  pg_temp.como('authenticated', '00000000-0000-4000-8129-000000000002', $c$
    DELETE FROM public.campos_lead$c$), 'erro 42501');
SELECT pg_temp.esperar('gestor de outra unidade não vê',
  pg_temp.como('authenticated', '00000000-0000-4000-8129-000000000003',
    $c$SELECT * FROM public.campos_lead$c$), '0');
SELECT pg_temp.esperar('gestor de outra unidade não altera',
  pg_temp.como('authenticated', '00000000-0000-4000-8129-000000000003', $c$
    UPDATE public.campos_lead SET rotulo = 'x'$c$), '0');
SELECT pg_temp.esperar('gestor de outra unidade não cria na unidade alheia',
  pg_temp.como('authenticated', '00000000-0000-4000-8129-000000000003', $c$
    INSERT INTO public.campos_lead (unit_id, rotulo, tipo) VALUES
      ('00000000-0000-4000-8129-0000000000a0', 'Invasor', 'texto')$c$), 'erro 42501');
SELECT pg_temp.esperar('anon não lê',
  pg_temp.como('anon', NULL, $c$SELECT * FROM public.campos_lead$c$), 'erro 42501');

-- ── Valores no lead (o atendente grava pela ficha) ───────────────────────────
CREATE TEMP TABLE casos_lead (ordem serial, caso text, campos text, esperado text);
INSERT INTO casos_lead (caso, campos, esperado) VALUES
  ('um valor válido de cada tipo', $j${"convenio": "Unimed", "vacinas_de_interesse": ["HPV", "Gripe"],
     "data_de_nascimento_do_paciente": "2020-02-29", "observacao": "prefere manhã", "doses": 2,
     "capital_disponivel": 150000.5, "gestante": false, "telefone_do_responsavel": "(31) 99667-4494",
     "e_mail_financeiro": "fin@exemplo.com.br"}$j$, '1'),
  ('seleção fora das opções', '{"convenio": "Amil"}', 'erro 23514'),
  ('múltipla fora das opções', '{"vacinas_de_interesse": ["Febre amarela"]}', 'erro 23514'),
  ('data inexistente', '{"data_de_nascimento_do_paciente": "2021-02-29"}', 'erro 23514'),
  ('data em formato brasileiro', '{"data_de_nascimento_do_paciente": "29/02/2020"}', 'erro 23514'),
  ('número em texto', '{"doses": "2"}', 'erro 23514'),
  ('moeda com 3 casas', '{"capital_disponivel": 1.005}', 'erro 23514'),
  ('sim/não em texto', '{"gestante": "não"}', 'erro 23514'),
  ('telefone curto', '{"telefone_do_responsavel": "1234"}', 'erro 23514'),
  ('e-mail inválido', '{"e_mail_financeiro": "fin@"}', 'erro 23514'),
  ('texto em branco', '{"observacao": " "}', 'erro 23514'),
  ('chave desconhecida', '{"nao_existe": "x"}', 'erro 23514'),
  ('campos que não é objeto', '["x"]', 'erro 23514'),
  ('campo de outro funil (CNPJ é do Empresas)', '{"cnpj": "00.000.000/0001-00"}', 'erro 23514');

DO $$
DECLARE
  c record;
  obtido text;
  divergentes text[] := '{}';
BEGIN
  FOR c IN SELECT * FROM casos_lead ORDER BY ordem LOOP
    obtido := pg_temp.como('authenticated', '00000000-0000-4000-8129-000000000001',
      format('UPDATE public.leads SET campos = %L::jsonb WHERE id = %L', c.campos, '00000000-0000-4000-8129-000000000101'));
    IF obtido IS DISTINCT FROM c.esperado THEN
      divergentes := divergentes || format('%s: esperado %s, obtido %s', c.caso, c.esperado, obtido);
    END IF;
  END LOOP;
  IF cardinality(divergentes) > 0 THEN
    RAISE EXCEPTION E'% de % casos divergentes:\n  %', cardinality(divergentes), (SELECT count(*) FROM casos_lead),
      array_to_string(divergentes, E'\n  ');
  END IF;
END $$;

SELECT pg_temp.esperar('valores recusados não mudaram o que estava gravado',
  (SELECT campos->>'convenio' || ' ' || (campos->>'doses') FROM public.leads
    WHERE id = '00000000-0000-4000-8129-000000000101'), 'Unimed 2');
SELECT pg_temp.esperar('valor null tira a chave',
  pg_temp.como('authenticated', '00000000-0000-4000-8129-000000000001', $c$
    UPDATE public.leads SET campos = campos || '{"observacao": null}'
     WHERE id = '00000000-0000-4000-8129-000000000101'$c$), '1');
SELECT pg_temp.esperar('chave limpa saiu do objeto',
  (SELECT (campos ? 'observacao')::text FROM public.leads WHERE id = '00000000-0000-4000-8129-000000000101'), 'false');
SELECT pg_temp.esperar('service_role (importação) também é validado',
  pg_temp.como('service_role', NULL, $c$
    INSERT INTO public.leads (nome, funnel_id, unit_id, campos) VALUES ('Importado',
      '00000000-0000-4000-8129-0000000000d0', '00000000-0000-4000-8129-0000000000a0', '{"doses": "três"}')$c$), 'erro 23514');

-- Campo de funil: vale só para os leads daquele funil
SELECT pg_temp.esperar('campo do funil aceito no lead do funil',
  pg_temp.como('authenticated', '00000000-0000-4000-8129-000000000001', $c$
    UPDATE public.leads SET campos = '{"cnpj": "00.000.000/0001-00", "convenio": "Bradesco"}'
     WHERE id = '00000000-0000-4000-8129-000000000103'$c$), '1');
-- O lead troca de funil: o valor fica guardado e continua aceito enquanto não muda
UPDATE public.leads SET funnel_id = '00000000-0000-4000-8129-0000000000d0', stage_id = '00000000-0000-4000-8129-0000000000c0'
 WHERE id = '00000000-0000-4000-8129-000000000103';
SELECT pg_temp.esperar('valor de campo de outro funil, igual ao guardado, passa',
  pg_temp.como('authenticated', '00000000-0000-4000-8129-000000000001', $c$
    UPDATE public.leads SET campos = campos || '{"convenio": "Unimed"}'
     WHERE id = '00000000-0000-4000-8129-000000000103'$c$), '1');
SELECT pg_temp.esperar('valor novo em campo de outro funil é recusado',
  pg_temp.como('authenticated', '00000000-0000-4000-8129-000000000001', $c$
    UPDATE public.leads SET campos = campos || '{"cnpj": "11.111.111/0001-11"}'
     WHERE id = '00000000-0000-4000-8129-000000000103'$c$), 'erro 23514');

-- Campo desativado: guarda o valor, aceita mantê-lo, recusa mudá-lo
SELECT pg_temp.esperar('gestor desativa campo',
  pg_temp.como('authenticated', '00000000-0000-4000-8129-000000000002', $c$
    UPDATE public.campos_lead SET ativo = false WHERE chave = 'doses'$c$), '1');
SELECT pg_temp.esperar('desativar não apaga o valor',
  (SELECT campos->>'doses' FROM public.leads WHERE id = '00000000-0000-4000-8129-000000000101'), '2');
SELECT pg_temp.esperar('outro campo grava com o desativado mantido igual',
  pg_temp.como('authenticated', '00000000-0000-4000-8129-000000000001', $c$
    UPDATE public.leads SET campos = campos || '{"gestante": true}'
     WHERE id = '00000000-0000-4000-8129-000000000101'$c$), '1');
SELECT pg_temp.esperar('mudar o valor de campo desativado é recusado',
  pg_temp.como('authenticated', '00000000-0000-4000-8129-000000000001', $c$
    UPDATE public.leads SET campos = campos || '{"doses": 3}'
     WHERE id = '00000000-0000-4000-8129-000000000101'$c$), 'erro 23514');
SELECT pg_temp.esperar('usuário de outra unidade não grava no lead',
  pg_temp.como('authenticated', '00000000-0000-4000-8129-000000000003', $c$
    UPDATE public.leads SET campos = '{}' WHERE id = '00000000-0000-4000-8129-000000000101'$c$), '0');

-- ── Mesclar: campos fundidos e o resto da 126/127/128 na mesma mesclagem ─────
-- 126 a 129 recriam mesclar_leads inteira e a última aplicada vale: se a 129
-- partisse de um corpo antigo, status, tags ou anexos deixariam de ser tratados.
UPDATE public.leads SET campos = '{"convenio": "Bradesco", "observacao": "do removido", "doses": 5}'
 WHERE id = '00000000-0000-4000-8129-000000000102';
UPDATE public.leads SET status = 'ganho' WHERE id = '00000000-0000-4000-8129-000000000102';
INSERT INTO public.wa_tags (id, unit_id, name) VALUES
  ('00000000-0000-4000-8129-000000000301', '00000000-0000-4000-8129-0000000000a0', 'VIP'),
  ('00000000-0000-4000-8129-000000000302', '00000000-0000-4000-8129-0000000000a0', 'Gestante');
INSERT INTO public.lead_tags (lead_id, tag_id) VALUES
  ('00000000-0000-4000-8129-000000000101', '00000000-0000-4000-8129-000000000301'),
  ('00000000-0000-4000-8129-000000000102', '00000000-0000-4000-8129-000000000301'),
  ('00000000-0000-4000-8129-000000000102', '00000000-0000-4000-8129-000000000302');
INSERT INTO public.lead_anexos (lead_id, caminho, nome, mime, tamanho) VALUES
  ('00000000-0000-4000-8129-000000000102', 'a/102/carteira.pdf', 'carteira.pdf', 'application/pdf', 10);

-- Como a rota api/leads/mesclar chama: service_role
SELECT pg_temp.esperar('mesclar como service_role',
  pg_temp.como('service_role', NULL, $c$
    SELECT public.mesclar_leads('00000000-0000-4000-8129-000000000101', '00000000-0000-4000-8129-000000000102')$c$), '1');

DO $$
DECLARE
  l public.leads%ROWTYPE;
  tags text;
BEGIN
  SELECT * INTO l FROM public.leads WHERE id = '00000000-0000-4000-8129-000000000101';
  -- convenio e doses: o mantido vence (doses é de campo desativado e veio igual);
  -- observacao: o mantido não tinha, vem do removido
  IF l.campos->>'convenio' IS DISTINCT FROM 'Unimed' OR l.campos->>'doses' IS DISTINCT FROM '2'
     OR l.campos->>'observacao' IS DISTINCT FROM 'do removido' OR l.campos->>'gestante' IS DISTINCT FROM 'true'
     OR l.campos->'vacinas_de_interesse' IS DISTINCT FROM '["HPV", "Gripe"]'::jsonb THEN
    RAISE EXCEPTION 'mesclar_leads deveria fundir campos (mantido vence, removido completa): obtido %', l.campos;
  END IF;
  IF l.status IS DISTINCT FROM 'ganho' OR l.ganho_em IS NULL OR NOT l.is_converted THEN
    RAISE EXCEPTION 'mesclar_leads deveria consolidar o status (aberto + ganho = ganho): obtido %, ganho_em %, cliente %',
      l.status, l.ganho_em, l.is_converted;
  END IF;
  SELECT string_agg(right(tag_id::text, 3), ' ' ORDER BY tag_id) INTO tags
    FROM public.lead_tags WHERE lead_id = '00000000-0000-4000-8129-000000000101';
  IF tags IS DISTINCT FROM '301 302' THEN
    RAISE EXCEPTION 'mesclar_leads deveria mover as tags sem duplicar (esperado 301 302, obtido %)', tags;
  END IF;
  IF (SELECT count(*) FROM public.lead_anexos WHERE lead_id = '00000000-0000-4000-8129-000000000101') <> 1 THEN
    RAISE EXCEPTION 'mesclar_leads deveria mover os anexos na mesma mesclagem';
  END IF;
  IF EXISTS (SELECT 1 FROM public.leads WHERE id = '00000000-0000-4000-8129-000000000102') THEN
    RAISE EXCEPTION 'o lead removido deveria ter sido apagado';
  END IF;
END $$;

-- Valor que só o removido tinha, de campo já desativado: a mesclagem leva junto
UPDATE public.leads SET campos = '{"doses": 7}' WHERE id = '00000000-0000-4000-8129-000000000103';
UPDATE public.leads SET campos = campos - 'doses' WHERE id = '00000000-0000-4000-8129-000000000101';
SELECT pg_temp.esperar('mesclar com valor de campo desativado no removido',
  pg_temp.como('service_role', NULL, $c$
    SELECT public.mesclar_leads('00000000-0000-4000-8129-000000000101', '00000000-0000-4000-8129-000000000103')$c$), '1');
SELECT pg_temp.esperar('valor do campo desativado veio do removido',
  (SELECT campos->>'doses' FROM public.leads WHERE id = '00000000-0000-4000-8129-000000000101'), '7');

-- ── Privilégios ──────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF has_function_privilege('authenticated', 'public.mesclar_leads(uuid,uuid,uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.campo_valor_valido(text,jsonb,jsonb)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.fn_lead_campos()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.fn_campo_lead()', 'EXECUTE') THEN
    RAISE EXCEPTION 'funções da 129 executáveis por quem não deveria';
  END IF;
  IF has_table_privilege('authenticated', 'public.campos_lead', 'DELETE')
     OR has_table_privilege('authenticated', 'public.campos_lead', 'TRUNCATE') THEN
    RAISE EXCEPTION 'authenticated não deveria apagar campos_lead';
  END IF;
END $$;
