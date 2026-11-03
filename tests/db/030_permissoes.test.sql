-- MUST KILL: deriva da 010 em relação à produção; corrigir por migração, não no teste
DROP TRIGGER IF EXISTS quotes_no_delete ON public.quotes;

INSERT INTO public.tenants (id, nome) VALUES ('00000000-0000-4000-8000-0000000000f0', 'Rede Teste');
INSERT INTO public.units (id, tenant_id, nome, tipo) VALUES
  ('00000000-0000-4000-8000-0000000000a0', '00000000-0000-4000-8000-0000000000f0', 'Clínica A', 'clinica'),
  ('00000000-0000-4000-8000-0000000000b0', '00000000-0000-4000-8000-0000000000f0', 'Clínica B', 'clinica'),
  ('00000000-0000-4000-8000-0000000000c0', '00000000-0000-4000-8000-0000000000f0', 'Clínica C', 'clinica');

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('00000000-0000-4000-8000-000000000001', 'atendente@teste.invalid', '{"full_name": "Atendente"}'),
  ('00000000-0000-4000-8000-000000000002', 'atendente2@teste.invalid', '{"full_name": "Outra Atendente"}'),
  ('00000000-0000-4000-8000-000000000003', 'gestor@teste.invalid', '{"full_name": "Gestor Unidade"}'),
  ('00000000-0000-4000-8000-000000000004', 'gestorvv@teste.invalid', '{"full_name": "Gestor Vacivitta"}'),
  ('00000000-0000-4000-8000-000000000005', 'admin@teste.invalid', '{"full_name": "Admin"}');

DO $$
BEGIN
  IF (SELECT count(*) FROM public.profiles
       WHERE id::text LIKE '00000000-0000-4000-8000-00000000000_' AND perfil = 'atendente' AND ativo) <> 5 THEN
    RAISE EXCEPTION 'handle_new_user deveria criar um perfil atendente ativo para cada usuário novo';
  END IF;
END $$;

UPDATE public.profiles SET unit_id = '00000000-0000-4000-8000-0000000000a0',
  perfil = CASE id
    WHEN '00000000-0000-4000-8000-000000000003' THEN 'gestor_unidade'
    WHEN '00000000-0000-4000-8000-000000000004' THEN 'gestor_vacivitta'
    WHEN '00000000-0000-4000-8000-000000000005' THEN 'admin'
    ELSE 'atendente' END
 WHERE id::text LIKE '00000000-0000-4000-8000-00000000000_';

INSERT INTO public.user_units (user_id, unit_id) VALUES
  ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000a0'),
  ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000b0'),
  ('00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-0000000000a0'),
  ('00000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-0000000000a0');

INSERT INTO public.funnels (id, nome, unit_id)
VALUES ('00000000-0000-4000-8000-0000000000d0', 'Funil Teste', '00000000-0000-4000-8000-0000000000a0');
INSERT INTO public.funnel_stages (id, funnel_id, nome, unit_id)
VALUES ('00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000d0', 'Novo',
        '00000000-0000-4000-8000-0000000000a0');

INSERT INTO public.leads (id, nome, funnel_id, stage_id, unit_id) VALUES
  ('00000000-0000-4000-8000-000000000101', 'Paciente Um', '00000000-0000-4000-8000-0000000000d0',
   '00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000a0'),
  ('00000000-0000-4000-8000-000000000102', 'Paciente Dois', '00000000-0000-4000-8000-0000000000d0',
   '00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000a0');

INSERT INTO public.lead_notes (id, lead_id, conteudo, autor_id) VALUES
  ('00000000-0000-4000-8000-000000000201', '00000000-0000-4000-8000-000000000101', 'nota do atendente',
   '00000000-0000-4000-8000-000000000001'),
  ('00000000-0000-4000-8000-000000000202', '00000000-0000-4000-8000-000000000101', 'nota de outra pessoa',
   '00000000-0000-4000-8000-000000000002');

INSERT INTO public.lead_tasks (id, lead_id, titulo, responsavel_id) VALUES
  ('00000000-0000-4000-8000-000000000301', '00000000-0000-4000-8000-000000000101', 'tarefa do atendente',
   '00000000-0000-4000-8000-000000000001'),
  ('00000000-0000-4000-8000-000000000302', '00000000-0000-4000-8000-000000000101', 'tarefa de outra pessoa',
   '00000000-0000-4000-8000-000000000002'),
  ('00000000-0000-4000-8000-000000000303', '00000000-0000-4000-8000-000000000101', 'tarefa sem responsável',
   NULL);

INSERT INTO public.quotes (id, unit_id, lead_id)
VALUES ('00000000-0000-4000-8000-000000000401', '00000000-0000-4000-8000-0000000000a0',
        '00000000-0000-4000-8000-000000000101');

-- MUST KILL: nome vago; esconde o truque do SQLSTATE VCT01 que desfaz a subtransação e carrega o ROW_COUNT
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

CREATE TEMP TABLE casos (ordem serial, caso text, papel text, usuario uuid, comando text, esperado text);

INSERT INTO casos (caso, papel, usuario, comando, esperado) VALUES
  ('atendente apaga a própria nota', 'authenticated', '00000000-0000-4000-8000-000000000001',
   $c$DELETE FROM public.lead_notes WHERE id = '00000000-0000-4000-8000-000000000201'$c$, '1'),
  ('atendente apaga nota de outra pessoa', 'authenticated', '00000000-0000-4000-8000-000000000001',
   $c$DELETE FROM public.lead_notes WHERE id = '00000000-0000-4000-8000-000000000202'$c$, '0'),
  ('atendente edita nota de outra pessoa', 'authenticated', '00000000-0000-4000-8000-000000000001',
   $c$UPDATE public.lead_notes SET conteudo = 'editada' WHERE id = '00000000-0000-4000-8000-000000000202'$c$, '1'),
  ('gestor_unidade apaga nota alheia', 'authenticated', '00000000-0000-4000-8000-000000000003',
   $c$DELETE FROM public.lead_notes WHERE id = '00000000-0000-4000-8000-000000000201'$c$, '1'),
  ('atendente apaga a própria tarefa', 'authenticated', '00000000-0000-4000-8000-000000000001',
   $c$DELETE FROM public.lead_tasks WHERE id = '00000000-0000-4000-8000-000000000301'$c$, '1'),
  ('atendente apaga tarefa de outra pessoa', 'authenticated', '00000000-0000-4000-8000-000000000001',
   $c$DELETE FROM public.lead_tasks WHERE id = '00000000-0000-4000-8000-000000000302'$c$, '0'),
  ('atendente apaga tarefa sem responsável', 'authenticated', '00000000-0000-4000-8000-000000000001',
   $c$DELETE FROM public.lead_tasks WHERE id = '00000000-0000-4000-8000-000000000303'$c$, '1'),
  ('atendente apaga orçamento', 'authenticated', '00000000-0000-4000-8000-000000000001',
   $c$DELETE FROM public.quotes WHERE id = '00000000-0000-4000-8000-000000000401'$c$, '0'),
  ('gestor_unidade apaga orçamento', 'authenticated', '00000000-0000-4000-8000-000000000003',
   $c$DELETE FROM public.quotes WHERE id = '00000000-0000-4000-8000-000000000401'$c$, '1'),
  ('atendente apaga lead', 'authenticated', '00000000-0000-4000-8000-000000000001',
   $c$DELETE FROM public.leads WHERE id = '00000000-0000-4000-8000-000000000102'$c$, '0'),
  ('gestor_unidade apaga lead da unidade', 'authenticated', '00000000-0000-4000-8000-000000000003',
   $c$DELETE FROM public.leads WHERE id = '00000000-0000-4000-8000-000000000102'$c$, '1'),
  ('atendente troca a unidade do lead (vinculado às duas)', 'authenticated', '00000000-0000-4000-8000-000000000001',
   $c$UPDATE public.leads SET unit_id = '00000000-0000-4000-8000-0000000000b0' WHERE id = '00000000-0000-4000-8000-000000000102'$c$, 'erro 42501'),
  ('service_role troca a unidade do lead', 'service_role', NULL,
   $c$UPDATE public.leads SET unit_id = '00000000-0000-4000-8000-0000000000b0' WHERE id = '00000000-0000-4000-8000-000000000102'$c$, '1'),
  ('admin troca o tipo de unidade com leads', 'authenticated', '00000000-0000-4000-8000-000000000005',
   $c$UPDATE public.units SET tipo = 'comercial' WHERE id = '00000000-0000-4000-8000-0000000000a0'$c$, 'erro 42501'),
  ('admin troca o tipo de unidade vazia', 'authenticated', '00000000-0000-4000-8000-000000000005',
   $c$UPDATE public.units SET tipo = 'comercial' WHERE id = '00000000-0000-4000-8000-0000000000c0'$c$, '1'),
  ('gestor_vacivitta troca o tipo de unidade vazia', 'authenticated', '00000000-0000-4000-8000-000000000004',
   $c$UPDATE public.units SET tipo = 'comercial' WHERE id = '00000000-0000-4000-8000-0000000000c0'$c$, '0'),
  ('atendente troca a própria unidade ativa para uma vinculada', 'authenticated', '00000000-0000-4000-8000-000000000001',
   $c$UPDATE public.profiles SET unit_id = '00000000-0000-4000-8000-0000000000b0' WHERE id = '00000000-0000-4000-8000-000000000001'$c$, '1'),
  ('atendente troca a própria unidade ativa para uma não vinculada', 'authenticated', '00000000-0000-4000-8000-000000000001',
   $c$UPDATE public.profiles SET unit_id = '00000000-0000-4000-8000-0000000000c0' WHERE id = '00000000-0000-4000-8000-000000000001'$c$, 'erro 42501'),
  ('atendente edita o perfil de outra pessoa', 'authenticated', '00000000-0000-4000-8000-000000000001',
   $c$UPDATE public.profiles SET apelido = 'outro' WHERE id = '00000000-0000-4000-8000-000000000002'$c$, '0'),
  ('atendente se promove a admin', 'authenticated', '00000000-0000-4000-8000-000000000001',
   $c$UPDATE public.profiles SET perfil = 'admin' WHERE id = '00000000-0000-4000-8000-000000000001'$c$, 'erro 42501');

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
