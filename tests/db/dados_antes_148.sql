-- Antes da 148: lead com dados de pessoa, dependente e conversa ligada.
-- 300_contatos.test.sql confere o backfill. Dados fictícios, prefixo 8148.

INSERT INTO public.tenants (id, nome) VALUES ('00000000-0000-4000-8148-0000000000f0', 'Rede 148');
INSERT INTO public.units (id, tenant_id, nome, tipo) VALUES
  ('00000000-0000-4000-8148-0000000000a0', '00000000-0000-4000-8148-0000000000f0', 'Unidade 148 A', 'clinica'),
  ('00000000-0000-4000-8148-0000000000b0', '00000000-0000-4000-8148-0000000000f0', 'Unidade 148 B', 'clinica');
INSERT INTO public.funnels (id, nome, unit_id) VALUES
  ('00000000-0000-4000-8148-0000000000d0', 'Funil 148 A', '00000000-0000-4000-8148-0000000000a0'),
  ('00000000-0000-4000-8148-0000000000d1', 'Funil 148 B', '00000000-0000-4000-8148-0000000000b0');

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('00000000-0000-4000-8148-000000000001', 'membro148@teste.invalid', '{"full_name": "Membro"}'),
  ('00000000-0000-4000-8148-000000000002', 'outro148@teste.invalid', '{"full_name": "Outro"}');
INSERT INTO public.user_units (user_id, unit_id) VALUES
  ('00000000-0000-4000-8148-000000000001', '00000000-0000-4000-8148-0000000000a0'),
  ('00000000-0000-4000-8148-000000000002', '00000000-0000-4000-8148-0000000000b0');

INSERT INTO public.leads (id, nome, sobrenome, telefone, email, observacoes_cli, is_converted, wa_optout_at, funnel_id, unit_id) VALUES
  ('00000000-0000-4000-8148-000000000101', 'Ana', 'Antiga', '(11) 90000-1481', 'ana@teste.invalid', 'gosta de manhã', true,
   '2026-10-01', '00000000-0000-4000-8148-0000000000d0', '00000000-0000-4000-8148-0000000000a0');
INSERT INTO public.lead_contacts (id, lead_id, nome, relacao, unit_id) VALUES
  ('00000000-0000-4000-8148-000000000201', '00000000-0000-4000-8148-000000000101', 'Filha da Ana', 'filha', '00000000-0000-4000-8148-0000000000a0');
INSERT INTO public.wa_conversations (id, unit_id, wa_phone, lead_id) VALUES
  ('00000000-0000-4000-8148-000000000301', '00000000-0000-4000-8148-0000000000a0', '5511900001481',
   '00000000-0000-4000-8148-000000000101');
