-- Unidades sem cor, como antes da 139; 220_cor_da_unidade.test.sql confere o
-- preenchimento. Dados fictícios, prefixo 8139.

INSERT INTO public.tenants (id, nome) VALUES ('00000000-0000-4000-8139-0000000000f0', 'Rede 139');
INSERT INTO public.units (id, tenant_id, nome, tipo, criado_em) VALUES
  ('00000000-0000-4000-8139-0000000000a0', '00000000-0000-4000-8139-0000000000f0', 'Unidade 139 A', 'clinica', '2026-01-01'),
  ('00000000-0000-4000-8139-0000000000b0', '00000000-0000-4000-8139-0000000000f0', 'Unidade 139 B', 'clinica', '2026-01-02'),
  ('00000000-0000-4000-8139-0000000000c0', '00000000-0000-4000-8139-0000000000f0', 'Unidade 139 C', 'clinica', '2026-01-03');
