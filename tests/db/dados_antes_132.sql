-- Leads perdidos como ficaram depois da 131 (arquivado ainda gerado por status).
-- O run.sh aplica este arquivo logo antes da 132, que arquiva de verdade os
-- antigos arquivados; 150_arquivar.test.sql confere. Dados fictícios, prefixo 8132.
-- A 126 entrou em 2026-11-05 ~11:48:45 UTC: perdido_em antes disso = perdido
-- (arquivado) antes da 126.

INSERT INTO public.tenants (id, nome) VALUES ('00000000-0000-4000-8132-0000000000f0', 'Rede 132');
INSERT INTO public.units (id, tenant_id, nome, tipo) VALUES
  ('00000000-0000-4000-8132-0000000000a0', '00000000-0000-4000-8132-0000000000f0', 'Clínica 132', 'clinica');

-- d0: funil com etapa de perda; e0: funil sem etapa de perda
INSERT INTO public.funnels (id, nome, unit_id) VALUES
  ('00000000-0000-4000-8132-0000000000d0', 'Funil com perda', '00000000-0000-4000-8132-0000000000a0'),
  ('00000000-0000-4000-8132-0000000000e0', 'Funil sem perda', '00000000-0000-4000-8132-0000000000a0');
INSERT INTO public.funnel_stages (id, funnel_id, nome, ordem, resultado, unit_id) VALUES
  ('00000000-0000-4000-8132-0000000000d1', '00000000-0000-4000-8132-0000000000d0', 'Novo',    0, NULL,      '00000000-0000-4000-8132-0000000000a0'),
  ('00000000-0000-4000-8132-0000000000d2', '00000000-0000-4000-8132-0000000000d0', 'Perdido', 1, 'perdido', '00000000-0000-4000-8132-0000000000a0'),
  ('00000000-0000-4000-8132-0000000000e1', '00000000-0000-4000-8132-0000000000e0', 'Novo',    0, NULL,      '00000000-0000-4000-8132-0000000000a0');

CREATE FUNCTION pg_temp.lead_132(n int, funil char, etapa char, status text, motivo text, detalhe text,
                                 perdido_em timestamptz, movido_pela_131 boolean)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  id_lead uuid := ('00000000-0000-4000-8132-' || lpad(n::text, 12, '0'))::uuid;
  funil_id uuid := ('00000000-0000-4000-8132-0000000000' || funil || '0')::uuid;
  etapa_id uuid := ('00000000-0000-4000-8132-0000000000' || funil || etapa)::uuid;
BEGIN
  INSERT INTO public.leads (id, nome, funnel_id, stage_id, unit_id, status, motivo_perda_id, motivo_perda, perdido_em)
  VALUES (id_lead, 'Lead 132 ' || n, funil_id, etapa_id, '00000000-0000-4000-8132-0000000000a0', status,
          (SELECT m.id FROM public.motivos_perda m WHERE m.funnel_id = funil_id AND m.nome = motivo),
          detalhe, perdido_em);
  IF movido_pela_131 THEN
    -- Como a 131 grava: de = etapa anterior, movido_via 'perdido', movido_por NULL, na data da perda
    INSERT INTO public.lead_stage_history (lead_id, de_stage_id, para_stage_id, movido_por, movido_via, criado_em)
    VALUES (id_lead, '00000000-0000-4000-8132-0000000000d1', etapa_id, NULL, 'perdido', perdido_em);
  END IF;
END $$;

-- Arquivado antes da 126, levado pela 131 para a etapa de perda: volta a ser arquivado
SELECT pg_temp.lead_132(401, 'd', '2', 'perdido', 'Sem interesse', 'spam', '2026-06-01 10:00:00+00', true);
-- Arquivado antes da 126 com texto livre (sem motivo da lista): motivo = o texto
SELECT pg_temp.lead_132(402, 'd', '2', 'perdido', NULL, 'Fornecedor de seringas', '2026-07-01 10:00:00+00', true);
-- Perdido depois da 126, levado pela 131 (app antigo não movia): só perdido
SELECT pg_temp.lead_132(403, 'd', '2', 'perdido', 'Timing ruim', NULL, '2026-11-05 13:00:00+00', true);
-- Perdido antes da 126 porque estava na etapa "Perdido" (sem histórico da 131): só perdido
SELECT pg_temp.lead_132(404, 'd', '2', 'perdido', 'Outro', 'Estava na etapa Perdido', '2026-05-01 10:00:00+00', false);
-- Arquivado antes da 126 num funil sem etapa de perda (a 131 não moveu): volta a ser arquivado
SELECT pg_temp.lead_132(405, 'e', '1', 'perdido', 'Sem contato', NULL, '2026-08-01 10:00:00+00', false);
-- Perdido depois da 126 num funil sem etapa de perda: só perdido (passa a aparecer no quadro)
SELECT pg_temp.lead_132(406, 'e', '1', 'perdido', 'Sem orçamento', NULL, '2026-11-05 12:30:00+00', false);
-- Aberto: não mexe
SELECT pg_temp.lead_132(407, 'd', '1', 'aberto', NULL, NULL, NULL, false);
