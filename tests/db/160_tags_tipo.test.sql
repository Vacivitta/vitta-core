-- Tags por tipo (133): migração dos dados de dados_antes_133.sql, tag do tipo
-- errado recusada no lead e na conversa, troca de tipo com aplicações recusada e
-- RLS de wa_tags intacta. O run.sh já reaplicou a 133 antes deste arquivo, então
-- as contagens abaixo também provam que reaplicar não refaz as cópias.

CREATE FUNCTION pg_temp.esperar(caso text, obtido text, esperado text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF obtido IS DISTINCT FROM esperado THEN
    RAISE EXCEPTION '%: esperado %, obtido %', caso, esperado, obtido;
  END IF;
END $$;

-- Roda o comando como o papel/usuário numa subtransação desfeita; devolve as
-- linhas afetadas ou o erro
CREATE FUNCTION pg_temp.como(papel text, usuario uuid, comando text) RETURNS text
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

-- ── Migração dos dados ───────────────────────────────────────────────────────
SELECT pg_temp.esperar('catálogo da unidade depois da 133 (nome:tipo, original ou cópia)',
  (SELECT string_agg(format('%s:%s:%s', name, tipo,
                            CASE WHEN id::text LIKE '00000000-0000-4000-8133-%' THEN 'original' ELSE 'cópia' END),
                     ' ' ORDER BY name, tipo)
     FROM public.wa_tags WHERE unit_id = '00000000-0000-4000-8133-0000000000a0'),
  'Gestante:lead:original Retorno:conversa:original Sem uso:conversa:original VIP:conversa:original VIP:lead:cópia');

SELECT pg_temp.esperar('cópia mantém cor e data da original',
  (SELECT count(*)::text FROM public.wa_tags c JOIN public.wa_tags o ON o.id = '00000000-0000-4000-8133-000000000301'
    WHERE c.unit_id = o.unit_id AND c.name = 'VIP' AND c.tipo = 'lead'
      AND c.color = o.color AND c.created_at = o.created_at), '1');

SELECT pg_temp.esperar('tags dos leads apontam para as tags de cliente',
  (SELECT string_agg(format('%s:%s:%s', right(lt.lead_id::text, 3), t.name, t.tipo), ' ' ORDER BY lt.lead_id, t.name)
     FROM public.lead_tags lt JOIN public.wa_tags t ON t.id = lt.tag_id
    WHERE lt.unit_id = '00000000-0000-4000-8133-0000000000a0'),
  '101:VIP:lead 102:Gestante:lead 102:VIP:lead');

SELECT pg_temp.esperar('tags das conversas não mudam',
  (SELECT string_agg(format('%s:%s', right(conversation_id::text, 3), right(tag_id::text, 3)), ' '
                     ORDER BY conversation_id, tag_id)
     FROM public.wa_conversation_tags WHERE conversation_id::text LIKE '00000000-0000-4000-8133-%'),
  '401:301 402:301 402:303');

SELECT pg_temp.esperar('lead_tags conserva criado_em e unidade ao repontar',
  (SELECT count(*)::text FROM public.lead_tags
    WHERE unit_id = '00000000-0000-4000-8133-0000000000a0' AND criado_em IS NOT NULL), '3');

-- ── Usuários e outra unidade ─────────────────────────────────────────────────
INSERT INTO public.units (id, tenant_id, nome, tipo) VALUES
  ('00000000-0000-4000-8133-0000000000b0', '00000000-0000-4000-8133-0000000000f0', 'Outra 133', 'clinica');
INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('00000000-0000-4000-8133-000000000001', 'tipo-atendente@teste.invalid', '{"full_name": "Atendente 133"}'),
  ('00000000-0000-4000-8133-000000000002', 'tipo-outra@teste.invalid', '{"full_name": "Atendente outra"}');
UPDATE public.profiles SET
  unit_id = CASE id WHEN '00000000-0000-4000-8133-000000000001' THEN '00000000-0000-4000-8133-0000000000a0'::uuid
                    ELSE '00000000-0000-4000-8133-0000000000b0'::uuid END,
  perfil  = 'atendente'
 WHERE id IN ('00000000-0000-4000-8133-000000000001', '00000000-0000-4000-8133-000000000002');
INSERT INTO public.user_units (user_id, unit_id) VALUES
  ('00000000-0000-4000-8133-000000000001', '00000000-0000-4000-8133-0000000000a0'),
  ('00000000-0000-4000-8133-000000000002', '00000000-0000-4000-8133-0000000000b0');

CREATE TEMP TABLE casos (ordem serial, caso text, papel text, usuario uuid, comando text, esperado text);

-- 302 = Gestante (cliente), 303 = Retorno (conversa), 304 = Sem uso (conversa, sem aplicação)
INSERT INTO casos (caso, papel, usuario, comando, esperado) VALUES
  ('atendente aplica tag de cliente no lead', 'authenticated', '00000000-0000-4000-8133-000000000001',
   $c$INSERT INTO public.lead_tags (lead_id, tag_id) VALUES
      ('00000000-0000-4000-8133-000000000101', '00000000-0000-4000-8133-000000000302')$c$, '1'),
  ('tag de conversa no lead é recusada', 'authenticated', '00000000-0000-4000-8133-000000000001',
   $c$INSERT INTO public.lead_tags (lead_id, tag_id) VALUES
      ('00000000-0000-4000-8133-000000000101', '00000000-0000-4000-8133-000000000303')$c$, 'erro 23514'),
  ('atendente marca conversa com tag de conversa', 'authenticated', '00000000-0000-4000-8133-000000000001',
   $c$INSERT INTO public.wa_conversation_tags (conversation_id, tag_id) VALUES
      ('00000000-0000-4000-8133-000000000401', '00000000-0000-4000-8133-000000000303')$c$, '1'),
  ('tag de cliente na conversa é recusada', 'authenticated', '00000000-0000-4000-8133-000000000001',
   $c$INSERT INTO public.wa_conversation_tags (conversation_id, tag_id) VALUES
      ('00000000-0000-4000-8133-000000000401', '00000000-0000-4000-8133-000000000302')$c$, 'erro 23514'),
  ('upsert da API (ON CONFLICT DO UPDATE) com tag de cliente na conversa é recusado', 'authenticated', '00000000-0000-4000-8133-000000000001',
   $c$INSERT INTO public.wa_conversation_tags (conversation_id, tag_id) VALUES
      ('00000000-0000-4000-8133-000000000402', '00000000-0000-4000-8133-000000000302')
      ON CONFLICT (conversation_id, tag_id) DO UPDATE SET tag_id = EXCLUDED.tag_id$c$, 'erro 23514'),
  ('service_role também não aplica tag do tipo errado', 'service_role', NULL,
   $c$INSERT INTO public.lead_tags (lead_id, tag_id) VALUES
      ('00000000-0000-4000-8133-000000000102', '00000000-0000-4000-8133-000000000303')$c$, 'erro 23514'),
  ('atendente cria tag de cliente', 'authenticated', '00000000-0000-4000-8133-000000000001',
   $c$INSERT INTO public.wa_tags (unit_id, name, tipo) VALUES
      ('00000000-0000-4000-8133-0000000000a0', 'Nova', 'lead')$c$, '1'),
  ('tipo fora da lista é recusado', 'authenticated', '00000000-0000-4000-8133-000000000001',
   $c$INSERT INTO public.wa_tags (unit_id, name, tipo) VALUES
      ('00000000-0000-4000-8133-0000000000a0', 'Nova', 'paciente')$c$, 'erro 23514'),
  ('sem tipo, a tag é de conversa (app anterior à 133)', 'authenticated', '00000000-0000-4000-8133-000000000001',
   $c$WITH i AS (INSERT INTO public.wa_tags (unit_id, name) VALUES
      ('00000000-0000-4000-8133-0000000000a0', 'Antiga') RETURNING tipo) SELECT 1 FROM i WHERE tipo = 'conversa'$c$, '1'),
  ('trocar o tipo de tag aplicada em lead é recusado', 'authenticated', '00000000-0000-4000-8133-000000000001',
   $c$UPDATE public.wa_tags SET tipo = 'conversa' WHERE id = '00000000-0000-4000-8133-000000000302'$c$, 'erro 23514'),
  ('trocar o tipo de tag aplicada em conversa é recusado', 'authenticated', '00000000-0000-4000-8133-000000000001',
   $c$UPDATE public.wa_tags SET tipo = 'lead' WHERE id = '00000000-0000-4000-8133-000000000303'$c$, 'erro 23514'),
  ('trocar o tipo de tag sem aplicação é aceito', 'authenticated', '00000000-0000-4000-8133-000000000001',
   $c$UPDATE public.wa_tags SET tipo = 'lead' WHERE id = '00000000-0000-4000-8133-000000000304'$c$, '1'),
  ('renomear tag aplicada é aceito (só o tipo é travado)', 'authenticated', '00000000-0000-4000-8133-000000000001',
   $c$UPDATE public.wa_tags SET name = 'VIP!', color = '#123456' WHERE id = '00000000-0000-4000-8133-000000000301'$c$, '1'),
  ('gravar o mesmo tipo numa tag aplicada é aceito', 'authenticated', '00000000-0000-4000-8133-000000000001',
   $c$UPDATE public.wa_tags SET tipo = 'conversa' WHERE id = '00000000-0000-4000-8133-000000000301'$c$, '1'),
  ('usuário de outra unidade não vê as tags', 'authenticated', '00000000-0000-4000-8133-000000000002',
   $c$SELECT * FROM public.wa_tags WHERE unit_id = '00000000-0000-4000-8133-0000000000a0'$c$, '0'),
  ('usuário de outra unidade não troca o tipo', 'authenticated', '00000000-0000-4000-8133-000000000002',
   $c$UPDATE public.wa_tags SET tipo = 'lead' WHERE id = '00000000-0000-4000-8133-000000000304'$c$, '0'),
  ('usuário de outra unidade não cria tag na unidade', 'authenticated', '00000000-0000-4000-8133-000000000002',
   $c$INSERT INTO public.wa_tags (unit_id, name, tipo) VALUES
      ('00000000-0000-4000-8133-0000000000a0', 'Intrusa', 'lead')$c$, 'erro 42501'),
  ('anon não lê o catálogo', 'anon', NULL,
   $c$SELECT * FROM public.wa_tags$c$, 'erro 42501');

DO $$
DECLARE
  c record;
  obtido text;
  divergentes text[] := '{}';
BEGIN
  FOR c IN SELECT * FROM casos ORDER BY ordem LOOP
    obtido := pg_temp.como(c.papel, c.usuario, c.comando);
    IF obtido IS DISTINCT FROM c.esperado THEN
      divergentes := divergentes || format('%s: esperado %s, obtido %s', c.caso, c.esperado, obtido);
    END IF;
  END LOOP;
  IF cardinality(divergentes) > 0 THEN
    RAISE EXCEPTION E'% de % casos divergentes:\n  %', cardinality(divergentes), (SELECT count(*) FROM casos),
      array_to_string(divergentes, E'\n  ');
  END IF;
END $$;

-- ── Mensagem e privilégios ───────────────────────────────────────────────────
DO $$
BEGIN
  BEGIN
    INSERT INTO public.lead_tags (lead_id, tag_id) VALUES
      ('00000000-0000-4000-8133-000000000101', '00000000-0000-4000-8133-000000000303');
    RAISE EXCEPTION 'tag de conversa no lead deveria ser recusada';
  EXCEPTION WHEN check_violation THEN
    IF SQLERRM NOT LIKE '%só entram tags do tipo Cliente%' THEN
      RAISE EXCEPTION 'mensagem inesperada: %', SQLERRM;
    END IF;
  END;
  IF has_function_privilege('authenticated', 'public.tag_aplicada_tipo()', 'EXECUTE')
     OR has_function_privilege('anon', 'public.tag_aplicada_tipo()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.wa_tags_troca_tipo()', 'EXECUTE')
     OR has_function_privilege('anon', 'public.wa_tags_troca_tipo()', 'EXECUTE') THEN
    RAISE EXCEPTION 'funções de trigger da 133 executáveis por authenticated/anon';
  END IF;
END $$;

-- Mesclar leads move as tags de cliente sem tropeçar no trigger novo
INSERT INTO public.lead_tags (lead_id, tag_id) VALUES
  ('00000000-0000-4000-8133-000000000101', '00000000-0000-4000-8133-000000000302');
SELECT public.mesclar_leads('00000000-0000-4000-8133-000000000101', '00000000-0000-4000-8133-000000000102');
SELECT pg_temp.esperar('mesclagem leva as tags de cliente do removido',
  (SELECT string_agg(t.name, ' ' ORDER BY t.name) FROM public.lead_tags lt JOIN public.wa_tags t ON t.id = lt.tag_id
    WHERE lt.lead_id = '00000000-0000-4000-8133-000000000101'),
  'Gestante VIP');
