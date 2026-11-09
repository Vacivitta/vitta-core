-- Vários negócios por contato (150): o negócio novo se liga ao contato do telefone,
-- cliente = algum negócio convertido, unidade só muda com um negócio, a conversa
-- prefere o negócio aberto. Dados fictícios, prefixo 8150.

INSERT INTO public.tenants (id, nome) VALUES ('00000000-0000-4000-8150-0000000000f0', 'Rede 150');
INSERT INTO public.units (id, tenant_id, nome, tipo) VALUES
  ('00000000-0000-4000-8150-0000000000a0', '00000000-0000-4000-8150-0000000000f0', 'Unidade 150 A', 'clinica'),
  ('00000000-0000-4000-8150-0000000000b0', '00000000-0000-4000-8150-0000000000f0', 'Unidade 150 B', 'clinica');
INSERT INTO public.funnels (id, nome, unit_id) VALUES
  ('00000000-0000-4000-8150-0000000000d0', 'Funil 150 A', '00000000-0000-4000-8150-0000000000a0'),
  ('00000000-0000-4000-8150-0000000000d1', 'Funil 150 B', '00000000-0000-4000-8150-0000000000b0');
INSERT INTO public.funnel_stages (id, funnel_id, nome, ordem) VALUES
  ('00000000-0000-4000-8150-0000000000e0', '00000000-0000-4000-8150-0000000000d0', 'Novo', 1),
  ('00000000-0000-4000-8150-0000000000e1', '00000000-0000-4000-8150-0000000000d1', 'Novo', 1);

-- 1º negócio: cria o contato (como na 148)
INSERT INTO public.leads (id, nome, sobrenome, telefone, email, funnel_id, stage_id, unit_id, status, is_converted) VALUES
  ('00000000-0000-4000-8150-000000000101', 'Ana', 'Lima', '(11) 90000-1501', 'ana@teste.invalid',
   '00000000-0000-4000-8150-0000000000d0', '00000000-0000-4000-8150-0000000000e0', '00000000-0000-4000-8150-0000000000a0',
   'ganho', true);

-- 2º negócio, mesmo telefone em outra máscara e sem e-mail: liga ao mesmo contato
INSERT INTO public.leads (id, nome, telefone, profissao, funnel_id, stage_id, unit_id) VALUES
  ('00000000-0000-4000-8150-000000000102', 'Aninha', '11 900001501', 'Médica',
   '00000000-0000-4000-8150-0000000000d0', '00000000-0000-4000-8150-0000000000e0', '00000000-0000-4000-8150-0000000000a0');

DO $$
DECLARE
  l2 public.leads%ROWTYPE;
  c  public.contatos%ROWTYPE;
BEGIN
  SELECT * INTO l2 FROM public.leads WHERE id = '00000000-0000-4000-8150-000000000102';
  IF l2.contato_id IS DISTINCT FROM '00000000-0000-4000-8150-000000000101' THEN
    RAISE EXCEPTION 'o negócio novo com o mesmo telefone deveria ligar ao contato existente (contato %)', l2.contato_id;
  END IF;
  -- O negócio fica com a pessoa do contato; o contato ganha só o que não tinha
  IF l2.nome <> 'Ana' OR l2.sobrenome IS DISTINCT FROM 'Lima' OR l2.email IS DISTINCT FROM 'ana@teste.invalid'
     OR l2.telefone IS DISTINCT FROM '(11) 90000-1501' THEN
    RAISE EXCEPTION 'o negócio novo deveria ter a pessoa do contato (%, %, %, %)', l2.nome, l2.sobrenome, l2.email, l2.telefone;
  END IF;
  SELECT * INTO c FROM public.contatos WHERE id = '00000000-0000-4000-8150-000000000101';
  IF c.nome <> 'Ana' OR c.profissao IS DISTINCT FROM 'Médica' THEN
    RAISE EXCEPTION 'o contato deveria manter o nome e ganhar a profissão que não tinha (%, %)', c.nome, c.profissao;
  END IF;
  IF (SELECT profissao FROM public.leads WHERE id = '00000000-0000-4000-8150-000000000101') IS DISTINCT FROM 'Médica' THEN
    RAISE EXCEPTION 'o outro negócio do contato deveria receber a profissão nova';
  END IF;
  IF (SELECT count(*) FROM public.contatos WHERE unit_id = '00000000-0000-4000-8150-0000000000a0') <> 1 THEN
    RAISE EXCEPTION 'dois negócios da mesma pessoa deveriam ter um contato só';
  END IF;
  -- Cliente: o 1º é ganho; o 2º aberto não tira
  IF NOT c.cliente THEN
    RAISE EXCEPTION 'o contato com um negócio ganho deveria ser cliente';
  END IF;
END $$;

-- Pessoa alterada num negócio chega ao outro; cliente continua (o ganho existe)
UPDATE public.leads SET email = 'ana.nova@teste.invalid' WHERE id = '00000000-0000-4000-8150-000000000102';
DO $$
BEGIN
  IF (SELECT email FROM public.leads WHERE id = '00000000-0000-4000-8150-000000000101') IS DISTINCT FROM 'ana.nova@teste.invalid'
     OR (SELECT email FROM public.contatos WHERE id = '00000000-0000-4000-8150-000000000101') IS DISTINCT FROM 'ana.nova@teste.invalid' THEN
    RAISE EXCEPTION 'e-mail alterado num negócio deveria chegar ao contato e ao outro negócio';
  END IF;
  IF NOT (SELECT cliente FROM public.contatos WHERE id = '00000000-0000-4000-8150-000000000101') THEN
    RAISE EXCEPTION 'alterar o negócio aberto não deveria tirar o cliente (o outro é ganho)';
  END IF;
END $$;

-- Transferir um negócio de contato com outros negócios é recusado
DO $$
BEGIN
  BEGIN
    UPDATE public.leads SET unit_id = '00000000-0000-4000-8150-0000000000b0',
                            funnel_id = '00000000-0000-4000-8150-0000000000d1', stage_id = '00000000-0000-4000-8150-0000000000e1'
     WHERE id = '00000000-0000-4000-8150-000000000102';
    RAISE EXCEPTION 'transferir um de dois negócios do contato deveria ser recusado';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;
END $$;

-- Conversa nova do telefone liga ao negócio aberto, não ao ganho mais antigo
INSERT INTO public.wa_conversations (id, unit_id, wa_phone) VALUES
  ('00000000-0000-4000-8150-000000000301', '00000000-0000-4000-8150-0000000000a0', '5511900001501');
DO $$
BEGIN
  IF (SELECT lead_id FROM public.wa_conversations WHERE id = '00000000-0000-4000-8150-000000000301')
     IS DISTINCT FROM '00000000-0000-4000-8150-000000000102' THEN
    RAISE EXCEPTION 'a conversa nova deveria ligar ao negócio aberto';
  END IF;
  IF (SELECT contato_id FROM public.wa_conversations WHERE id = '00000000-0000-4000-8150-000000000301')
     IS DISTINCT FROM '00000000-0000-4000-8150-000000000101' THEN
    RAISE EXCEPTION 'a conversa deveria ter o contato';
  END IF;
END $$;

-- Negócio com contato_id informado: de outra unidade é recusado
DO $$
BEGIN
  BEGIN
    INSERT INTO public.leads (nome, contato_id, funnel_id, stage_id, unit_id) VALUES
      ('x', '00000000-0000-4000-8150-000000000101', '00000000-0000-4000-8150-0000000000d1',
       '00000000-0000-4000-8150-0000000000e1', '00000000-0000-4000-8150-0000000000b0');
    RAISE EXCEPTION 'negócio de uma unidade com contato de outra deveria ser recusado';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;
END $$;

-- Apagar o negócio ganho: o contato fica (tem o outro) e deixa de ser cliente
DELETE FROM public.leads WHERE id = '00000000-0000-4000-8150-000000000101';
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.contatos WHERE id = '00000000-0000-4000-8150-000000000101') THEN
    RAISE EXCEPTION 'o contato com outro negócio não deveria ser apagado';
  END IF;
  IF (SELECT cliente FROM public.contatos WHERE id = '00000000-0000-4000-8150-000000000101') THEN
    RAISE EXCEPTION 'sem negócio convertido, o contato deixa de ser cliente';
  END IF;
  -- Com um negócio só, transferir volta a ser possível (e leva o contato)
  UPDATE public.leads SET unit_id = '00000000-0000-4000-8150-0000000000b0',
                          funnel_id = '00000000-0000-4000-8150-0000000000d1', stage_id = '00000000-0000-4000-8150-0000000000e1'
   WHERE id = '00000000-0000-4000-8150-000000000102';
  IF (SELECT unit_id FROM public.contatos WHERE id = '00000000-0000-4000-8150-000000000101') <> '00000000-0000-4000-8150-0000000000b0' THEN
    RAISE EXCEPTION 'o contato deveria seguir o único negócio para a outra unidade';
  END IF;
  IF to_regclass('public.uq_leads_unit_telefone_norm') IS NOT NULL THEN
    RAISE EXCEPTION 'o índice único de telefone em leads deveria ter saído';
  END IF;
  IF has_function_privilege('authenticated', 'public.fn_lead_contato()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.fn_lead_contato_espelho()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.fn_lead_contato_apaga()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.auto_link_wa_conversation()', 'EXECUTE') THEN
    RAISE EXCEPTION 'as funções da 150 são só do banco';
  END IF;
END $$;
