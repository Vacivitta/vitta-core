INSERT INTO public.tenants (id, nome) VALUES ('00000000-0000-4000-8000-0000000000f0', 'Rede Teste');
INSERT INTO public.units (id, tenant_id, nome, tipo) VALUES
  ('00000000-0000-4000-8000-0000000000a0', '00000000-0000-4000-8000-0000000000f0', 'Clínica A', 'clinica'),
  ('00000000-0000-4000-8000-0000000000b0', '00000000-0000-4000-8000-0000000000f0', 'Clínica B', 'clinica');

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('00000000-0000-4000-8000-000000000001', 'atendente@teste.invalid', '{"full_name": "Atendente"}'),
  ('00000000-0000-4000-8000-000000000003', 'gestor@teste.invalid', '{"full_name": "Gestor A"}'),
  ('00000000-0000-4000-8000-000000000006', 'gestorb@teste.invalid', '{"full_name": "Gestor B"}');

UPDATE public.profiles SET
  unit_id = CASE id WHEN '00000000-0000-4000-8000-000000000006' THEN '00000000-0000-4000-8000-0000000000b0'::uuid
                    ELSE '00000000-0000-4000-8000-0000000000a0'::uuid END,
  perfil  = CASE id WHEN '00000000-0000-4000-8000-000000000001' THEN 'atendente' ELSE 'gestor_unidade' END
 WHERE id IN ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000003',
              '00000000-0000-4000-8000-000000000006');

INSERT INTO public.user_units (user_id, unit_id) VALUES
  ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000a0'),
  ('00000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-0000000000a0'),
  ('00000000-0000-4000-8000-000000000006', '00000000-0000-4000-8000-0000000000b0');

INSERT INTO public.automation_runs (unit_id, origem, automation_id, gatilho, acao, resultado, motivo) VALUES
  ('00000000-0000-4000-8000-0000000000a0', 'evento', '00000000-0000-4000-8000-000000000501',
   'inbound_message', 'send_template', 'falhou', 'meta code=131026 teste'),
  ('00000000-0000-4000-8000-0000000000a0', 'tempo', '00000000-0000-4000-8000-000000000502',
   'lead_stuck_stage', 'move_stage', 'pulado', 'sem_lead');

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

CREATE TEMP TABLE casos (ordem serial, caso text, papel text, usuario uuid, comando text, esperado text);

INSERT INTO casos (caso, papel, usuario, comando, esperado) VALUES
  ('gestor da unidade lê as execuções da unidade', 'authenticated', '00000000-0000-4000-8000-000000000003',
   $c$SELECT * FROM public.automation_runs$c$, '2'),
  ('gestor de outra unidade não lê', 'authenticated', '00000000-0000-4000-8000-000000000006',
   $c$SELECT * FROM public.automation_runs$c$, '0'),
  ('atendente da unidade não lê', 'authenticated', '00000000-0000-4000-8000-000000000001',
   $c$SELECT * FROM public.automation_runs$c$, '0'),
  ('anon não lê', 'anon', NULL,
   $c$SELECT * FROM public.automation_runs$c$, 'erro 42501'),
  ('gestor não grava', 'authenticated', '00000000-0000-4000-8000-000000000003',
   $c$INSERT INTO public.automation_runs (unit_id, origem, automation_id, gatilho, acao, resultado)
      VALUES ('00000000-0000-4000-8000-0000000000a0', 'evento', gen_random_uuid(), 'x', 'x', 'pulado')$c$, 'erro 42501'),
  ('gestor não apaga', 'authenticated', '00000000-0000-4000-8000-000000000003',
   $c$DELETE FROM public.automation_runs$c$, 'erro 42501'),
  ('service_role grava', 'service_role', NULL,
   $c$INSERT INTO public.automation_runs (unit_id, origem, automation_id, gatilho, acao, resultado, detalhe)
      VALUES ('00000000-0000-4000-8000-0000000000a0', 'tempo', gen_random_uuid(), 'no_patient_reply',
              'send_template', 'modelo_enviado', '{"templateId": "t"}')$c$, '1'),
  ('resultado inválido é recusado', 'service_role', NULL,
   $c$INSERT INTO public.automation_runs (unit_id, origem, automation_id, gatilho, acao, resultado)
      VALUES ('00000000-0000-4000-8000-0000000000a0', 'evento', gen_random_uuid(), 'x', 'x', 'ok')$c$, 'erro 23514'),
  ('origem inválida é recusada', 'service_role', NULL,
   $c$INSERT INTO public.automation_runs (unit_id, origem, automation_id, gatilho, acao, resultado)
      VALUES ('00000000-0000-4000-8000-0000000000a0', 'manual', gen_random_uuid(), 'x', 'x', 'pulado')$c$, 'erro 23514');

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

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM cron.job
                  WHERE jobname = 'purge-automation-runs'
                    AND command ILIKE '%DELETE FROM public.automation_runs%90 days%') THEN
    RAISE EXCEPTION 'job purge-automation-runs ausente do cron.job (ou sem o DELETE de 90 dias)';
  END IF;
END $$;
