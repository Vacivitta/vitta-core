-- Leads perdidos como ficavam antes da 131 (fora da etapa de perda do funil).
-- O run.sh aplica este arquivo logo antes da 131, que move estes dados de verdade;
-- 140_perdido_etapa.test.sql confere o resultado. Dados fictícios, prefixo 8131.

INSERT INTO public.tenants (id, nome) VALUES ('00000000-0000-4000-8131-0000000000f0', 'Rede 131');
INSERT INTO public.units (id, tenant_id, nome, tipo) VALUES
  ('00000000-0000-4000-8131-0000000000a0', '00000000-0000-4000-8131-0000000000f0', 'Clínica 131', 'clinica');

-- d0: funil com etapa de perda; e0: funil sem etapa de perda
INSERT INTO public.funnels (id, nome, unit_id) VALUES
  ('00000000-0000-4000-8131-0000000000d0', 'Funil com perda', '00000000-0000-4000-8131-0000000000a0'),
  ('00000000-0000-4000-8131-0000000000e0', 'Funil sem perda', '00000000-0000-4000-8131-0000000000a0');
INSERT INTO public.funnel_stages (id, funnel_id, nome, ordem, resultado, unit_id) VALUES
  ('00000000-0000-4000-8131-0000000000d1', '00000000-0000-4000-8131-0000000000d0', 'Novo',       0, NULL,      '00000000-0000-4000-8131-0000000000a0'),
  ('00000000-0000-4000-8131-0000000000d2', '00000000-0000-4000-8131-0000000000d0', 'Negociação', 1, NULL,      '00000000-0000-4000-8131-0000000000a0'),
  ('00000000-0000-4000-8131-0000000000d3', '00000000-0000-4000-8131-0000000000d0', 'Perdido',    2, 'perdido', '00000000-0000-4000-8131-0000000000a0'),
  ('00000000-0000-4000-8131-0000000000d4', '00000000-0000-4000-8131-0000000000d0', 'Fechado',    3, 'ganho',   '00000000-0000-4000-8131-0000000000a0'),
  ('00000000-0000-4000-8131-0000000000e1', '00000000-0000-4000-8131-0000000000e0', 'Novo',       0, NULL,      '00000000-0000-4000-8131-0000000000a0');

CREATE FUNCTION pg_temp.lead_131(n int, funil char, etapa char, status text, motivo text, perdido_em timestamptz,
                                 stage_changed_at timestamptz)
RETURNS void LANGUAGE sql AS $$
  INSERT INTO public.leads (id, nome, funnel_id, stage_id, unit_id, status, motivo_perda_id, motivo_perda,
                            perdido_em, stage_changed_at)
  VALUES (('00000000-0000-4000-8131-' || lpad(n::text, 12, '0'))::uuid, 'Lead 131 ' || n,
          ('00000000-0000-4000-8131-0000000000' || funil || '0')::uuid,
          CASE WHEN etapa IS NULL THEN NULL ELSE ('00000000-0000-4000-8131-0000000000' || funil || etapa)::uuid END,
          '00000000-0000-4000-8131-0000000000a0', status,
          CASE WHEN motivo IS NULL THEN NULL
               ELSE (SELECT m.id FROM public.motivos_perda m
                      WHERE m.funnel_id = ('00000000-0000-4000-8131-0000000000' || funil || '0')::uuid AND m.nome = motivo) END,
          CASE WHEN motivo IS NULL AND status = 'perdido' THEN 'Arquivado sem motivo da lista' END,
          perdido_em, stage_changed_at)
$$;

-- Perdido (arquivado) em etapa sem resultado de um funil com etapa de perda: vai para ela
SELECT pg_temp.lead_131(201, 'd', '2', 'perdido', 'Timing ruim', '2026-03-10 12:00:00+00', '2026-02-01 12:00:00+00');
-- Perdido sem etapa, funil com etapa de perda: vai para ela (histórico de = NULL)
SELECT pg_temp.lead_131(202, 'd', NULL, 'perdido', NULL, '2026-03-11 12:00:00+00', '2026-01-01 12:00:00+00');
-- Perdido que mudou de etapa depois da perda: o histórico fica depois da última mudança
SELECT pg_temp.lead_131(203, 'd', '1', 'perdido', 'Sem contato', '2026-03-12 12:00:00+00', '2026-04-01 12:00:00+00');
-- Perdido já na etapa de perda: não mexe
SELECT pg_temp.lead_131(204, 'd', '3', 'perdido', 'Outro', '2026-03-13 12:00:00+00', '2026-03-13 12:00:00+00');
-- Perdido num funil sem etapa de perda: não mexe (fica só no painel Perdidos)
SELECT pg_temp.lead_131(205, 'e', '1', 'perdido', 'Sem interesse', '2026-03-14 12:00:00+00', '2026-02-01 12:00:00+00');
-- Aberto: não mexe
SELECT pg_temp.lead_131(206, 'd', '1', 'aberto', NULL, NULL, '2026-02-01 12:00:00+00');
