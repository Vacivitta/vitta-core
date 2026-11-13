-- Dados fictícios do ambiente de teste. Os usuários são criados antes pelo
-- remoto.sh (API de admin do GoTrue); os ids chegam como variáveis do psql.
-- Só colunas que existem desde a 135, para servir a qualquer branch da Fase 3.
-- Conexões sem token: enviar pelo WhatsApp falha antes de chamar a Meta.

CREATE FUNCTION pg_temp.id(n int) RETURNS uuid LANGUAGE sql AS $$
  SELECT ('00000000-0000-4000-9000-' || lpad(n::text, 12, '0'))::uuid
$$;

INSERT INTO public.tenants (id, nome) VALUES ('00000000-0000-4000-9000-0000000000f0', 'Rede de teste');
INSERT INTO public.units (id, tenant_id, nome, tipo, cidade, estado) VALUES
  ('00000000-0000-4000-9000-0000000000a1', '00000000-0000-4000-9000-0000000000f0', 'Itu (teste)',       'clinica',   'Itu',   'SP'),
  ('00000000-0000-4000-9000-0000000000a2', '00000000-0000-4000-9000-0000000000f0', 'Salto (teste)',     'clinica',   'Salto', 'SP'),
  ('00000000-0000-4000-9000-0000000000a3', '00000000-0000-4000-9000-0000000000f0', 'Comercial (teste)', 'comercial', NULL,    NULL);

UPDATE public.profiles SET unit_id = '00000000-0000-4000-9000-0000000000a1',
  perfil = CASE id WHEN :'gestor'::uuid THEN 'gestor_unidade' WHEN :'admin'::uuid THEN 'admin' ELSE 'atendente' END
 WHERE id IN (:'multi', :'itu', :'gestor', :'admin');

INSERT INTO public.user_units (user_id, unit_id) VALUES
  (:'multi',  '00000000-0000-4000-9000-0000000000a1'),
  (:'multi',  '00000000-0000-4000-9000-0000000000a2'),
  (:'itu',    '00000000-0000-4000-9000-0000000000a1'),
  (:'gestor', '00000000-0000-4000-9000-0000000000a1');

-- Um funil por unidade: Novo, Em atendimento, Orçamento, Ganho, Perdido
INSERT INTO public.funnels (id, nome, unit_id, ordem)
SELECT pg_temp.id(100 + u), 'Vacinas', ('00000000-0000-4000-9000-0000000000a' || u)::uuid, 0
  FROM generate_series(1, 3) u;
INSERT INTO public.funnel_stages (id, funnel_id, nome, ordem, resultado, unit_id)
SELECT pg_temp.id(1000 + u * 10 + e.ordem),
       pg_temp.id(100 + u), e.nome, e.ordem, e.resultado,
       ('00000000-0000-4000-9000-0000000000a' || u)::uuid
  FROM generate_series(1, 3) u
 CROSS JOIN (VALUES (0, 'Novo', NULL), (1, 'Em atendimento', NULL), (2, 'Orçamento', NULL),
                    (3, 'Ganho', 'ganho'), (4, 'Perdido', 'perdido')) AS e (ordem, nome, resultado);

-- Leads e conversas: 3 em Itu, 3 em Salto
INSERT INTO public.leads (id, nome, sobrenome, telefone, funnel_id, stage_id, unit_id, origem)
SELECT pg_temp.id(2000 + u * 10 + l),
       (ARRAY['Joana', 'Marcos', 'Lívia', 'Rafael', 'Clara', 'Tiago'])[(u - 1) * 3 + l],
       'Teste', '5511900000' || u || l,
       pg_temp.id(100 + u),
       pg_temp.id(1000 + u * 10 + l - 1),
       ('00000000-0000-4000-9000-0000000000a' || u)::uuid, 'Teste'
  FROM generate_series(1, 2) u CROSS JOIN generate_series(1, 3) l;

INSERT INTO public.wa_conversations (id, unit_id, wa_phone, wa_contact_name, lead_id, status, unread_count,
                                     last_message_at, last_message_content, last_message_direction)
SELECT pg_temp.id(3000 + u * 10 + l), ('00000000-0000-4000-9000-0000000000a' || u)::uuid,
       '5511900000' || u || l, (ARRAY['Joana', 'Marcos', 'Lívia', 'Rafael', 'Clara', 'Tiago'])[(u - 1) * 3 + l],
       pg_temp.id(2000 + u * 10 + l), 'open', CASE WHEN l = 1 THEN 2 ELSE 0 END,
       now() - ((u * 3 + l) || ' minutes')::interval,
       CASE WHEN l = 1 THEN 'Qual o valor da vacina da gripe?' ELSE 'Obrigada!' END,
       CASE WHEN l = 1 THEN 'inbound' ELSE 'outbound' END
  FROM generate_series(1, 2) u CROSS JOIN generate_series(1, 3) l;

INSERT INTO public.wa_messages (conversation_id, unit_id, direction, type, content, status, created_at)
SELECT c.id, c.unit_id, m.direcao, 'text', m.texto, CASE WHEN m.direcao = 'outbound' THEN 'read' ELSE 'received' END,
       c.last_message_at - (m.ordem || ' minutes')::interval
  FROM public.wa_conversations c
 CROSS JOIN (VALUES (3, 'inbound', 'Oi, bom dia!'), (2, 'outbound', 'Bom dia! Como posso ajudar?'),
                    (0, 'inbound', 'Qual o valor da vacina da gripe?')) AS m (ordem, direcao, texto)
 WHERE c.unit_id IN ('00000000-0000-4000-9000-0000000000a1', '00000000-0000-4000-9000-0000000000a2');

INSERT INTO public.wa_config (unit_id, phone_number_id, display_phone, is_active) VALUES
  ('00000000-0000-4000-9000-0000000000a1', 'teste-itu',   '+55 11 4000-0001', true),
  ('00000000-0000-4000-9000-0000000000a2', 'teste-salto', '+55 11 4000-0002', true);

INSERT INTO public.wa_queues (unit_id, nome, cor) VALUES
  ('00000000-0000-4000-9000-0000000000a1', 'Recepção Itu', '#3E9849'),
  ('00000000-0000-4000-9000-0000000000a2', 'Recepção Salto', '#2563EB');
INSERT INTO public.wa_message_templates (unit_id, name, content, category) VALUES
  ('00000000-0000-4000-9000-0000000000a1', 'Boas-vindas Itu', 'Olá! Aqui é a Vacivitta Itu.', 'custom'),
  ('00000000-0000-4000-9000-0000000000a2', 'Boas-vindas Salto', 'Olá! Aqui é a Vacivitta Salto.', 'custom');
INSERT INTO public.wa_quick_replies (unit_id, shortcut, content) VALUES
  ('00000000-0000-4000-9000-0000000000a1', '/endereco', 'Rua de Teste, 1 - Itu'),
  ('00000000-0000-4000-9000-0000000000a2', '/endereco', 'Rua de Teste, 2 - Salto');

-- Notificações: pessoal de Ana em Salto, pessoal de Bia em Itu (Ana não pode ver),
-- aviso da unidade Itu (todos de Itu veem)
INSERT INTO public.notifications (unit_id, user_id, type, title, body, lead_id) VALUES
  ('00000000-0000-4000-9000-0000000000a2', :'multi', 'mention_note', 'Rafael Teste: você foi mencionada', 'Pode ligar para a família?',
   pg_temp.id(2021)),
  ('00000000-0000-4000-9000-0000000000a1', :'itu', 'mention_note', 'Joana Teste: menção só para Bia', 'Nota interna de Itu',
   pg_temp.id(2011)),
  ('00000000-0000-4000-9000-0000000000a1', NULL, 'lead_transfer', 'Lead transferido para Itu', 'Marcos Teste veio de Salto',
   pg_temp.id(2012));
