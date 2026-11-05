-- Notificações como ficaram antes da 136: `lida` única por notificação.
-- O run.sh aplica este arquivo logo antes da 136, que passa a leitura para
-- notification_reads (por pessoa); 190_notificacoes.test.sql confere.
-- Dados fictícios, prefixo 8136.

INSERT INTO public.tenants (id, nome) VALUES ('00000000-0000-4000-8136-0000000000f0', 'Rede 136');
INSERT INTO public.units (id, tenant_id, nome, tipo) VALUES
  ('00000000-0000-4000-8136-0000000000a0', '00000000-0000-4000-8136-0000000000f0', 'Clínica 136', 'clinica');

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('00000000-0000-4000-8136-000000000001', 'um136@teste.invalid', '{"full_name": "Um 136"}'),
  ('00000000-0000-4000-8136-000000000002', 'dois136@teste.invalid', '{"full_name": "Dois 136"}');

INSERT INTO public.user_units (user_id, unit_id) VALUES
  ('00000000-0000-4000-8136-000000000001', '00000000-0000-4000-8136-0000000000a0'),
  ('00000000-0000-4000-8136-000000000002', '00000000-0000-4000-8136-0000000000a0');

-- 901: pessoal lida; 902: pessoal não lida; 903: da unidade lida; 904: da unidade não lida
INSERT INTO public.notifications (id, unit_id, user_id, type, title, lida) VALUES
  ('00000000-0000-4000-8136-000000000901', '00000000-0000-4000-8136-0000000000a0',
   '00000000-0000-4000-8136-000000000001', 'mention_note', 'pessoal lida', true),
  ('00000000-0000-4000-8136-000000000902', '00000000-0000-4000-8136-0000000000a0',
   '00000000-0000-4000-8136-000000000001', 'mention_note', 'pessoal não lida', false),
  ('00000000-0000-4000-8136-000000000903', '00000000-0000-4000-8136-0000000000a0',
   NULL, 'lead_transfer', 'unidade lida', true),
  ('00000000-0000-4000-8136-000000000904', '00000000-0000-4000-8136-0000000000a0',
   NULL, 'lead_transfer', 'unidade não lida', false);
