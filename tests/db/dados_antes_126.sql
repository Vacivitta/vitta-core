-- Leads nos estados de antes da 126 (arquivado comum, is_converted, etapa "Perdido").
-- O run.sh aplica este arquivo logo antes da 126, que migra estes dados de verdade;
-- 090_status.test.sql confere o resultado. Dados fictícios, prefixo 8126.

INSERT INTO public.tenants (id, nome) VALUES ('00000000-0000-4000-8126-0000000000f0', 'Rede 126');
INSERT INTO public.units (id, tenant_id, nome, tipo) VALUES
  ('00000000-0000-4000-8126-0000000000a0', '00000000-0000-4000-8126-0000000000f0', 'Clínica 126', 'clinica'),
  ('00000000-0000-4000-8126-0000000000b0', '00000000-0000-4000-8126-0000000000f0', 'Comercial 126', 'comercial');

INSERT INTO public.funnels (id, nome, unit_id) VALUES
  ('00000000-0000-4000-8126-0000000000d0', 'Funil Clínica', '00000000-0000-4000-8126-0000000000a0'),
  ('00000000-0000-4000-8126-0000000000e0', 'Funil Licenças', '00000000-0000-4000-8126-0000000000b0');
INSERT INTO public.funnel_stages (id, funnel_id, nome, ordem, unit_id) VALUES
  ('00000000-0000-4000-8126-0000000000d1', '00000000-0000-4000-8126-0000000000d0', 'Novo',        0, '00000000-0000-4000-8126-0000000000a0'),
  ('00000000-0000-4000-8126-0000000000d2', '00000000-0000-4000-8126-0000000000d0', 'Finalizados', 1, '00000000-0000-4000-8126-0000000000a0'),
  ('00000000-0000-4000-8126-0000000000d3', '00000000-0000-4000-8126-0000000000d0', ' perdido ',   2, '00000000-0000-4000-8126-0000000000a0'),
  ('00000000-0000-4000-8126-0000000000e1', '00000000-0000-4000-8126-0000000000e0', 'Novo',        0, '00000000-0000-4000-8126-0000000000b0'),
  ('00000000-0000-4000-8126-0000000000e2', '00000000-0000-4000-8126-0000000000e0', 'Contrato assinado', 1, '00000000-0000-4000-8126-0000000000b0');

CREATE FUNCTION pg_temp.lead_126(n int, funil char, etapa char, arquivado boolean, motivo text, convertido boolean)
RETURNS void LANGUAGE sql AS $$
  INSERT INTO public.leads (id, nome, funnel_id, stage_id, unit_id, arquivado, motivo_perda, is_converted,
                            updated_at, stage_changed_at)
  VALUES (('00000000-0000-4000-8126-' || lpad(n::text, 12, '0'))::uuid, 'Lead 126 ' || n,
          CASE funil WHEN 'C' THEN '00000000-0000-4000-8126-0000000000d0'::uuid ELSE '00000000-0000-4000-8126-0000000000e0'::uuid END,
          ('00000000-0000-4000-8126-0000000000' || lower(CASE funil WHEN 'C' THEN 'd' ELSE 'e' END) || etapa)::uuid,
          CASE funil WHEN 'C' THEN '00000000-0000-4000-8126-0000000000a0'::uuid ELSE '00000000-0000-4000-8126-0000000000b0'::uuid END,
          arquivado, motivo, convertido, '2026-01-10 12:00:00+00', '2026-02-20 12:00:00+00')
$$;

SELECT pg_temp.lead_126(101, 'C', '1', true,  'Sem orçamento', false);
SELECT pg_temp.lead_126(102, 'C', '1', true,  'Outro: spam do fornecedor', false);
SELECT pg_temp.lead_126(103, 'C', '1', true,  'Orçamento recusado: caro', false);
SELECT pg_temp.lead_126(104, 'C', '1', true,  'sem interesse ', true);
SELECT pg_temp.lead_126(105, 'C', '3', false, NULL, false);
SELECT pg_temp.lead_126(106, 'C', '1', false, NULL, true);
SELECT pg_temp.lead_126(107, 'C', '2', false, NULL, false);
SELECT pg_temp.lead_126(108, 'E', '2', false, NULL, false);
SELECT pg_temp.lead_126(109, 'E', '1', true,  'Sem capital', false);
SELECT pg_temp.lead_126(110, 'C', '3', false, NULL, true);
SELECT pg_temp.lead_126(111, 'C', '1', false, NULL, false);
