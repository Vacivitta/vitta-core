INSERT INTO public.tenants (id, nome) VALUES ('00000000-0000-4000-8230-0000000000f0', 'Rede 230');
INSERT INTO public.units (id, tenant_id, nome, tipo) VALUES
  ('00000000-0000-4000-8230-0000000000a0', '00000000-0000-4000-8230-0000000000f0', 'Clínica A', 'clinica'),
  ('00000000-0000-4000-8230-0000000000b0', '00000000-0000-4000-8230-0000000000f0', 'Clínica B', 'clinica'),
  ('00000000-0000-4000-8230-0000000000c0', '00000000-0000-4000-8230-0000000000f0', 'Clínica C', 'clinica');

-- 1: atende A e B, com A ativa; 2: só A; 5: admin da marca, sem vínculo
INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('00000000-0000-4000-8230-000000000001', 'um230@teste.invalid', '{"full_name": "Um 230"}'),
  ('00000000-0000-4000-8230-000000000002', 'dois230@teste.invalid', '{"full_name": "Dois 230"}'),
  ('00000000-0000-4000-8230-000000000005', 'admin230@teste.invalid', '{"full_name": "Admin 230"}');
UPDATE public.profiles SET unit_id = '00000000-0000-4000-8230-0000000000a0', perfil = 'gestor_unidade'
 WHERE id IN ('00000000-0000-4000-8230-000000000001', '00000000-0000-4000-8230-000000000002');
UPDATE public.profiles SET perfil = 'admin' WHERE id = '00000000-0000-4000-8230-000000000005';
INSERT INTO public.user_units (user_id, unit_id) VALUES
  ('00000000-0000-4000-8230-000000000001', '00000000-0000-4000-8230-0000000000a0'),
  ('00000000-0000-4000-8230-000000000001', '00000000-0000-4000-8230-0000000000b0'),
  ('00000000-0000-4000-8230-000000000002', '00000000-0000-4000-8230-0000000000a0');

-- Uma linha de cada tabela na unidade B (o canal interno liga B e C)
INSERT INTO public.internal_channels (id, unit_a_id, unit_b_id) VALUES
  ('00000000-0000-4000-8230-000000000301', '00000000-0000-4000-8230-0000000000b0', '00000000-0000-4000-8230-0000000000c0');
INSERT INTO public.internal_channel_messages (channel_id, autor_id, conteudo) VALUES
  ('00000000-0000-4000-8230-000000000301', '00000000-0000-4000-8230-000000000001', 'oi');
INSERT INTO public.sales_goals (unit_id, month, target) VALUES ('00000000-0000-4000-8230-0000000000b0', '2026-11-01', 10);
INSERT INTO public.unit_payment_fees (unit_id) VALUES ('00000000-0000-4000-8230-0000000000b0');
INSERT INTO public.wa_automations (unit_id, trigger, action) VALUES ('00000000-0000-4000-8230-0000000000b0', 'inbound_message', 'move_stage');
INSERT INTO public.wa_campaigns (id, unit_id, nome) VALUES
  ('00000000-0000-4000-8230-000000000302', '00000000-0000-4000-8230-0000000000b0', 'Campanha B');
INSERT INTO public.wa_campaign_recipients (campaign_id, phone) VALUES ('00000000-0000-4000-8230-000000000302', '5511900000230');
INSERT INTO public.wa_message_costs (unit_id, wa_msg_id, category, month_year) VALUES
  ('00000000-0000-4000-8230-0000000000b0', 'wamid.teste230', 'marketing', '2026-11');
INSERT INTO public.wa_message_templates (unit_id, name, content) VALUES ('00000000-0000-4000-8230-0000000000b0', 'modelo_b', 'Olá');
INSERT INTO public.wa_queues (id, unit_id, nome) VALUES
  ('00000000-0000-4000-8230-000000000303', '00000000-0000-4000-8230-0000000000b0', 'Fila B');
INSERT INTO public.wa_queue_agents (queue_id, agent_id) VALUES
  ('00000000-0000-4000-8230-000000000303', '00000000-0000-4000-8230-000000000001');
INSERT INTO public.wa_quick_replies (unit_id, shortcut, content) VALUES ('00000000-0000-4000-8230-0000000000b0', '/oi', 'Olá');
INSERT INTO public.wa_template_folders (unit_id, nome) VALUES ('00000000-0000-4000-8230-0000000000b0', 'Pasta B');

-- O RAISE com SQLSTATE próprio desfaz a subtransação; a mensagem leva o ROW_COUNT para fora
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

CREATE TEMP TABLE casos (ordem serial, caso text, usuario uuid, comando text, esperado text);

CREATE TEMP TABLE tabelas (tabela text);
INSERT INTO tabelas VALUES
  ('internal_channel_messages'), ('internal_channels'), ('sales_goals'), ('unit_payment_fees'), ('wa_automations'),
  ('wa_campaign_recipients'), ('wa_campaigns'), ('wa_message_costs'), ('wa_message_templates'), ('wa_queue_agents'),
  ('wa_queues'), ('wa_quick_replies'), ('wa_template_folders');

INSERT INTO casos (caso, usuario, comando, esperado)
SELECT format('%s: quem está em A e B, com A ativa, lê o de B', tabela), '00000000-0000-4000-8230-000000000001'::uuid,
       format('SELECT * FROM public.%I', tabela), '1' FROM tabelas
UNION ALL
SELECT format('%s: quem só está em A não lê o de B', tabela), '00000000-0000-4000-8230-000000000002'::uuid,
       format('SELECT * FROM public.%I', tabela), '0' FROM tabelas
UNION ALL
SELECT format('%s: admin da marca lê o de B', tabela), '00000000-0000-4000-8230-000000000005'::uuid,
       format('SELECT * FROM public.%I', tabela), '1' FROM tabelas;

INSERT INTO casos (caso, usuario, comando, esperado) VALUES
  ('quem está em B cria resposta rápida em B com A ativa', '00000000-0000-4000-8230-000000000001',
   $c$INSERT INTO public.wa_quick_replies (unit_id, shortcut, content) VALUES ('00000000-0000-4000-8230-0000000000b0', '/novo', 'x')$c$, '1'),
  ('quem não está em B não cria resposta rápida em B', '00000000-0000-4000-8230-000000000002',
   $c$INSERT INTO public.wa_quick_replies (unit_id, shortcut, content) VALUES ('00000000-0000-4000-8230-0000000000b0', '/novo', 'x')$c$, 'erro 42501'),
  ('quem não está em B não muda a fila de B', '00000000-0000-4000-8230-000000000002',
   $c$UPDATE public.wa_queues SET nome = 'trocada' WHERE id = '00000000-0000-4000-8230-000000000303'$c$, '0'),
  ('quem está em B não leva o modelo de B para C', '00000000-0000-4000-8230-000000000001',
   $c$UPDATE public.wa_message_templates SET unit_id = '00000000-0000-4000-8230-0000000000c0' WHERE name = 'modelo_b'$c$, 'erro 42501'),
  ('anon não lê modelos', NULL,
   $c$SELECT * FROM public.wa_message_templates$c$, 'erro 42501');

DO $$
DECLARE
  c record;
  obtido text;
  divergentes text[] := '{}';
BEGIN
  FOR c IN SELECT * FROM casos ORDER BY ordem LOOP
    obtido := pg_temp.linhas_afetadas_como(CASE WHEN c.usuario IS NULL THEN 'anon' ELSE 'authenticated' END,
                                           c.usuario, c.comando);
    IF obtido IS DISTINCT FROM c.esperado THEN
      divergentes := divergentes || format('%s: esperado %s, obtido %s', c.caso, c.esperado, obtido);
    END IF;
  END LOOP;
  IF cardinality(divergentes) > 0 THEN
    RAISE EXCEPTION E'unidades vinculadas:\n%', array_to_string(divergentes, E'\n');
  END IF;
END $$;

DO $$
DECLARE restantes text;
BEGIN
  SELECT string_agg(tablename || '.' || policyname, ', ') INTO restantes
    FROM pg_policies
   WHERE schemaname = 'public'
     AND (qual ~ 'profiles\.unit_id' OR with_check ~ 'profiles\.unit_id');
  IF restantes IS NOT NULL THEN
    RAISE EXCEPTION 'policies que ainda usam a unidade ativa (profiles.unit_id): %', restantes;
  END IF;
END $$;
