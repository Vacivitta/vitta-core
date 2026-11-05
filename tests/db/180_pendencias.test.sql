-- Pendências das fases 1 e 2 (migração 135): excluir etapa/funil sem perder
-- histórico, criação de campanha numa transação só, meta da unidade sem duplicata.

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
  SELECT ('00000000-0000-4000-8135-' || lpad(n::text, 12, '0'))::uuid
$$;
GRANT EXECUTE ON FUNCTION pg_temp.id(int) TO PUBLIC;

-- Movimentos de etapa do lead, com "excluída" onde a etapa foi apagada
CREATE FUNCTION pg_temp.historico(n int) RETURNS text LANGUAGE sql AS $$
  SELECT coalesce(string_agg(concat_ws(' ', coalesce(de.nome, CASE WHEN h.de_stage_id IS NULL THEN 'excluída' END),
                                       '->', coalesce(para.nome, CASE WHEN h.para_stage_id IS NULL THEN 'excluída' END),
                                       'via=' || h.movido_via),
                             '; ' ORDER BY h.criado_em), '-')
    FROM public.lead_stage_history h
    LEFT JOIN public.funnel_stages de ON de.id = h.de_stage_id
    LEFT JOIN public.funnel_stages para ON para.id = h.para_stage_id
   WHERE h.lead_id = pg_temp.id(n)
$$;

-- ── Dados ────────────────────────────────────────────────────────────────────
INSERT INTO public.tenants (id, nome) VALUES (pg_temp.id(900), 'Rede 135');
INSERT INTO public.units (id, tenant_id, nome, tipo) VALUES
  (pg_temp.id(901), pg_temp.id(900), 'Unidade A 135', 'clinica'),
  (pg_temp.id(902), pg_temp.id(900), 'Unidade B 135', 'clinica');
INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  (pg_temp.id(1), 'pd-gestor-a@teste.invalid', '{"full_name": "Gestor A"}'),
  (pg_temp.id(2), 'pd-gestor-b@teste.invalid', '{"full_name": "Gestor B"}'),
  (pg_temp.id(3), 'pd-atendente-a@teste.invalid', '{"full_name": "Atendente A"}');
UPDATE public.profiles SET
  unit_id = CASE id WHEN pg_temp.id(2) THEN pg_temp.id(902) ELSE pg_temp.id(901) END,
  perfil  = CASE id WHEN pg_temp.id(3) THEN 'atendente' ELSE 'gestor_unidade' END
 WHERE id IN (pg_temp.id(1), pg_temp.id(2), pg_temp.id(3));
INSERT INTO public.user_units (user_id, unit_id) VALUES
  (pg_temp.id(1), pg_temp.id(901)), (pg_temp.id(2), pg_temp.id(902)), (pg_temp.id(3), pg_temp.id(901));

-- Funil 10 com leads (etapas 11, 12, 13); funil 20 sem leads (etapa 21)
INSERT INTO public.funnels (id, nome, unit_id) VALUES
  (pg_temp.id(10), 'Funil com leads', pg_temp.id(901)),
  (pg_temp.id(20), 'Funil vazio', pg_temp.id(901)),
  (pg_temp.id(30), 'Funil B', pg_temp.id(902));
INSERT INTO public.funnel_stages (id, funnel_id, nome, ordem, unit_id) VALUES
  (pg_temp.id(11), pg_temp.id(10), 'Novo', 0, pg_temp.id(901)),
  (pg_temp.id(12), pg_temp.id(10), 'Negociação', 1, pg_temp.id(901)),
  (pg_temp.id(13), pg_temp.id(10), 'Contato', 2, pg_temp.id(901)),
  (pg_temp.id(21), pg_temp.id(20), 'Novo', 0, pg_temp.id(901));
INSERT INTO public.motivos_perda (id, funnel_id, nome) VALUES (pg_temp.id(22), pg_temp.id(20), 'Motivo do funil vazio');
INSERT INTO public.campos_lead (id, funnel_id, rotulo, tipo) VALUES (pg_temp.id(23), pg_temp.id(20), 'Documento 135', 'texto');

INSERT INTO public.leads (id, nome, telefone, funnel_id, stage_id, unit_id) VALUES
  (pg_temp.id(101), 'Lead 135 Um', '(31) 99135-0101', pg_temp.id(10), pg_temp.id(12), pg_temp.id(901)),
  (pg_temp.id(102), 'Lead 135 Dois', '(31) 99135-0102', pg_temp.id(10), pg_temp.id(11), pg_temp.id(901)),
  (pg_temp.id(103), 'Lead 135 Três', '(31) 99135-0103', pg_temp.id(10), pg_temp.id(11), pg_temp.id(901)),
  (pg_temp.id(201), 'Lead 135 B', '(31) 99135-0201', pg_temp.id(30), NULL, pg_temp.id(902));
-- 102: só arquivado (fora do quadro); 103: perdido com motivo de outro funil e
-- valor de campo do funil vazio (trocou de funil); supabase_admin grava sem validar
UPDATE public.leads SET arquivado_em = now(), arquivado_motivo = 'Spam' WHERE id = pg_temp.id(102);
UPDATE public.leads SET status = 'perdido', motivo_perda_id = pg_temp.id(22), campos = '{"documento_135": "123"}'
 WHERE id = pg_temp.id(103);
-- 101 passou pela etapa Contato: Novo -> Contato -> Negociação
INSERT INTO public.lead_stage_history (lead_id, de_stage_id, para_stage_id, movido_via, criado_em) VALUES
  (pg_temp.id(101), pg_temp.id(11), pg_temp.id(13), 'manual', now() - interval '2 days'),
  (pg_temp.id(101), pg_temp.id(13), pg_temp.id(12), 'manual', now() - interval '1 day');

-- ── Excluir etapa ────────────────────────────────────────────────────────────
SELECT pg_temp.esperar('etapa com lead aberto não exclui',
  pg_temp.como('authenticated', pg_temp.id(1), $c$DELETE FROM public.funnel_stages WHERE id = pg_temp.id(12)$c$),
  'erro 23503');
SELECT pg_temp.esperar('etapa só com leads arquivado e perdido não exclui',
  pg_temp.como('authenticated', pg_temp.id(1), $c$DELETE FROM public.funnel_stages WHERE id = pg_temp.id(11)$c$),
  'erro 23503');
SELECT pg_temp.esperar('service_role também não exclui etapa com lead',
  pg_temp.como('service_role', NULL, $c$DELETE FROM public.funnel_stages WHERE id = pg_temp.id(12)$c$),
  'erro 23503');
SELECT pg_temp.esperar('lead continua na etapa', (SELECT stage_id::text FROM public.leads WHERE id = pg_temp.id(101)),
  pg_temp.id(12)::text);

SELECT pg_temp.esperar('etapa vazia exclui',
  pg_temp.como('authenticated', pg_temp.id(1), $c$DELETE FROM public.funnel_stages WHERE id = pg_temp.id(13)$c$), '1');
SELECT pg_temp.esperar('histórico de quem passou pela etapa excluída preservado', pg_temp.historico(101),
  'Novo -> excluída via=manual; excluída -> Negociação via=manual');

SELECT pg_temp.esperar('movimento novo sem etapa de destino é recusado',
  pg_temp.como('service_role', NULL,
    $c$INSERT INTO public.lead_stage_history (lead_id, de_stage_id, para_stage_id) VALUES (pg_temp.id(101), pg_temp.id(12), NULL)$c$),
  'erro 23502');

-- ── Excluir funil ────────────────────────────────────────────────────────────
SELECT pg_temp.esperar('funil com leads não exclui',
  pg_temp.como('authenticated', pg_temp.id(1), $c$DELETE FROM public.funnels WHERE id = pg_temp.id(10)$c$), 'erro 23503');
SELECT pg_temp.esperar('funil com leads e etapas intactos',
  (SELECT count(*)::text FROM public.funnel_stages WHERE funnel_id = pg_temp.id(10)), '2');

-- Lead sem etapa, mas no funil, também segura o funil
INSERT INTO public.leads (id, nome, funnel_id, unit_id) VALUES (pg_temp.id(104), 'Lead 135 sem etapa', pg_temp.id(20), pg_temp.id(901));
SELECT pg_temp.esperar('funil com lead sem etapa não exclui',
  pg_temp.como('authenticated', pg_temp.id(1), $c$DELETE FROM public.funnels WHERE id = pg_temp.id(20)$c$), 'erro 23503');
DELETE FROM public.leads WHERE id = pg_temp.id(104);

SELECT pg_temp.esperar('funil vazio exclui (etapas em cascata)',
  pg_temp.como('authenticated', pg_temp.id(1), $c$DELETE FROM public.funnels WHERE id = pg_temp.id(20)$c$), '1');
SELECT pg_temp.esperar('etapas do funil vazio foram junto',
  (SELECT count(*)::text FROM public.funnel_stages WHERE id = pg_temp.id(21)), '0');
SELECT pg_temp.esperar('campo do funil excluído vira campo da unidade, desativado, mesma chave',
  (SELECT concat_ws(' | ', chave, coalesce(funnel_id::text, 'sem funil'), ativo::text, (unit_id = pg_temp.id(901))::text)
     FROM public.campos_lead WHERE id = pg_temp.id(23)),
  'documento_135 | sem funil | false | true');
SELECT pg_temp.esperar('valor do campo no lead que trocou de funil continua',
  (SELECT campos ->> 'documento_135' FROM public.leads WHERE id = pg_temp.id(103)), '123');
SELECT pg_temp.esperar('motivo do funil excluído: nome copiado, lead continua perdido',
  (SELECT concat_ws(' | ', status, coalesce(motivo_perda_id::text, 'sem id'), motivo_perda)
     FROM public.leads WHERE id = pg_temp.id(103)),
  'perdido | sem id | Motivo do funil vazio');

-- ── Funil/etapa usados como filtro de automação por tempo ───────────────────
-- Funil 40 e etapa 41 vazios (sem leads). Com ON DELETE SET NULL o filtro sumia e
-- a automação passava a valer para a unidade toda; agora a exclusão é recusada.
INSERT INTO public.funnels (id, nome, unit_id) VALUES (pg_temp.id(40), 'Funil filtro', pg_temp.id(901));
INSERT INTO public.funnel_stages (id, funnel_id, nome, ordem, unit_id) VALUES
  (pg_temp.id(41), pg_temp.id(40), 'Parado', 0, pg_temp.id(901)),
  (pg_temp.id(42), pg_temp.id(40), 'Livre', 1, pg_temp.id(901));
INSERT INTO public.wa_timed_automations (id, unit_id, nome, condition, action, filter_funnel_id, filter_stage_id) VALUES
  (pg_temp.id(43), pg_temp.id(901), 'Parado na etapa', 'lead_stuck_stage', 'send_template', NULL, pg_temp.id(41)),
  (pg_temp.id(44), pg_temp.id(901), 'Sem resposta no funil', 'no_patient_reply', 'send_template', pg_temp.id(40), NULL);

SELECT pg_temp.esperar('etapa vazia usada como filtro de automação não exclui',
  pg_temp.como('authenticated', pg_temp.id(1), $c$DELETE FROM public.funnel_stages WHERE id = pg_temp.id(41)$c$),
  'erro 23503');
SELECT pg_temp.esperar('etapa vazia fora de filtro exclui',
  pg_temp.como('authenticated', pg_temp.id(1), $c$DELETE FROM public.funnel_stages WHERE id = pg_temp.id(42)$c$), '1');
SELECT pg_temp.esperar('funil vazio usado como filtro de automação não exclui',
  pg_temp.como('authenticated', pg_temp.id(1), $c$DELETE FROM public.funnels WHERE id = pg_temp.id(40)$c$),
  'erro 23503');
SELECT pg_temp.esperar('filtros das automações intactos',
  (SELECT string_agg(concat_ws(' ', nome, coalesce(filter_funnel_id::text, '-'), coalesce(filter_stage_id::text, '-')), '; ' ORDER BY nome)
     FROM public.wa_timed_automations WHERE id IN (pg_temp.id(43), pg_temp.id(44))),
  concat('Parado na etapa - ', pg_temp.id(41), '; Sem resposta no funil ', pg_temp.id(40), ' -'));

-- Só com o filtro de etapa: a cascata do funil para as etapas esbarra nele
DELETE FROM public.wa_timed_automations WHERE id = pg_temp.id(44);
SELECT pg_temp.esperar('funil com etapa filtrada por automação não exclui',
  pg_temp.como('authenticated', pg_temp.id(1), $c$DELETE FROM public.funnels WHERE id = pg_temp.id(40)$c$),
  'erro 23503');
-- Só com o filtro de funil
INSERT INTO public.wa_timed_automations (id, unit_id, nome, condition, action, filter_funnel_id) VALUES
  (pg_temp.id(44), pg_temp.id(901), 'Sem resposta no funil', 'no_patient_reply', 'send_template', pg_temp.id(40));
DELETE FROM public.wa_timed_automations WHERE id = pg_temp.id(43);
SELECT pg_temp.esperar('funil filtrado por automação não exclui',
  pg_temp.como('authenticated', pg_temp.id(1), $c$DELETE FROM public.funnels WHERE id = pg_temp.id(40)$c$),
  'erro 23503');
DELETE FROM public.wa_timed_automations WHERE id = pg_temp.id(44);
SELECT pg_temp.esperar('funil sem automação exclui',
  pg_temp.como('authenticated', pg_temp.id(1), $c$DELETE FROM public.funnels WHERE id = pg_temp.id(40)$c$), '1');

-- ── Criação de campanha ──────────────────────────────────────────────────────
INSERT INTO public.wa_message_templates (id, unit_id, name, content, category) VALUES
  (pg_temp.id(301), pg_temp.id(901), 'promo_135', 'Olá {{1}}', 'marketing'),
  (pg_temp.id(302), pg_temp.id(901), 'aviso_135', 'Aviso', 'utility');

SELECT pg_temp.esperar('gestor cria campanha com destinatários',
  pg_temp.como('authenticated', pg_temp.id(1), $c$
    SELECT public.criar_campanha(pg_temp.id(901), '  Campanha 135  ', pg_temp.id(301), NULL, 50, jsonb_build_array(
      jsonb_build_object('lead_id', pg_temp.id(101), 'phone', '5531991350101', 'nome', 'Lead 135 Um',
                         'has_optin', true, 'in_csw', false, 'cost_usd', 0.0625),
      jsonb_build_object('lead_id', NULL, 'phone', '5531991350999', 'nome', 'Planilha',
                         'has_optin', true, 'in_csw', false, 'cost_usd', 0.0625)))$c$), '1');
SELECT pg_temp.esperar('campanha com dados do template, totais calculados e autor',
  (SELECT concat_ws(' | ', nome, template_nome, template_category, status, daily_limit, total_recipients,
                    estimated_cost_usd, (created_by = pg_temp.id(1))::text)
     FROM public.wa_campaigns WHERE unit_id = pg_temp.id(901)),
  'Campanha 135 | promo_135 | marketing | rascunho | 50 | 2 | 0.1250 | true');
SELECT pg_temp.esperar('destinatários gravados',
  (SELECT string_agg(concat_ws(' ', r.phone, coalesce(r.lead_id = pg_temp.id(101), false)::text, r.has_optin::text, r.status), ', ' ORDER BY r.phone)
     FROM public.wa_campaign_recipients r JOIN public.wa_campaigns c ON c.id = r.campaign_id
    WHERE c.unit_id = pg_temp.id(901)),
  '5531991350101 true true pending, 5531991350999 false true pending');

SELECT pg_temp.esperar('agendada no futuro nasce agendada',
  pg_temp.como('authenticated', pg_temp.id(1), $c$
    SELECT public.criar_campanha(pg_temp.id(901), 'Agendada 135', pg_temp.id(302), now() + interval '1 day', 10,
      '[{"phone": "5531991350102", "nome": "X", "in_csw": true, "cost_usd": 0}]')$c$), '1');
SELECT pg_temp.esperar('agendada: status e categoria utility',
  (SELECT concat_ws(' | ', status, template_category, (scheduled_at > now())::text) FROM public.wa_campaigns
    WHERE nome = 'Agendada 135'),
  'agendada | utility | true');

-- Falha no meio: o custo 99999 cabe na campanha (numeric(10,4)) e estoura no
-- destinatário (numeric(10,6)), depois que a campanha já foi inserida
SELECT pg_temp.esperar('falha ao gravar destinatário desfaz a campanha',
  pg_temp.como('authenticated', pg_temp.id(1), $c$
    SELECT public.criar_campanha(pg_temp.id(901), 'Falha 135', pg_temp.id(301), NULL, 50,
      '[{"phone": "5531991350103", "cost_usd": 0.0625}, {"phone": "5531991350104", "cost_usd": 99999}]')$c$),
  'erro 22003');
SELECT pg_temp.esperar('nenhuma campanha nem destinatário da falha',
  (SELECT count(*)::text FROM public.wa_campaigns WHERE nome = 'Falha 135')
    || ' ' || (SELECT count(*)::text FROM public.wa_campaign_recipients WHERE phone IN ('5531991350103', '5531991350104')),
  '0 0');

SELECT pg_temp.esperar('lead de outra unidade é recusado',
  pg_temp.como('authenticated', pg_temp.id(1), $c$
    SELECT public.criar_campanha(pg_temp.id(901), 'Outra unidade 135', pg_temp.id(301), NULL, 50,
      jsonb_build_array(jsonb_build_object('lead_id', pg_temp.id(201), 'phone', '5531991350201')))$c$),
  'erro 42501');
SELECT pg_temp.esperar('destinatário sem telefone é recusado',
  pg_temp.como('authenticated', pg_temp.id(1), $c$
    SELECT public.criar_campanha(pg_temp.id(901), 'Sem telefone 135', pg_temp.id(301), NULL, 50,
      '[{"phone": "5531991350105"}, {"phone": " "}]')$c$),
  'erro 22023');
SELECT pg_temp.esperar('sem destinatários é recusado',
  pg_temp.como('authenticated', pg_temp.id(1), $c$
    SELECT public.criar_campanha(pg_temp.id(901), 'Vazia 135', pg_temp.id(301), NULL, 50, '[]')$c$),
  'erro 22023');
SELECT pg_temp.esperar('agendamento no passado é recusado',
  pg_temp.como('authenticated', pg_temp.id(1), $c$
    SELECT public.criar_campanha(pg_temp.id(901), 'Passado 135', pg_temp.id(301), now() - interval '1 minute', 50,
      '[{"phone": "5531991350106"}]')$c$),
  'erro 22023');
SELECT pg_temp.esperar('gestor de outra unidade não cria campanha na unidade A',
  pg_temp.como('authenticated', pg_temp.id(2), $c$
    SELECT public.criar_campanha(pg_temp.id(901), 'Invasão 135', pg_temp.id(301), NULL, 50,
      '[{"phone": "5531991350107"}]')$c$),
  'erro 22023');
SELECT pg_temp.esperar('anon não executa criar_campanha',
  pg_temp.como('anon', NULL, $c$
    SELECT public.criar_campanha('00000000-0000-4000-8135-000000000901', 'Anon 135', '00000000-0000-4000-8135-000000000301',
      NULL, 50, '[{"phone": "5531991350108"}]')$c$),
  'erro 42501');
SELECT pg_temp.esperar('só as duas campanhas válidas ficaram',
  (SELECT count(*)::text FROM public.wa_campaigns WHERE unit_id IN (pg_temp.id(901), pg_temp.id(902))), '2');

-- Disparar e cron não mudam: a campanha criada é enviada pela reserva da 123
UPDATE public.wa_campaigns SET status = 'enviando' WHERE nome = 'Campanha 135';
SELECT pg_temp.esperar('cron reserva os destinatários da campanha criada',
  pg_temp.como('service_role', NULL, $c$
    SELECT * FROM public.reservar_destinatarios_campanha((SELECT id FROM public.wa_campaigns WHERE nome = 'Campanha 135'), 10)$c$),
  '2');

-- ── Meta da unidade sem duplicata ────────────────────────────────────────────
INSERT INTO public.sales_goals (unit_id, user_id, month, target) VALUES (pg_temp.id(901), NULL, '2026-11-01', 100);
SELECT pg_temp.esperar('segunda meta da unidade no mesmo mês é recusada',
  pg_temp.como('service_role', NULL,
    $c$INSERT INTO public.sales_goals (unit_id, user_id, month, target) VALUES (pg_temp.id(901), NULL, '2026-11-01', 200)$c$),
  'erro 23505');
SELECT pg_temp.esperar('upsert da rota atualiza a meta da unidade',
  pg_temp.como('service_role', NULL,
    $c$INSERT INTO public.sales_goals (unit_id, user_id, month, target) VALUES (pg_temp.id(901), NULL, '2026-11-01', 300)
       ON CONFLICT (unit_id, user_id, month) DO UPDATE SET target = excluded.target$c$),
  '1');
SELECT pg_temp.esperar('uma meta só, com o valor novo',
  (SELECT string_agg(target::text, ',') FROM public.sales_goals WHERE unit_id = pg_temp.id(901)), '300.00');
SELECT pg_temp.esperar('metas de pessoas e de outro mês continuam livres',
  pg_temp.como('service_role', NULL,
    $c$INSERT INTO public.sales_goals (unit_id, user_id, month, target) VALUES
         (pg_temp.id(901), pg_temp.id(1), '2026-11-01', 10),
         (pg_temp.id(901), pg_temp.id(3), '2026-11-01', 10),
         (pg_temp.id(901), NULL, '2026-12-01', 10)$c$),
  '3');
