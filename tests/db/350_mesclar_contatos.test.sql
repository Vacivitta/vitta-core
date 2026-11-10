-- mesclar_contatos (153): negócios, dependentes, conversas e campos da pessoa vão
-- para o mantido; telefone e e-mail diferentes vão para as observações; opt-out
-- mais antigo vence; o removido some. Dados fictícios, prefixo 8153.

INSERT INTO public.tenants (id, nome) VALUES ('00000000-0000-4000-8153-0000000000f0', 'Rede 153');
INSERT INTO public.units (id, tenant_id, nome, tipo) VALUES
  ('00000000-0000-4000-8153-0000000000a0', '00000000-0000-4000-8153-0000000000f0', 'Unidade 153 A', 'clinica'),
  ('00000000-0000-4000-8153-0000000000b0', '00000000-0000-4000-8153-0000000000f0', 'Unidade 153 B', 'clinica');
INSERT INTO public.funnels (id, nome, unit_id) VALUES
  ('00000000-0000-4000-8153-0000000000d0', 'Funil 153 A', '00000000-0000-4000-8153-0000000000a0'),
  ('00000000-0000-4000-8153-0000000000d1', 'Funil 153 B', '00000000-0000-4000-8153-0000000000b0');
INSERT INTO public.funnel_stages (id, funnel_id, nome, ordem, unit_id) VALUES
  ('00000000-0000-4000-8153-0000000000e0', '00000000-0000-4000-8153-0000000000d0', 'Novo', 0, '00000000-0000-4000-8153-0000000000a0'),
  ('00000000-0000-4000-8153-0000000000e1', '00000000-0000-4000-8153-0000000000d1', 'Novo', 0, '00000000-0000-4000-8153-0000000000b0');
INSERT INTO public.campos_lead (unit_id, objeto, rotulo, tipo) VALUES
  ('00000000-0000-4000-8153-0000000000a0', 'contato', 'Alergias', 'texto'),
  ('00000000-0000-4000-8153-0000000000a0', 'contato', 'Convenio', 'texto');

-- Mantido: sem e-mail, com telefone; removido: outro telefone, e-mail, opt-out, ganho
INSERT INTO public.leads (id, nome, telefone, funnel_id, stage_id, unit_id, campos) VALUES
  ('00000000-0000-4000-8153-000000000101', 'Ana', '(11) 90000-1531', '00000000-0000-4000-8153-0000000000d0',
   '00000000-0000-4000-8153-0000000000e0', '00000000-0000-4000-8153-0000000000a0', '{"alergias": "nenhuma"}');
INSERT INTO public.leads (id, nome, sobrenome, telefone, email, wa_optout_at, funnel_id, stage_id, unit_id, status, campos) VALUES
  ('00000000-0000-4000-8153-000000000201', 'Ana Paula', 'Lima', '(11) 90000-1532', 'ana@teste.invalid', '2026-10-01',
   '00000000-0000-4000-8153-0000000000d0', '00000000-0000-4000-8153-0000000000e0', '00000000-0000-4000-8153-0000000000a0',
   'ganho', '{"alergias": "dipirona", "convenio": "Unimed"}');
INSERT INTO public.lead_contacts (id, lead_id, nome, relacao, unit_id) VALUES
  ('00000000-0000-4000-8153-000000000301', '00000000-0000-4000-8153-000000000201', 'Filho', 'filho',
   '00000000-0000-4000-8153-0000000000a0');
INSERT INTO public.wa_conversations (id, unit_id, wa_phone) VALUES
  ('00000000-0000-4000-8153-000000000401', '00000000-0000-4000-8153-0000000000a0', '5511900001532');
-- Outra unidade, para a recusa
INSERT INTO public.leads (id, nome, funnel_id, stage_id, unit_id) VALUES
  ('00000000-0000-4000-8153-000000000501', 'Outra', '00000000-0000-4000-8153-0000000000d1',
   '00000000-0000-4000-8153-0000000000e1', '00000000-0000-4000-8153-0000000000b0');

SELECT public.mesclar_contatos('00000000-0000-4000-8153-000000000101', '00000000-0000-4000-8153-000000000201');

DO $$
DECLARE
  c public.contatos%ROWTYPE;
BEGIN
  SELECT * INTO c FROM public.contatos WHERE id = '00000000-0000-4000-8153-000000000101';
  IF EXISTS (SELECT 1 FROM public.contatos WHERE id = '00000000-0000-4000-8153-000000000201') THEN
    RAISE EXCEPTION 'o contato removido deveria sumir';
  END IF;
  IF (SELECT count(*) FROM public.leads WHERE contato_id = c.id) <> 2 THEN
    RAISE EXCEPTION 'os dois negócios deveriam ficar com o mantido';
  END IF;
  IF c.nome <> 'Ana' OR c.sobrenome IS DISTINCT FROM 'Lima' OR c.email IS DISTINCT FROM 'ana@teste.invalid'
     OR c.telefone IS DISTINCT FROM '(11) 90000-1531' THEN
    RAISE EXCEPTION 'o mantido completa o que não tinha e mantém o que tinha (% % % %)', c.nome, c.sobrenome, c.email, c.telefone;
  END IF;
  IF position('Outro telefone: (11) 90000-1532' IN coalesce(c.observacoes, '')) = 0 THEN
    RAISE EXCEPTION 'o telefone do removido deveria ir para as observações (%)', c.observacoes;
  END IF;
  IF c.wa_optout_at IS NULL THEN
    RAISE EXCEPTION 'o opt-out do removido deveria chegar ao mantido';
  END IF;
  IF c.campos <> '{"alergias": "nenhuma", "convenio": "Unimed"}'::jsonb THEN
    RAISE EXCEPTION 'campos da pessoa: o mantido vence e completa com o removido (%)', c.campos;
  END IF;
  IF NOT c.cliente THEN
    RAISE EXCEPTION 'o negócio ganho que veio do removido faz o mantido cliente';
  END IF;
  IF EXISTS (SELECT 1 FROM public.leads l WHERE l.contato_id = c.id
               AND (l.nome, l.sobrenome, l.telefone, l.email, l.wa_optout_at) IS DISTINCT FROM (c.nome, c.sobrenome, c.telefone, c.email, c.wa_optout_at)) THEN
    RAISE EXCEPTION 'os negócios deveriam ficar com a pessoa do mantido';
  END IF;
  IF (SELECT responsavel_id FROM public.contatos WHERE id = '00000000-0000-4000-8153-000000000301') IS DISTINCT FROM c.id THEN
    RAISE EXCEPTION 'o dependente deveria passar para o mantido';
  END IF;
  IF (SELECT contato_id FROM public.wa_conversations WHERE id = '00000000-0000-4000-8153-000000000401') IS DISTINCT FROM c.id THEN
    RAISE EXCEPTION 'a conversa deveria passar para o mantido';
  END IF;
END $$;

-- Recusas
DO $$
BEGIN
  BEGIN
    PERFORM public.mesclar_contatos('00000000-0000-4000-8153-000000000101', '00000000-0000-4000-8153-000000000501');
    RAISE EXCEPTION 'contatos de unidades diferentes deveriam ser recusados';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;
  BEGIN
    PERFORM public.mesclar_contatos('00000000-0000-4000-8153-000000000101', '00000000-0000-4000-8153-000000000301');
    RAISE EXCEPTION 'dependente não deveria ser mesclado';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;
  BEGIN
    PERFORM set_config('request.jwt.claims', '{"role": "authenticated"}', true);
    PERFORM public.mesclar_contatos('00000000-0000-4000-8153-000000000101', '00000000-0000-4000-8153-000000000501');
    RAISE EXCEPTION 'JWT do app deveria ser recusado';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    -- O bloco de exceção anterior desfez o set_config: define de novo
    PERFORM set_config('request.jwt.claims', '{"role": "authenticated"}', true);
    PERFORM public.abrir_negocio_da_mensagem('00000000-0000-4000-8153-000000000101', '00000000-0000-4000-8153-0000000000e0', 'x');
    RAISE EXCEPTION 'abrir_negocio_da_mensagem com JWT do app deveria ser recusado';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  PERFORM set_config('request.jwt.claims', '', true);
  IF has_function_privilege('authenticated', 'public.mesclar_contatos(uuid,uuid,uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.mesclar_contatos(uuid,uuid,uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'mesclar_contatos é só do servidor';
  END IF;
END $$;
