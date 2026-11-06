-- Grupos (145): conversa de grupo só em QR Code, sem vínculo automático com lead,
-- autor da mensagem; limite por minuto só no QR Code.

INSERT INTO public.tenants (id, nome) VALUES ('00000000-0000-4000-8145-0000000000f0', 'Rede 145');
INSERT INTO public.units (id, tenant_id, nome, tipo) VALUES
  ('00000000-0000-4000-8145-0000000000a0', '00000000-0000-4000-8145-0000000000f0', 'Unidade 145', 'clinica');
INSERT INTO public.funnels (id, nome, unit_id) VALUES
  ('00000000-0000-4000-8145-0000000000d0', 'Funil 145', '00000000-0000-4000-8145-0000000000a0');
INSERT INTO public.conexoes (id, unit_id, tipo, nome, status) VALUES
  ('00000000-0000-4000-8145-0000000000c1', '00000000-0000-4000-8145-0000000000a0', 'oficial', 'Oficial', 'conectada'),
  ('00000000-0000-4000-8145-0000000000c2', '00000000-0000-4000-8145-0000000000a0', 'qrcode', 'QR', 'conectada');
-- Lead com o mesmo "telefone" que o id do grupo: não pode ser ligado ao grupo
INSERT INTO public.leads (id, nome, telefone, funnel_id, unit_id) VALUES
  ('00000000-0000-4000-8145-0000000000e1', 'Homônimo', '+120363000000145', '00000000-0000-4000-8145-0000000000d0', '00000000-0000-4000-8145-0000000000a0'),
  ('00000000-0000-4000-8145-0000000000e2', 'Cliente', '(11) 90000-0145', '00000000-0000-4000-8145-0000000000d0', '00000000-0000-4000-8145-0000000000a0');

INSERT INTO public.wa_conversations (id, unit_id, conexao_id, wa_phone, tipo, wa_contact_name) VALUES
  ('00000000-0000-4000-8145-000000000201', '00000000-0000-4000-8145-0000000000a0', '00000000-0000-4000-8145-0000000000c2',
   '120363000000145', 'grupo', 'Licenciados Itu'),
  ('00000000-0000-4000-8145-000000000202', '00000000-0000-4000-8145-0000000000a0', '00000000-0000-4000-8145-0000000000c2',
   '5511900000145', 'individual', NULL);
INSERT INTO public.wa_messages (conversation_id, unit_id, direction, content, autor_telefone, autor_nome) VALUES
  ('00000000-0000-4000-8145-000000000201', '00000000-0000-4000-8145-0000000000a0', 'inbound', 'bom dia', '5511900000777', 'Licenciado');

DO $$
BEGIN
  IF (SELECT lead_id FROM public.wa_conversations WHERE id = '00000000-0000-4000-8145-000000000201') IS NOT NULL THEN
    RAISE EXCEPTION 'conversa de grupo não deveria ser ligada a lead pelo telefone';
  END IF;
  IF (SELECT lead_id FROM public.wa_conversations WHERE id = '00000000-0000-4000-8145-000000000202')
     IS DISTINCT FROM '00000000-0000-4000-8145-0000000000e2' THEN
    RAISE EXCEPTION 'conversa individual continua ligada ao lead pelo telefone';
  END IF;
  IF (SELECT tipo FROM public.wa_conversations WHERE id = '00000000-0000-4000-8145-000000000202') <> 'individual' THEN
    RAISE EXCEPTION 'tipo padrão é individual';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.wa_messages WHERE autor_nome = 'Licenciado' AND autor_telefone = '5511900000777') THEN
    RAISE EXCEPTION 'mensagem de grupo guarda o autor';
  END IF;
  BEGIN
    INSERT INTO public.wa_conversations (unit_id, conexao_id, wa_phone, tipo) VALUES
      ('00000000-0000-4000-8145-0000000000a0', '00000000-0000-4000-8145-0000000000c1', '120363000000999', 'grupo');
    RAISE EXCEPTION 'grupo na conexão oficial deveria ser recusado';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    UPDATE public.wa_conversations SET tipo = 'outro' WHERE id = '00000000-0000-4000-8145-000000000202';
    RAISE EXCEPTION 'tipo fora da lista deveria ser recusado';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END $$;

-- Limite por minuto: nulo na oficial, 20 por padrão no QR Code
DO $$
BEGIN
  IF (SELECT limite_por_minuto FROM public.conexoes WHERE id = '00000000-0000-4000-8145-0000000000c1') IS NOT NULL THEN
    RAISE EXCEPTION 'conexão oficial não tem limite por minuto';
  END IF;
  IF (SELECT limite_por_minuto FROM public.conexoes WHERE id = '00000000-0000-4000-8145-0000000000c2') <> 20 THEN
    RAISE EXCEPTION 'QR Code criado sem limite ganha 20';
  END IF;
  IF EXISTS (SELECT 1 FROM public.conexoes WHERE tipo = 'oficial' AND limite_por_minuto IS NOT NULL) THEN
    RAISE EXCEPTION 'a 145 deveria limpar o limite das oficiais';
  END IF;
  BEGIN
    UPDATE public.conexoes SET limite_por_minuto = 10 WHERE id = '00000000-0000-4000-8145-0000000000c1';
    RAISE EXCEPTION 'limite na conexão oficial deveria ser recusado';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  IF public.reservar_envio_conexao('00000000-0000-4000-8145-0000000000c1') THEN
    RAISE EXCEPTION 'conexão oficial não passa pela reserva do QR Code';
  END IF;
  IF NOT public.reservar_envio_conexao('00000000-0000-4000-8145-0000000000c2') THEN
    RAISE EXCEPTION 'QR Code com limite tem vaga';
  END IF;
END $$;
