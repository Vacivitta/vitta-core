-- Tags no lead (127): RLS de lead_tags, trava de unidade, cópia das tags de
-- conversa, mesclagem, transferência e a policy nova de wa_conversation_tags.

INSERT INTO public.tenants (id, nome) VALUES ('00000000-0000-4000-8100-0000000000f0', 'Rede Tags');
INSERT INTO public.units (id, tenant_id, nome, tipo) VALUES
  ('00000000-0000-4000-8100-0000000000a0', '00000000-0000-4000-8100-0000000000f0', 'Unidade A', 'clinica'),
  ('00000000-0000-4000-8100-0000000000b0', '00000000-0000-4000-8100-0000000000f0', 'Unidade B', 'clinica');
INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('00000000-0000-4000-8100-000000000001', 'tags-atendente@teste.invalid', '{"full_name": "Atendente A"}'),
  ('00000000-0000-4000-8100-000000000006', 'tags-gestorb@teste.invalid', '{"full_name": "Gestor B"}'),
  ('00000000-0000-4000-8100-000000000009', 'tags-admin@teste.invalid', '{"full_name": "Admin global"}');
UPDATE public.profiles SET
  unit_id = CASE id WHEN '00000000-0000-4000-8100-000000000006' THEN '00000000-0000-4000-8100-0000000000b0'::uuid
                    ELSE '00000000-0000-4000-8100-0000000000a0'::uuid END,
  perfil  = CASE id WHEN '00000000-0000-4000-8100-000000000001' THEN 'atendente'
                    WHEN '00000000-0000-4000-8100-000000000006' THEN 'gestor_unidade' ELSE 'admin' END
 WHERE id IN ('00000000-0000-4000-8100-000000000001', '00000000-0000-4000-8100-000000000006',
              '00000000-0000-4000-8100-000000000009');
INSERT INTO public.user_units (user_id, unit_id) VALUES
  ('00000000-0000-4000-8100-000000000001', '00000000-0000-4000-8100-0000000000a0'),
  ('00000000-0000-4000-8100-000000000006', '00000000-0000-4000-8100-0000000000b0');
INSERT INTO public.funnels (id, nome, unit_id) VALUES
  ('00000000-0000-4000-8100-0000000000d0', 'Funil A', '00000000-0000-4000-8100-0000000000a0'),
  ('00000000-0000-4000-8100-0000000000e0', 'Funil B', '00000000-0000-4000-8100-0000000000b0');
INSERT INTO public.funnel_stages (id, funnel_id, nome, unit_id) VALUES
  ('00000000-0000-4000-8100-0000000000d1', '00000000-0000-4000-8100-0000000000d0', 'Novo', '00000000-0000-4000-8100-0000000000a0'),
  ('00000000-0000-4000-8100-0000000000e1', '00000000-0000-4000-8100-0000000000e0', 'Novo', '00000000-0000-4000-8100-0000000000b0');
INSERT INTO public.leads (id, nome, funnel_id, stage_id, unit_id) VALUES
  ('00000000-0000-4000-8100-000000000101', 'Lead A1', '00000000-0000-4000-8100-0000000000d0', '00000000-0000-4000-8100-0000000000d1', '00000000-0000-4000-8100-0000000000a0'),
  ('00000000-0000-4000-8100-000000000102', 'Lead A2', '00000000-0000-4000-8100-0000000000d0', '00000000-0000-4000-8100-0000000000d1', '00000000-0000-4000-8100-0000000000a0'),
  ('00000000-0000-4000-8100-000000000103', 'Lead A3', '00000000-0000-4000-8100-0000000000d0', '00000000-0000-4000-8100-0000000000d1', '00000000-0000-4000-8100-0000000000a0'),
  ('00000000-0000-4000-8100-000000000201', 'Lead B1', '00000000-0000-4000-8100-0000000000e0', '00000000-0000-4000-8100-0000000000e1', '00000000-0000-4000-8100-0000000000b0');
INSERT INTO public.wa_tags (id, unit_id, name) VALUES
  ('00000000-0000-4000-8100-000000000301', '00000000-0000-4000-8100-0000000000a0', 'VIP'),
  ('00000000-0000-4000-8100-000000000302', '00000000-0000-4000-8100-0000000000a0', 'Gestante'),
  ('00000000-0000-4000-8100-000000000303', '00000000-0000-4000-8100-0000000000a0', 'Retorno'),
  ('00000000-0000-4000-8100-000000000311', '00000000-0000-4000-8100-0000000000b0', 'Tag de B');
INSERT INTO public.wa_conversations (id, unit_id, wa_phone, lead_id) VALUES
  ('00000000-0000-4000-8100-000000000401', '00000000-0000-4000-8100-0000000000a0', '553100000401', '00000000-0000-4000-8100-000000000101'),
  ('00000000-0000-4000-8100-000000000402', '00000000-0000-4000-8100-0000000000a0', '553100000402', '00000000-0000-4000-8100-000000000101'),
  ('00000000-0000-4000-8100-000000000403', '00000000-0000-4000-8100-0000000000a0', '553100000403', NULL),
  ('00000000-0000-4000-8100-000000000404', '00000000-0000-4000-8100-0000000000a0', '553100000404', '00000000-0000-4000-8100-000000000102'),
  ('00000000-0000-4000-8100-000000000411', '00000000-0000-4000-8100-0000000000b0', '553100000411', '00000000-0000-4000-8100-000000000201');

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

-- ── Cópia das tags de conversa ────────────────────────────────────────────────
-- A migração já rodou num banco vazio, então a cópia não teve o que copiar. Para
-- exercitar o arquivo de verdade (e não uma reescrita do INSERT aqui), a tabela é
-- apagada e a 127 roda de novo com as conversas marcadas: é o mesmo caminho da
-- produção, onde lead_tags ainda não existe quando a 127 é aplicada.
-- A conversa 404 recebe uma tag de outra unidade pelo dono (a policy de hoje
-- recusaria); a cópia tem que pular esse par em vez de abortar.
INSERT INTO public.wa_conversation_tags (conversation_id, tag_id) VALUES
  ('00000000-0000-4000-8100-000000000401', '00000000-0000-4000-8100-000000000301'),
  ('00000000-0000-4000-8100-000000000401', '00000000-0000-4000-8100-000000000302'),
  ('00000000-0000-4000-8100-000000000402', '00000000-0000-4000-8100-000000000301'),
  ('00000000-0000-4000-8100-000000000403', '00000000-0000-4000-8100-000000000303'),
  ('00000000-0000-4000-8100-000000000404', '00000000-0000-4000-8100-000000000311'),
  ('00000000-0000-4000-8100-000000000411', '00000000-0000-4000-8100-000000000311');

DROP TABLE public.lead_tags;
\i /migracoes/127_lead_tags.sql

SELECT pg_temp.esperar('tags copiadas das conversas para os leads',
  (SELECT string_agg(format('%s:%s', right(lead_id::text, 3), right(tag_id::text, 3)), ' ' ORDER BY lead_id, tag_id)
     FROM public.lead_tags WHERE unit_id IN ('00000000-0000-4000-8100-0000000000a0', '00000000-0000-4000-8100-0000000000b0')),
  '101:301 101:302 201:311');
SELECT pg_temp.esperar('cópia não apaga as tags das conversas',
  (SELECT count(*)::text FROM public.wa_conversation_tags WHERE conversation_id::text LIKE '00000000-0000-4000-8100-%'), '6');

DELETE FROM public.lead_tags WHERE lead_id = '00000000-0000-4000-8100-000000000101' AND tag_id = '00000000-0000-4000-8100-000000000302';
\i /migracoes/127_lead_tags.sql
SELECT pg_temp.esperar('reaplicar a 127 não devolve tag removida do lead',
  (SELECT count(*)::text FROM public.lead_tags
    WHERE lead_id = '00000000-0000-4000-8100-000000000101' AND tag_id = '00000000-0000-4000-8100-000000000302'), '0');

DELETE FROM public.wa_conversation_tags WHERE conversation_id = '00000000-0000-4000-8100-000000000404';

-- ── RLS de lead_tags e de wa_conversation_tags ───────────────────────────────
CREATE TEMP TABLE casos (ordem serial, caso text, papel text, usuario uuid, comando text, esperado text);

INSERT INTO casos (caso, papel, usuario, comando, esperado) VALUES
  ('atendente lê as tags dos leads da unidade', 'authenticated', '00000000-0000-4000-8100-000000000001',
   $c$SELECT * FROM public.lead_tags$c$, '1'),
  ('atendente aplica tag da unidade no lead da unidade', 'authenticated', '00000000-0000-4000-8100-000000000001',
   $c$INSERT INTO public.lead_tags (lead_id, tag_id) VALUES
      ('00000000-0000-4000-8100-000000000102', '00000000-0000-4000-8100-000000000303')$c$, '1'),
  ('unit_id vem do lead, não do navegador', 'authenticated', '00000000-0000-4000-8100-000000000001',
   $c$WITH i AS (INSERT INTO public.lead_tags (lead_id, tag_id, unit_id) VALUES
      ('00000000-0000-4000-8100-000000000102', '00000000-0000-4000-8100-000000000303', '00000000-0000-4000-8100-0000000000b0')
      RETURNING unit_id) SELECT 1 FROM i WHERE unit_id = '00000000-0000-4000-8100-0000000000a0'$c$, '1'),
  ('criado_por é o usuário do JWT', 'authenticated', '00000000-0000-4000-8100-000000000001',
   $c$WITH i AS (INSERT INTO public.lead_tags (lead_id, tag_id, criado_por) VALUES
      ('00000000-0000-4000-8100-000000000102', '00000000-0000-4000-8100-000000000303', '00000000-0000-4000-8100-000000000006')
      RETURNING criado_por) SELECT 1 FROM i WHERE criado_por = '00000000-0000-4000-8100-000000000001'$c$, '1'),
  ('tag de outra unidade é recusada', 'authenticated', '00000000-0000-4000-8100-000000000001',
   $c$INSERT INTO public.lead_tags (lead_id, tag_id) VALUES
      ('00000000-0000-4000-8100-000000000102', '00000000-0000-4000-8100-000000000311')$c$, 'erro 23514'),
  ('admin global também não aplica tag de outra unidade', 'authenticated', '00000000-0000-4000-8100-000000000009',
   $c$INSERT INTO public.lead_tags (lead_id, tag_id) VALUES
      ('00000000-0000-4000-8100-000000000102', '00000000-0000-4000-8100-000000000311')$c$, 'erro 23514'),
  ('admin global aplica tag no lead de qualquer unidade', 'authenticated', '00000000-0000-4000-8100-000000000009',
   $c$INSERT INTO public.lead_tags (lead_id, tag_id) VALUES
      ('00000000-0000-4000-8100-000000000102', '00000000-0000-4000-8100-000000000301')$c$, '1'),
  ('usuário de outra unidade não vê', 'authenticated', '00000000-0000-4000-8100-000000000006',
   $c$SELECT * FROM public.lead_tags WHERE unit_id = '00000000-0000-4000-8100-0000000000a0'$c$, '0'),
  ('usuário de outra unidade não aplica', 'authenticated', '00000000-0000-4000-8100-000000000006',
   $c$INSERT INTO public.lead_tags (lead_id, tag_id) VALUES
      ('00000000-0000-4000-8100-000000000102', '00000000-0000-4000-8100-000000000301')$c$, 'erro 42501'),
  ('usuário de outra unidade não remove', 'authenticated', '00000000-0000-4000-8100-000000000006',
   $c$DELETE FROM public.lead_tags WHERE unit_id = '00000000-0000-4000-8100-0000000000a0'$c$, '0'),
  ('atendente remove tag do lead da unidade', 'authenticated', '00000000-0000-4000-8100-000000000001',
   $c$DELETE FROM public.lead_tags WHERE lead_id = '00000000-0000-4000-8100-000000000101'
      AND tag_id = '00000000-0000-4000-8100-000000000301'$c$, '1'),
  ('ninguém altera uma aplicação (sem UPDATE)', 'authenticated', '00000000-0000-4000-8100-000000000001',
   $c$UPDATE public.lead_tags SET tag_id = '00000000-0000-4000-8100-000000000302'$c$, 'erro 42501'),
  ('anon não lê', 'anon', NULL,
   $c$SELECT * FROM public.lead_tags$c$, 'erro 42501'),
  ('atendente marca conversa da unidade', 'authenticated', '00000000-0000-4000-8100-000000000001',
   $c$INSERT INTO public.wa_conversation_tags (conversation_id, tag_id) VALUES
      ('00000000-0000-4000-8100-000000000403', '00000000-0000-4000-8100-000000000301')$c$, '1'),
  ('atendente não marca conversa de outra unidade com tag sua', 'authenticated', '00000000-0000-4000-8100-000000000001',
   $c$INSERT INTO public.wa_conversation_tags (conversation_id, tag_id) VALUES
      ('00000000-0000-4000-8100-000000000411', '00000000-0000-4000-8100-000000000301')$c$, 'erro 42501'),
  ('atendente não marca conversa sua com tag de outra unidade', 'authenticated', '00000000-0000-4000-8100-000000000001',
   $c$INSERT INTO public.wa_conversation_tags (conversation_id, tag_id) VALUES
      ('00000000-0000-4000-8100-000000000403', '00000000-0000-4000-8100-000000000311')$c$, 'erro 42501'),
  ('admin global não marca conversa com tag de outra unidade', 'authenticated', '00000000-0000-4000-8100-000000000009',
   $c$INSERT INTO public.wa_conversation_tags (conversation_id, tag_id) VALUES
      ('00000000-0000-4000-8100-000000000411', '00000000-0000-4000-8100-000000000301')$c$, 'erro 42501'),
  ('atendente não desmarca conversa de outra unidade', 'authenticated', '00000000-0000-4000-8100-000000000001',
   $c$DELETE FROM public.wa_conversation_tags WHERE conversation_id = '00000000-0000-4000-8100-000000000411'$c$, '0'),
  ('gestor da outra unidade desmarca a própria conversa', 'authenticated', '00000000-0000-4000-8100-000000000006',
   $c$DELETE FROM public.wa_conversation_tags WHERE conversation_id = '00000000-0000-4000-8100-000000000411'$c$, '1');

DO $$
DECLARE
  c record;
  obtido text;
  divergentes text[] := '{}';
BEGIN
  FOR c IN SELECT * FROM casos ORDER BY ordem LOOP
    obtido := pg_temp.linhas_afetadas_como(c.papel, c.usuario, c.comando);
    IF obtido IS DISTINCT FROM c.esperado THEN
      divergentes := divergentes || format('%s: esperado %s, obtido %s', c.caso, c.esperado, obtido);
    END IF;
  END LOOP;
  IF cardinality(divergentes) > 0 THEN
    RAISE EXCEPTION E'% de % casos divergentes:\n  %', cardinality(divergentes), (SELECT count(*) FROM casos),
      array_to_string(divergentes, E'\n  ');
  END IF;
END $$;

-- ── mesclar_leads move as tags sem duplicar ──────────────────────────────────
INSERT INTO public.lead_tags (lead_id, tag_id) VALUES
  ('00000000-0000-4000-8100-000000000102', '00000000-0000-4000-8100-000000000301'),
  ('00000000-0000-4000-8100-000000000102', '00000000-0000-4000-8100-000000000302'),
  ('00000000-0000-4000-8100-000000000103', '00000000-0000-4000-8100-000000000302'),
  ('00000000-0000-4000-8100-000000000103', '00000000-0000-4000-8100-000000000303');

SELECT pg_temp.esperar('service_role mescla leads com tags em comum',
  pg_temp.linhas_afetadas_como('service_role', NULL, $c$SELECT public.mesclar_leads(
    '00000000-0000-4000-8100-000000000102', '00000000-0000-4000-8100-000000000103')$c$), '1');
SELECT public.mesclar_leads('00000000-0000-4000-8100-000000000102', '00000000-0000-4000-8100-000000000103');
SELECT pg_temp.esperar('tags do lead mantido depois da mesclagem',
  (SELECT string_agg(right(tag_id::text, 3), ' ' ORDER BY tag_id) FROM public.lead_tags
    WHERE lead_id = '00000000-0000-4000-8100-000000000102'), '301 302 303');

-- ── Transferência tira as tags da unidade de origem ──────────────────────────
UPDATE public.leads SET unit_id = '00000000-0000-4000-8100-0000000000b0',
       funnel_id = '00000000-0000-4000-8100-0000000000e0', stage_id = '00000000-0000-4000-8100-0000000000e1'
 WHERE id = '00000000-0000-4000-8100-000000000102';
SELECT pg_temp.esperar('lead transferido fica sem as tags da origem',
  (SELECT count(*)::text FROM public.lead_tags WHERE lead_id = '00000000-0000-4000-8100-000000000102'), '0');
