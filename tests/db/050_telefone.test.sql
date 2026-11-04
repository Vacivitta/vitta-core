\set casos `cat /testes/telefone_casos.json`

CREATE TEMP TABLE casos_tel AS
  SELECT * FROM jsonb_to_recordset(:'casos'::jsonb) AS c(entrada text, esperado text, caso text);

DO $$
DECLARE
  total bigint;
  divergentes text;
BEGIN
  SELECT count(*) INTO total FROM casos_tel;
  IF total < 20 THEN
    RAISE EXCEPTION 'tabela de casos de telefone não carregou (% linhas)', total;
  END IF;
  SELECT string_agg(format('%s: %L → esperado %s, obtido %s', caso, entrada,
                           coalesce(esperado, 'NULL'), coalesce(public.normalizar_telefone(entrada), 'NULL')), E'\n  ')
    INTO divergentes
    FROM casos_tel
   WHERE public.normalizar_telefone(entrada) IS DISTINCT FROM esperado;
  IF divergentes IS NOT NULL THEN
    RAISE EXCEPTION E'normalizar_telefone diverge da tabela compartilhada:\n  %', divergentes;
  END IF;
END $$;

DO $$
DECLARE p record;
BEGIN
  SELECT provolatile, prosecdef INTO p FROM pg_proc WHERE oid = 'public.normalizar_telefone(text)'::regprocedure;
  IF p.provolatile <> 'i' OR p.prosecdef THEN
    RAISE EXCEPTION 'normalizar_telefone deveria ser IMMUTABLE e não SECURITY DEFINER';
  END IF;
  IF has_function_privilege('anon', 'public.normalizar_telefone(text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'normalizar_telefone executável por anon';
  END IF;
  IF has_function_privilege('authenticated', 'public.mesclar_leads(uuid,uuid,uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.mesclar_leads(uuid,uuid,uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'mesclar_leads executável por authenticated/anon';
  END IF;
  IF to_regclass('public.uq_leads_unit_telefone_norm') IS NULL THEN
    RAISE EXCEPTION 'índice único da 122 não existe';
  END IF;
END $$;

DROP INDEX public.uq_leads_unit_telefone_norm;

INSERT INTO public.tenants (id, nome) VALUES ('00000000-0000-4000-8050-0000000000f0', 'Rede Telefone');
INSERT INTO public.units (id, tenant_id, nome, tipo) VALUES
  ('00000000-0000-4000-8050-0000000000a0', '00000000-0000-4000-8050-0000000000f0', 'Unidade A', 'clinica'),
  ('00000000-0000-4000-8050-0000000000b0', '00000000-0000-4000-8050-0000000000f0', 'Unidade B', 'clinica');
INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('00000000-0000-4000-8050-000000000001', 'tel-atendente@teste.invalid', '{"full_name": "Atendente Tel"}'),
  ('00000000-0000-4000-8050-000000000003', 'tel-gestor@teste.invalid', '{"full_name": "Gestor Tel"}');
UPDATE public.profiles SET unit_id = '00000000-0000-4000-8050-0000000000a0',
  perfil = CASE WHEN id = '00000000-0000-4000-8050-000000000003' THEN 'gestor_unidade' ELSE 'atendente' END
 WHERE id IN ('00000000-0000-4000-8050-000000000001', '00000000-0000-4000-8050-000000000003');
INSERT INTO public.user_units (user_id, unit_id) VALUES
  ('00000000-0000-4000-8050-000000000001', '00000000-0000-4000-8050-0000000000a0'),
  ('00000000-0000-4000-8050-000000000003', '00000000-0000-4000-8050-0000000000a0');
INSERT INTO public.funnels (id, nome, unit_id) VALUES
  ('00000000-0000-4000-8050-0000000000d0', 'Funil A', '00000000-0000-4000-8050-0000000000a0'),
  ('00000000-0000-4000-8050-0000000000e0', 'Funil B', '00000000-0000-4000-8050-0000000000b0');
INSERT INTO public.funnel_stages (id, funnel_id, nome, unit_id) VALUES
  ('00000000-0000-4000-8050-0000000000d1', '00000000-0000-4000-8050-0000000000d0', 'Novo', '00000000-0000-4000-8050-0000000000a0'),
  ('00000000-0000-4000-8050-0000000000e1', '00000000-0000-4000-8050-0000000000e0', 'Novo', '00000000-0000-4000-8050-0000000000b0');

CREATE FUNCTION pg_temp.lead(id uuid, unidade char, nome text, telefone text, criado timestamptz DEFAULT now(),
                             arquivado boolean DEFAULT false) RETURNS void LANGUAGE sql AS $$
  INSERT INTO public.leads (id, nome, telefone, created_at, status, motivo_perda, funnel_id, stage_id, unit_id)
  SELECT id, nome, telefone, criado, CASE WHEN arquivado THEN 'perdido' ELSE 'aberto' END, CASE WHEN arquivado THEN 'teste' END,
         CASE unidade WHEN 'A' THEN '00000000-0000-4000-8050-0000000000d0'::uuid ELSE '00000000-0000-4000-8050-0000000000e0'::uuid END,
         CASE unidade WHEN 'A' THEN '00000000-0000-4000-8050-0000000000d1'::uuid ELSE '00000000-0000-4000-8050-0000000000e1'::uuid END,
         CASE unidade WHEN 'A' THEN '00000000-0000-4000-8050-0000000000a0'::uuid ELSE '00000000-0000-4000-8050-0000000000b0'::uuid END
$$;

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

CREATE FUNCTION pg_temp.esperar(caso text, obtido text, esperado text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF obtido IS DISTINCT FROM esperado THEN
    RAISE EXCEPTION '%: esperado %, obtido %', caso, esperado, obtido;
  END IF;
END $$;

SELECT pg_temp.lead('00000000-0000-4000-8050-000000000101', 'A', 'Gerada', '(31) 99667-4494');
SELECT pg_temp.esperar('telefone_norm preenchida no INSERT',
  (SELECT telefone_norm FROM public.leads WHERE id = '00000000-0000-4000-8050-000000000101'), '5531996674494');
UPDATE public.leads SET telefone = '(31) 3333-4444' WHERE id = '00000000-0000-4000-8050-000000000101';
SELECT pg_temp.esperar('telefone_norm recalculada no UPDATE',
  (SELECT telefone_norm FROM public.leads WHERE id = '00000000-0000-4000-8050-000000000101'), '553133334444');
UPDATE public.leads SET telefone = 'sem número' WHERE id = '00000000-0000-4000-8050-000000000101';
SELECT pg_temp.esperar('telefone inválido vira NULL',
  (SELECT coalesce(telefone_norm, 'NULL') FROM public.leads WHERE id = '00000000-0000-4000-8050-000000000101'), 'NULL');

SELECT pg_temp.esperar('atendente cria lead com telefone',
  pg_temp.linhas_afetadas_como('authenticated', '00000000-0000-4000-8050-000000000001', $c$
    INSERT INTO public.leads (nome, telefone, funnel_id, stage_id, unit_id)
    VALUES ('Pelo navegador', '(31) 97777-1111', '00000000-0000-4000-8050-0000000000d0',
            '00000000-0000-4000-8050-0000000000d1', '00000000-0000-4000-8050-0000000000a0')$c$), '1');
SELECT pg_temp.esperar('atendente executa mesclar_leads',
  pg_temp.linhas_afetadas_como('authenticated', '00000000-0000-4000-8050-000000000001',
    $c$SELECT public.mesclar_leads('00000000-0000-4000-8050-000000000101', '00000000-0000-4000-8050-000000000101')$c$),
  'erro 42501');

SELECT pg_temp.lead('00000000-0000-4000-8050-000000000111', 'A', 'Antigo', '(31) 98888-1111', now() - interval '2 days');
SELECT pg_temp.lead('00000000-0000-4000-8050-000000000112', 'A', 'Recente', '31 8888-1111', now() - interval '1 day');
SELECT pg_temp.lead('00000000-0000-4000-8050-000000000113', 'A', 'Arquivado', '(31) 98888-1111', now(), true);
SELECT pg_temp.lead('00000000-0000-4000-8050-000000000114', 'B', 'Outra unidade', '(31) 98888-1111', now());
SELECT pg_temp.lead('00000000-0000-4000-8050-000000000115', 'A', 'Só arquivado', '(31) 97777-2222', now(), true);

INSERT INTO public.wa_conversations (id, unit_id, wa_phone) VALUES
  ('00000000-0000-4000-8050-000000000501', '00000000-0000-4000-8050-0000000000a0', '553188881111'),
  ('00000000-0000-4000-8050-000000000502', '00000000-0000-4000-8050-0000000000a0', '5531977772222'),
  ('00000000-0000-4000-8050-000000000503', '00000000-0000-4000-8050-0000000000a0', '12125551234');
SELECT pg_temp.esperar('conversa (wa_id sem o 9) vinculada ao lead mascarado mais recente, não arquivado, da unidade',
  (SELECT lead_id::text FROM public.wa_conversations WHERE id = '00000000-0000-4000-8050-000000000501'),
  '00000000-0000-4000-8050-000000000112');
SELECT pg_temp.esperar('conversa com só lead arquivado fica sem vínculo',
  (SELECT coalesce(lead_id::text, 'NULL') FROM public.wa_conversations WHERE id = '00000000-0000-4000-8050-000000000502'), 'NULL');
SELECT pg_temp.esperar('conversa sem lead fica sem vínculo',
  (SELECT coalesce(lead_id::text, 'NULL') FROM public.wa_conversations WHERE id = '00000000-0000-4000-8050-000000000503'), 'NULL');
INSERT INTO public.wa_conversations (id, unit_id, wa_phone, lead_id) VALUES
  ('00000000-0000-4000-8050-000000000504', '00000000-0000-4000-8050-0000000000a0', '5531988881111',
   '00000000-0000-4000-8050-000000000111');
SELECT pg_temp.esperar('vínculo manual não é sobrescrito',
  (SELECT lead_id::text FROM public.wa_conversations WHERE id = '00000000-0000-4000-8050-000000000504'),
  '00000000-0000-4000-8050-000000000111');

SELECT pg_temp.lead('00000000-0000-4000-8050-000000000201', 'A', 'Maria', '(31) 96666-0001', now() - interval '1 day');
SELECT pg_temp.lead('00000000-0000-4000-8050-000000000202', 'A', 'Maria Duplicada', '31966660001', now() - interval '30 days');
UPDATE public.leads SET email = 'maria@teste.invalid', wa_optout_at = now() - interval '3 days',
                        wa_optin_at = now() - interval '20 days'
 WHERE id = '00000000-0000-4000-8050-000000000202';
UPDATE public.leads SET email = NULL, wa_optin_at = now() - interval '2 days', sobrenome = 'Silva'
 WHERE id = '00000000-0000-4000-8050-000000000201';

INSERT INTO public.lead_notes (id, lead_id, conteudo) VALUES
  ('00000000-0000-4000-8050-000000000601', '00000000-0000-4000-8050-000000000202', 'nota do duplicado');
INSERT INTO public.lead_tasks (id, lead_id, titulo) VALUES
  ('00000000-0000-4000-8050-000000000602', '00000000-0000-4000-8050-000000000202', 'tarefa do duplicado');
INSERT INTO public.lead_contacts (id, lead_id, nome) VALUES
  ('00000000-0000-4000-8050-000000000603', '00000000-0000-4000-8050-000000000202', 'contato do duplicado');
INSERT INTO public.quotes (id, unit_id, lead_id) VALUES
  ('00000000-0000-4000-8050-000000000604', '00000000-0000-4000-8050-0000000000a0', '00000000-0000-4000-8050-000000000202');
INSERT INTO public.lead_stage_history (id, lead_id, para_stage_id) VALUES
  ('00000000-0000-4000-8050-000000000605', '00000000-0000-4000-8050-000000000202', '00000000-0000-4000-8050-0000000000d1');
INSERT INTO public.lead_responsible_history (id, lead_id) VALUES
  ('00000000-0000-4000-8050-000000000606', '00000000-0000-4000-8050-000000000202');
INSERT INTO public.notifications (id, unit_id, type, title, lead_id) VALUES
  ('00000000-0000-4000-8050-000000000607', '00000000-0000-4000-8050-0000000000a0', 'teste', 'aviso',
   '00000000-0000-4000-8050-000000000202');
INSERT INTO public.wa_conversations (id, unit_id, wa_phone, lead_id) VALUES
  ('00000000-0000-4000-8050-000000000608', '00000000-0000-4000-8050-0000000000a0', '553166660001',
   '00000000-0000-4000-8050-000000000202');
INSERT INTO public.lead_negotiation (lead_id, valor_proposta, modelo, valor_negociado) VALUES
  ('00000000-0000-4000-8050-000000000201', NULL, 'modelo do que fica', NULL),
  ('00000000-0000-4000-8050-000000000202', 100, 'modelo do duplicado', 90);

SELECT pg_temp.esperar('lead de outra unidade',
  pg_temp.linhas_afetadas_como('service_role', NULL,
    $c$SELECT public.mesclar_leads('00000000-0000-4000-8050-000000000201', '00000000-0000-4000-8050-000000000114')$c$),
  'erro 22023');
SELECT pg_temp.esperar('mesmo lead nos dois lados',
  pg_temp.linhas_afetadas_como('service_role', NULL,
    $c$SELECT public.mesclar_leads('00000000-0000-4000-8050-000000000201', '00000000-0000-4000-8050-000000000201')$c$),
  'erro 22023');

-- Depois de um restore o GRANT volta para authenticated; a guarda interna segura mesmo assim
DO $$
BEGIN
  BEGIN
    PERFORM set_config('request.jwt.claims', '{"role": "authenticated"}', true);
    PERFORM public.mesclar_leads('00000000-0000-4000-8050-000000000201', '00000000-0000-4000-8050-000000000202');
    RAISE EXCEPTION 'mesclar_leads aceitou chamada com papel authenticated no JWT';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
  PERFORM set_config('request.jwt.claims', '', true);
END $$;

DO $$
BEGIN
  CREATE TABLE public.zz_ref_lead (lead_id uuid REFERENCES public.leads (id) ON DELETE CASCADE);
  BEGIN
    PERFORM public.mesclar_leads('00000000-0000-4000-8050-000000000201', '00000000-0000-4000-8050-000000000202');
    RAISE EXCEPTION 'mesclar_leads ignorou uma FK nova para leads';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE '%sem tratamento: public.zz_ref_lead.lead_id%' THEN
      RAISE;
    END IF;
  END;
  DROP TABLE public.zz_ref_lead;
END $$;

SELECT pg_temp.esperar('service_role mescla',
  pg_temp.linhas_afetadas_como('service_role', NULL, $c$SELECT public.mesclar_leads('00000000-0000-4000-8050-000000000201',
    '00000000-0000-4000-8050-000000000202', '00000000-0000-4000-8050-000000000003')$c$), '1');
SELECT public.mesclar_leads('00000000-0000-4000-8050-000000000201', '00000000-0000-4000-8050-000000000202',
                            '00000000-0000-4000-8050-000000000003');

DO $$
DECLARE
  m constant uuid := '00000000-0000-4000-8050-000000000201';
  l public.leads%ROWTYPE;
  n public.lead_negotiation%ROWTYPE;
  faltando text[] := '{}';
BEGIN
  IF EXISTS (SELECT 1 FROM public.leads WHERE id = '00000000-0000-4000-8050-000000000202') THEN
    RAISE EXCEPTION 'lead removido continua existindo';
  END IF;
  IF (SELECT lead_id FROM public.lead_notes WHERE id = '00000000-0000-4000-8050-000000000601') IS DISTINCT FROM m THEN faltando := faltando || 'nota'; END IF;
  IF (SELECT lead_id FROM public.lead_tasks WHERE id = '00000000-0000-4000-8050-000000000602') IS DISTINCT FROM m THEN faltando := faltando || 'tarefa'; END IF;
  IF (SELECT lead_id FROM public.lead_contacts WHERE id = '00000000-0000-4000-8050-000000000603') IS DISTINCT FROM m THEN faltando := faltando || 'contato'; END IF;
  IF (SELECT lead_id FROM public.quotes WHERE id = '00000000-0000-4000-8050-000000000604') IS DISTINCT FROM m THEN faltando := faltando || 'orçamento'; END IF;
  IF (SELECT lead_id FROM public.lead_stage_history WHERE id = '00000000-0000-4000-8050-000000000605') IS DISTINCT FROM m THEN faltando := faltando || 'histórico de etapa'; END IF;
  IF (SELECT lead_id FROM public.lead_responsible_history WHERE id = '00000000-0000-4000-8050-000000000606') IS DISTINCT FROM m THEN faltando := faltando || 'histórico de responsável'; END IF;
  IF (SELECT lead_id FROM public.notifications WHERE id = '00000000-0000-4000-8050-000000000607') IS DISTINCT FROM m THEN faltando := faltando || 'notificação'; END IF;
  IF (SELECT lead_id FROM public.wa_conversations WHERE id = '00000000-0000-4000-8050-000000000608') IS DISTINCT FROM m THEN faltando := faltando || 'conversa'; END IF;
  IF cardinality(faltando) > 0 THEN
    RAISE EXCEPTION 'não foram movidos para o lead que fica: %', array_to_string(faltando, ', ');
  END IF;

  SELECT * INTO n FROM public.lead_negotiation WHERE lead_id = m;
  IF n.valor_proposta IS DISTINCT FROM 100 OR n.modelo IS DISTINCT FROM 'modelo do que fica' OR n.valor_negociado IS DISTINCT FROM 90 THEN
    RAISE EXCEPTION 'negociação (os dois tinham) deveria completar os nulos do que fica: %', row_to_json(n);
  END IF;
  IF (SELECT count(*) FROM public.lead_negotiation WHERE lead_id = m) <> 1 THEN
    RAISE EXCEPTION 'negociação duplicada no lead que fica';
  END IF;

  SELECT * INTO l FROM public.leads WHERE id = m;
  IF l.email IS DISTINCT FROM 'maria@teste.invalid' THEN RAISE EXCEPTION 'e-mail do removido não foi aproveitado'; END IF;
  IF l.sobrenome IS DISTINCT FROM 'Silva' THEN RAISE EXCEPTION 'sobrenome do que fica foi trocado'; END IF;
  IF l.wa_optout_at IS NULL THEN RAISE EXCEPTION 'opt-out do removido se perdeu'; END IF;
  IF l.wa_optin_at > now() - interval '19 days' THEN RAISE EXCEPTION 'wa_optin_at deveria ser o mais antigo'; END IF;
  IF l.created_at > now() - interval '29 days' THEN RAISE EXCEPTION 'created_at deveria ser o mais antigo'; END IF;
  IF l.telefone_norm IS DISTINCT FROM '5531966660001' THEN RAISE EXCEPTION 'telefone do que fica mudou: %', l.telefone_norm; END IF;

  IF NOT EXISTS (SELECT 1 FROM public.lead_notes
                  WHERE lead_id = m AND autor_id = '00000000-0000-4000-8050-000000000003'
                    AND conteudo LIKE 'Lead mesclado com Maria Duplicada em __/__/____ __:__') THEN
    RAISE EXCEPTION 'nota de mesclagem não registrada';
  END IF;
END $$;

SELECT pg_temp.lead('00000000-0000-4000-8050-000000000211', 'A', 'João', '(31) 95555-0001');
SELECT pg_temp.lead('00000000-0000-4000-8050-000000000212', 'A', 'João Dup', NULL);
INSERT INTO public.lead_negotiation (id, lead_id, valor_proposta) VALUES
  ('00000000-0000-4000-8050-000000000701', '00000000-0000-4000-8050-000000000212', 50);
SELECT public.mesclar_leads('00000000-0000-4000-8050-000000000211', '00000000-0000-4000-8050-000000000212');
SELECT pg_temp.esperar('negociação só do removido é movida',
  (SELECT lead_id::text FROM public.lead_negotiation WHERE id = '00000000-0000-4000-8050-000000000701'),
  '00000000-0000-4000-8050-000000000211');
SELECT pg_temp.esperar('nota de mesclagem sem autor',
  (SELECT count(*)::text FROM public.lead_notes
    WHERE lead_id = '00000000-0000-4000-8050-000000000211' AND autor_id IS NULL AND conteudo LIKE 'Lead mesclado com João Dup em %'),
  '1');

SELECT public.mesclar_leads('00000000-0000-4000-8050-000000000112', '00000000-0000-4000-8050-000000000111');
SELECT public.mesclar_leads('00000000-0000-4000-8050-000000000112', '00000000-0000-4000-8050-000000000113');
SELECT pg_temp.esperar('vínculo manual da conversa segue o lead mesclado',
  (SELECT lead_id::text FROM public.wa_conversations WHERE id = '00000000-0000-4000-8050-000000000504'),
  '00000000-0000-4000-8050-000000000112');

\i /migracoes/122_telefone_unico.sql

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_index i
                  WHERE i.indexrelid = to_regclass('public.uq_leads_unit_telefone_norm')
                    AND i.indisunique AND i.indpred IS NOT NULL) THEN
    RAISE EXCEPTION 'índice único parcial uq_leads_unit_telefone_norm não existe';
  END IF;
END $$;
SELECT pg_temp.esperar('mesmo telefone (outra máscara) na mesma unidade',
  pg_temp.linhas_afetadas_como('supabase_admin', NULL, $c$SELECT pg_temp.lead('00000000-0000-4000-8050-000000000301', 'A', 'Dup', '031 95555 0001')$c$),
  'erro 23505');
SELECT pg_temp.esperar('mesmo telefone de um lead arquivado',
  pg_temp.linhas_afetadas_como('supabase_admin', NULL, $c$SELECT pg_temp.lead('00000000-0000-4000-8050-000000000302', 'A', 'Dup', '(31) 97777-2222')$c$),
  'erro 23505');
SELECT pg_temp.esperar('mesmo telefone em outra unidade',
  pg_temp.linhas_afetadas_como('supabase_admin', NULL, $c$SELECT pg_temp.lead('00000000-0000-4000-8050-000000000303', 'B', 'Outro', '(31) 95555-0001')$c$),
  '1');
SELECT pg_temp.lead('00000000-0000-4000-8050-000000000304', 'A', 'Sem telefone 1', NULL);
SELECT pg_temp.lead('00000000-0000-4000-8050-000000000305', 'A', 'Sem telefone 2', 'não sei');
