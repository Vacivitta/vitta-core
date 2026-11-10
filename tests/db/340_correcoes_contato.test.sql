-- Correções da 152: contato_id só para titular da mesma unidade, cliente acompanha o
-- ganho, apagar negócio mantém os dependentes da pessoa, negócio novo pela mensagem
-- sem duplicar. Dados fictícios, prefixo 8152.

INSERT INTO public.tenants (id, nome) VALUES ('00000000-0000-4000-8152-0000000000f0', 'Rede 152');
INSERT INTO public.units (id, tenant_id, nome, tipo) VALUES
  ('00000000-0000-4000-8152-0000000000a0', '00000000-0000-4000-8152-0000000000f0', 'Unidade 152 A', 'clinica'),
  ('00000000-0000-4000-8152-0000000000b0', '00000000-0000-4000-8152-0000000000f0', 'Unidade 152 B', 'clinica');
INSERT INTO public.funnels (id, nome, unit_id) VALUES
  ('00000000-0000-4000-8152-0000000000d0', 'Funil 152 A', '00000000-0000-4000-8152-0000000000a0'),
  ('00000000-0000-4000-8152-0000000000d1', 'Funil 152 B', '00000000-0000-4000-8152-0000000000b0');
INSERT INTO public.funnel_stages (id, funnel_id, nome, ordem, unit_id, resultado) VALUES
  ('00000000-0000-4000-8152-0000000000e0', '00000000-0000-4000-8152-0000000000d0', 'Novo', 0, '00000000-0000-4000-8152-0000000000a0', NULL),
  ('00000000-0000-4000-8152-0000000000e9', '00000000-0000-4000-8152-0000000000d0', 'Ganho', 9, '00000000-0000-4000-8152-0000000000a0', 'ganho'),
  ('00000000-0000-4000-8152-0000000000e1', '00000000-0000-4000-8152-0000000000d1', 'Novo', 0, '00000000-0000-4000-8152-0000000000b0', NULL);
INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('00000000-0000-4000-8152-000000000001', 'membro152@teste.invalid', '{"full_name": "Membro A"}');
INSERT INTO public.user_units (user_id, unit_id) VALUES
  ('00000000-0000-4000-8152-000000000001', '00000000-0000-4000-8152-0000000000a0');

-- A: um negócio sem telefone; B: a pessoa de outra unidade
INSERT INTO public.leads (id, nome, funnel_id, stage_id, unit_id) VALUES
  ('00000000-0000-4000-8152-000000000101', 'Meu', '00000000-0000-4000-8152-0000000000d0',
   '00000000-0000-4000-8152-0000000000e0', '00000000-0000-4000-8152-0000000000a0');
INSERT INTO public.leads (id, nome, telefone, funnel_id, stage_id, unit_id) VALUES
  ('00000000-0000-4000-8152-000000000201', 'Alheio', '(11) 90000-1521', '00000000-0000-4000-8152-0000000000d1',
   '00000000-0000-4000-8152-0000000000e1', '00000000-0000-4000-8152-0000000000b0');

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

-- 1. A prova da conferência: apontar o próprio negócio para o contato de outra unidade
DO $$
DECLARE
  obtido text;
BEGIN
  obtido := pg_temp.linhas_afetadas_como('authenticated', '00000000-0000-4000-8152-000000000001',
    $c$UPDATE public.leads SET contato_id = '00000000-0000-4000-8152-000000000201' WHERE id = '00000000-0000-4000-8152-000000000101'$c$);
  IF obtido <> 'erro 23514' THEN
    RAISE EXCEPTION 'trocar contato_id para contato de outra unidade deveria ser recusado (obtido %)', obtido;
  END IF;
  IF (SELECT nome FROM public.contatos WHERE id = '00000000-0000-4000-8152-000000000201') <> 'Alheio' THEN
    RAISE EXCEPTION 'o contato da outra unidade não deveria mudar';
  END IF;
END $$;

-- 2. Ganho como o app faz (só status no SET): o contato vira cliente
UPDATE public.leads SET status = 'ganho' WHERE id = '00000000-0000-4000-8152-000000000101';
DO $$
BEGIN
  IF NOT (SELECT is_converted FROM public.leads WHERE id = '00000000-0000-4000-8152-000000000101') THEN
    RAISE EXCEPTION 'pré-condição: fn_lead_status deveria ligar is_converted no ganho';
  END IF;
  IF NOT (SELECT cliente FROM public.contatos WHERE id = '00000000-0000-4000-8152-000000000101') THEN
    RAISE EXCEPTION 'o contato deveria virar cliente quando o negócio é ganho só por status';
  END IF;
END $$;

-- 4. Mensagem de quem só tem negócio ganho: abre um negócio; a segunda chamada devolve o mesmo
DO $$
DECLARE
  primeiro uuid;
  segundo uuid;
BEGIN
  UPDATE public.leads SET telefone = '(11) 90000-1520' WHERE id = '00000000-0000-4000-8152-000000000101';
  primeiro := public.abrir_negocio_da_mensagem('00000000-0000-4000-8152-000000000101', '00000000-0000-4000-8152-0000000000e0', 'whatsapp');
  segundo  := public.abrir_negocio_da_mensagem('00000000-0000-4000-8152-000000000101', '00000000-0000-4000-8152-0000000000e0', 'whatsapp');
  IF primeiro IS NULL OR primeiro IS DISTINCT FROM segundo THEN
    RAISE EXCEPTION 'a segunda mensagem deveria usar o negócio aberto pela primeira (% x %)', primeiro, segundo;
  END IF;
  IF (SELECT count(*) FROM public.leads WHERE contato_id = '00000000-0000-4000-8152-000000000101') <> 2 THEN
    RAISE EXCEPTION 'deveria haver o ganho e um negócio novo';
  END IF;
  IF (SELECT nome FROM public.leads WHERE id = primeiro) <> 'Meu' THEN
    RAISE EXCEPTION 'o negócio novo deveria ter a pessoa do contato';
  END IF;
  -- Com o negócio de B fechado a função precisa criar um: a etapa de A é recusada
  UPDATE public.leads SET status = 'ganho' WHERE id = '00000000-0000-4000-8152-000000000201';
  BEGIN
    PERFORM public.abrir_negocio_da_mensagem('00000000-0000-4000-8152-000000000201', '00000000-0000-4000-8152-0000000000e0', 'whatsapp');
    RAISE EXCEPTION 'etapa de outra unidade deveria ser recusada';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;
  -- O contato continua cliente com um negócio aberto ao lado do ganho
  IF NOT (SELECT cliente FROM public.contatos WHERE id = '00000000-0000-4000-8152-000000000101') THEN
    RAISE EXCEPTION 'o negócio novo não deveria tirar o cliente';
  END IF;
END $$;

-- 3. Dependente cadastrado no negócio ganho; apagar esse negócio não apaga o dependente
INSERT INTO public.lead_contacts (id, lead_id, nome, relacao, unit_id) VALUES
  ('00000000-0000-4000-8152-000000000301', '00000000-0000-4000-8152-000000000101', 'Filho', 'filho',
   '00000000-0000-4000-8152-0000000000a0');
DELETE FROM public.leads WHERE id = '00000000-0000-4000-8152-000000000101';
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.lead_contacts WHERE id = '00000000-0000-4000-8152-000000000301') THEN
    RAISE EXCEPTION 'o dependente deveria passar para o outro negócio da pessoa';
  END IF;
  IF (SELECT responsavel_id FROM public.contatos WHERE id = '00000000-0000-4000-8152-000000000301')
     IS DISTINCT FROM '00000000-0000-4000-8152-000000000101' THEN
    RAISE EXCEPTION 'o contato do dependente deveria continuar ligado à pessoa';
  END IF;
  -- Sem negócio convertido, deixa de ser cliente
  IF (SELECT cliente FROM public.contatos WHERE id = '00000000-0000-4000-8152-000000000101') THEN
    RAISE EXCEPTION 'apagado o ganho, o contato deixa de ser cliente';
  END IF;
  IF has_function_privilege('authenticated', 'public.abrir_negocio_da_mensagem(uuid,uuid,text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.fn_lead_contato_troca()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.fn_lead_dependentes_ficam()', 'EXECUTE') THEN
    RAISE EXCEPTION 'as funções da 152 são só do banco';
  END IF;
END $$;
