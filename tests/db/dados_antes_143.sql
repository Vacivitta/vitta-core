-- Antes da 143: unidade A com wa_config e conversas; unidade C com conversa e
-- sem wa_config. 250_conexoes.test.sql confere o backfill. Dados fictícios,
-- prefixo 8143.

INSERT INTO public.tenants (id, nome) VALUES ('00000000-0000-4000-8143-0000000000f0', 'Rede 143');
INSERT INTO public.units (id, tenant_id, nome, tipo) VALUES
  ('00000000-0000-4000-8143-0000000000a0', '00000000-0000-4000-8143-0000000000f0', 'Unidade 143 A', 'clinica'),
  ('00000000-0000-4000-8143-0000000000c0', '00000000-0000-4000-8143-0000000000f0', 'Unidade 143 C', 'clinica');

INSERT INTO public.wa_config (id, unit_id, phone_number_id, access_token, display_phone, is_active) VALUES
  ('00000000-0000-4000-8143-0000000000e0', '00000000-0000-4000-8143-0000000000a0', '1430000000', 'token-ficticio', '+55 11 4000-0143', true);

INSERT INTO public.wa_conversations (id, unit_id, wa_phone) VALUES
  ('00000000-0000-4000-8143-000000000101', '00000000-0000-4000-8143-0000000000a0', '5511900000101'),
  ('00000000-0000-4000-8143-000000000102', '00000000-0000-4000-8143-0000000000a0', '5511900000102'),
  ('00000000-0000-4000-8143-000000000103', '00000000-0000-4000-8143-0000000000c0', '5511900000103');
