-- Empresas e tickets (147): módulo, consistência por unidade, funil de ticket,
-- aviso ao responsável, RLS e mesclar_leads.

INSERT INTO public.tenants (id, nome) VALUES ('00000000-0000-4000-8147-0000000000f0', 'Rede 147');
INSERT INTO public.units (id, tenant_id, nome, tipo) VALUES
  ('00000000-0000-4000-8147-0000000000a0', '00000000-0000-4000-8147-0000000000f0', 'Unidade A', 'comercial'),
  ('00000000-0000-4000-8147-0000000000b0', '00000000-0000-4000-8147-0000000000f0', 'Unidade B', 'comercial');

-- 1: atendente de A; 2: gestor de A; 3: atendente de B
INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('00000000-0000-4000-8147-000000000001', 'atendente147@teste.invalid', '{"full_name": "Atendente"}'),
  ('00000000-0000-4000-8147-000000000002', 'gestor147@teste.invalid', '{"full_name": "Gestor"}'),
  ('00000000-0000-4000-8147-000000000003', 'outra147@teste.invalid', '{"full_name": "Outra"}');
UPDATE public.profiles SET perfil = 'atendente' WHERE id IN ('00000000-0000-4000-8147-000000000001', '00000000-0000-4000-8147-000000000003');
UPDATE public.profiles SET perfil = 'gestor_unidade' WHERE id = '00000000-0000-4000-8147-000000000002';
INSERT INTO public.user_units (user_id, unit_id) VALUES
  ('00000000-0000-4000-8147-000000000001', '00000000-0000-4000-8147-0000000000a0'),
  ('00000000-0000-4000-8147-000000000002', '00000000-0000-4000-8147-0000000000a0'),
  ('00000000-0000-4000-8147-000000000003', '00000000-0000-4000-8147-0000000000b0');

INSERT INTO public.funnels (id, nome, unit_id, objeto) VALUES
  ('00000000-0000-4000-8147-0000000000d1', 'Vendas A', '00000000-0000-4000-8147-0000000000a0', 'negocio'),
  ('00000000-0000-4000-8147-0000000000d2', 'Suporte A', '00000000-0000-4000-8147-0000000000a0', 'ticket'),
  ('00000000-0000-4000-8147-0000000000d3', 'Suporte B', '00000000-0000-4000-8147-0000000000b0', 'ticket');
INSERT INTO public.funnel_stages (id, funnel_id, nome, ordem, unit_id) VALUES
  ('00000000-0000-4000-8147-0000000000e1', '00000000-0000-4000-8147-0000000000d1', 'Novo', 0, '00000000-0000-4000-8147-0000000000a0'),
  ('00000000-0000-4000-8147-0000000000e2', '00000000-0000-4000-8147-0000000000d2', 'Aberto', 0, '00000000-0000-4000-8147-0000000000a0'),
  ('00000000-0000-4000-8147-0000000000e3', '00000000-0000-4000-8147-0000000000d2', 'Em andamento', 1, '00000000-0000-4000-8147-0000000000a0');
INSERT INTO public.leads (id, nome, telefone, funnel_id, stage_id, unit_id) VALUES
  ('00000000-0000-4000-8147-000000000101', 'Licenciado', '(11) 90000-0147', '00000000-0000-4000-8147-0000000000d1', '00000000-0000-4000-8147-0000000000e1', '00000000-0000-4000-8147-0000000000a0'),
  ('00000000-0000-4000-8147-000000000102', 'Sócio', '(11) 90000-0148', '00000000-0000-4000-8147-0000000000d1', '00000000-0000-4000-8147-0000000000e1', '00000000-0000-4000-8147-0000000000a0');

DO $$
DECLARE
  a constant uuid := '00000000-0000-4000-8147-0000000000a0';
BEGIN
  -- Módulos desligados: nada de empresa nem ticket
  BEGIN
    INSERT INTO public.empresas (unit_id, nome) VALUES (a, 'Sem módulo');
    RAISE EXCEPTION 'empresa com o módulo desligado deveria ser recusada';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO public.tickets (unit_id, titulo, funnel_id) VALUES (a, 'Sem módulo', '00000000-0000-4000-8147-0000000000d2');
    RAISE EXCEPTION 'ticket com o módulo desligado deveria ser recusado';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END $$;

INSERT INTO public.unidade_modulos (unit_id, modulo, ativo) VALUES
  ('00000000-0000-4000-8147-0000000000a0', 'empresas', true),
  ('00000000-0000-4000-8147-0000000000a0', 'tickets', true),
  ('00000000-0000-4000-8147-0000000000b0', 'empresas', true),
  ('00000000-0000-4000-8147-0000000000b0', 'tickets', true);

INSERT INTO public.empresas (id, unit_id, nome, cnpj) VALUES
  ('00000000-0000-4000-8147-000000000201', '00000000-0000-4000-8147-0000000000a0', 'Clínica Licenciada Ltda', '12345678000190'),
  ('00000000-0000-4000-8147-000000000202', '00000000-0000-4000-8147-0000000000b0', 'Empresa de B', NULL);
INSERT INTO public.empresa_vinculos (empresa_id, lead_id, papel) VALUES
  ('00000000-0000-4000-8147-000000000201', '00000000-0000-4000-8147-000000000101', 'decisor'),
  ('00000000-0000-4000-8147-000000000201', '00000000-0000-4000-8147-000000000102', 'socio');

DO $$
DECLARE
  a constant uuid := '00000000-0000-4000-8147-0000000000a0';
BEGIN
  BEGIN
    INSERT INTO public.empresas (unit_id, nome, cnpj) VALUES (a, 'CNPJ repetido', '12345678000190');
    RAISE EXCEPTION 'CNPJ repetido na unidade deveria ser recusado';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO public.empresas (unit_id, nome, cnpj) VALUES (a, 'CNPJ com máscara', '12.345.678/0001-90');
    RAISE EXCEPTION 'CNPJ fora de 14 dígitos deveria ser recusado';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO public.empresa_vinculos (empresa_id, lead_id) VALUES ('00000000-0000-4000-8147-000000000202', '00000000-0000-4000-8147-000000000101');
    RAISE EXCEPTION 'vínculo entre empresa e lead de unidades diferentes deveria ser recusado';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  -- Funil de ticket não recebe lead
  BEGIN
    UPDATE public.leads SET funnel_id = '00000000-0000-4000-8147-0000000000d2' WHERE id = '00000000-0000-4000-8147-000000000101';
    RAISE EXCEPTION 'lead em funil de ticket deveria ser recusado';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO public.tickets (unit_id, titulo, funnel_id) VALUES (a, 'Funil de negócio', '00000000-0000-4000-8147-0000000000d1');
    RAISE EXCEPTION 'ticket em funil de negócio deveria ser recusado';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO public.tickets (unit_id, titulo, funnel_id) VALUES (a, 'Funil de B', '00000000-0000-4000-8147-0000000000d3');
    RAISE EXCEPTION 'ticket com funil de outra unidade deveria ser recusado';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO public.tickets (unit_id, titulo, funnel_id, stage_id) VALUES (a, 'Etapa errada', '00000000-0000-4000-8147-0000000000d2', '00000000-0000-4000-8147-0000000000e1');
    RAISE EXCEPTION 'etapa de outro funil deveria ser recusada';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO public.tickets (unit_id, titulo, funnel_id, responsavel_id) VALUES (a, 'Responsável de fora', '00000000-0000-4000-8147-0000000000d2', '00000000-0000-4000-8147-000000000003');
    RAISE EXCEPTION 'responsável de outra unidade deveria ser recusado';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO public.tickets (unit_id, titulo, funnel_id, empresa_id) VALUES (a, 'Empresa de B', '00000000-0000-4000-8147-0000000000d2', '00000000-0000-4000-8147-000000000202');
    RAISE EXCEPTION 'empresa de outra unidade deveria ser recusada';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END $$;

-- Ticket aberto pela atendente para o gestor: o gestor é avisado
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8147-000000000001", "role": "authenticated"}', false);
INSERT INTO public.tickets (id, unit_id, titulo, funnel_id, stage_id, responsavel_id, empresa_id, lead_id) VALUES
  ('00000000-0000-4000-8147-000000000301', '00000000-0000-4000-8147-0000000000a0', 'Licenciado sem acesso ao portal',
   '00000000-0000-4000-8147-0000000000d2', '00000000-0000-4000-8147-0000000000e2', '00000000-0000-4000-8147-000000000002',
   '00000000-0000-4000-8147-000000000201', '00000000-0000-4000-8147-000000000101');
-- Ticket que a atendente atribui a si mesma: sem aviso
INSERT INTO public.tickets (id, unit_id, titulo, funnel_id, responsavel_id) VALUES
  ('00000000-0000-4000-8147-000000000302', '00000000-0000-4000-8147-0000000000a0', 'Eu mesma resolvo',
   '00000000-0000-4000-8147-0000000000d2', '00000000-0000-4000-8147-000000000001');
SELECT set_config('request.jwt.claims', '', false);

DO $$
BEGIN
  IF (SELECT count(*) FROM public.notifications WHERE ticket_id = '00000000-0000-4000-8147-000000000301'
        AND user_id = '00000000-0000-4000-8147-000000000002' AND type = 'ticket_atribuido') <> 1 THEN
    RAISE EXCEPTION 'o responsável deveria receber um aviso pessoal';
  END IF;
  IF EXISTS (SELECT 1 FROM public.notifications WHERE ticket_id = '00000000-0000-4000-8147-000000000302') THEN
    RAISE EXCEPTION 'quem atribui a si mesmo não recebe aviso';
  END IF;
  IF (SELECT criado_por FROM public.tickets WHERE id = '00000000-0000-4000-8147-000000000301')
     IS DISTINCT FROM '00000000-0000-4000-8147-000000000001' THEN
    RAISE EXCEPTION 'criado_por vem de quem abriu';
  END IF;
  -- Reatribuir avisa o novo responsável
  UPDATE public.tickets SET responsavel_id = '00000000-0000-4000-8147-000000000001' WHERE id = '00000000-0000-4000-8147-000000000301';
  IF NOT EXISTS (SELECT 1 FROM public.notifications WHERE ticket_id = '00000000-0000-4000-8147-000000000301'
                  AND user_id = '00000000-0000-4000-8147-000000000001') THEN
    RAISE EXCEPTION 'reatribuir deveria avisar o novo responsável';
  END IF;
  UPDATE public.tickets SET status = 'resolvido' WHERE id = '00000000-0000-4000-8147-000000000301';
  IF (SELECT resolvido_em FROM public.tickets WHERE id = '00000000-0000-4000-8147-000000000301') IS NULL THEN
    RAISE EXCEPTION 'resolver marca resolvido_em';
  END IF;
  UPDATE public.tickets SET status = 'aberto' WHERE id = '00000000-0000-4000-8147-000000000301';
  IF (SELECT resolvido_em FROM public.tickets WHERE id = '00000000-0000-4000-8147-000000000301') IS NOT NULL THEN
    RAISE EXCEPTION 'reabrir limpa resolvido_em';
  END IF;
  BEGIN
    UPDATE public.funnels SET objeto = 'negocio' WHERE id = '00000000-0000-4000-8147-0000000000d2';
    RAISE EXCEPTION 'funil com ticket não troca para negócio';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END $$;

-- Mesclar leads move vínculos e tickets
DO $$
BEGIN
  PERFORM public.mesclar_leads('00000000-0000-4000-8147-000000000102', '00000000-0000-4000-8147-000000000101', NULL);
  IF (SELECT lead_id FROM public.tickets WHERE id = '00000000-0000-4000-8147-000000000301')
     IS DISTINCT FROM '00000000-0000-4000-8147-000000000102' THEN
    RAISE EXCEPTION 'mesclar deveria mover o ticket para o lead mantido';
  END IF;
  IF (SELECT count(*) FROM public.empresa_vinculos WHERE empresa_id = '00000000-0000-4000-8147-000000000201') <> 1 THEN
    RAISE EXCEPTION 'mesclar deveria juntar os vínculos com a mesma empresa';
  END IF;
END $$;

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
  ('atendente de A lê os tickets de A', 'authenticated', '00000000-0000-4000-8147-000000000001',
   $c$SELECT * FROM public.tickets WHERE unit_id = '00000000-0000-4000-8147-0000000000a0'$c$, '2'),
  ('atendente de B não lê os tickets de A', 'authenticated', '00000000-0000-4000-8147-000000000003',
   $c$SELECT * FROM public.tickets WHERE unit_id = '00000000-0000-4000-8147-0000000000a0'$c$, '0'),
  ('atendente de B não lê a empresa de A nem os vínculos', 'authenticated', '00000000-0000-4000-8147-000000000003',
   $c$SELECT * FROM public.empresa_vinculos$c$, '0'),
  ('atendente de A cria empresa', 'authenticated', '00000000-0000-4000-8147-000000000001',
   $c$INSERT INTO public.empresas (unit_id, nome) VALUES ('00000000-0000-4000-8147-0000000000a0', 'Nova')$c$, '1'),
  -- Recusado já no trigger: sob o RLS de B, o funil de A não existe (23514, antes do 42501 da regra)
  ('atendente de B não cria ticket em A', 'authenticated', '00000000-0000-4000-8147-000000000003',
   $c$INSERT INTO public.tickets (unit_id, titulo, funnel_id) VALUES ('00000000-0000-4000-8147-0000000000a0', 'x', '00000000-0000-4000-8147-0000000000d2')$c$, 'erro 23514'),
  ('atendente de A move o ticket de etapa', 'authenticated', '00000000-0000-4000-8147-000000000001',
   $c$UPDATE public.tickets SET stage_id = '00000000-0000-4000-8147-0000000000e3' WHERE id = '00000000-0000-4000-8147-000000000301'$c$, '1'),
  ('atendente não apaga ticket', 'authenticated', '00000000-0000-4000-8147-000000000001',
   $c$DELETE FROM public.tickets WHERE id = '00000000-0000-4000-8147-000000000302'$c$, '0'),
  ('gestor apaga ticket', 'authenticated', '00000000-0000-4000-8147-000000000002',
   $c$DELETE FROM public.tickets WHERE id = '00000000-0000-4000-8147-000000000302'$c$, '1'),
  ('atendente não apaga empresa', 'authenticated', '00000000-0000-4000-8147-000000000001',
   $c$DELETE FROM public.empresas WHERE id = '00000000-0000-4000-8147-000000000201'$c$, '0'),
  ('atendente não grava notificação do ticket', 'authenticated', '00000000-0000-4000-8147-000000000001',
   $c$INSERT INTO public.notifications (unit_id, user_id, type, title) VALUES ('00000000-0000-4000-8147-0000000000a0', '00000000-0000-4000-8147-000000000002', 'ticket_atribuido', 'x')$c$, 'erro 42501'),
  ('anon não lê tickets', 'anon', NULL, $c$SELECT * FROM public.tickets$c$, 'erro 42501');

DO $$
DECLARE
  r record;
  obtido text;
  falhas text := '';
BEGIN
  FOR r IN SELECT * FROM casos ORDER BY ordem LOOP
    obtido := pg_temp.linhas_afetadas_como(r.papel, r.usuario, r.comando);
    IF obtido IS DISTINCT FROM r.esperado THEN
      falhas := falhas || format(E'\n  %s: esperado %s, obtido %s', r.caso, r.esperado, obtido);
    END IF;
  END LOOP;
  IF falhas <> '' THEN
    RAISE EXCEPTION 'empresas e tickets:%', falhas;
  END IF;
END $$;
