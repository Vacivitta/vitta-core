-- leads_kanban com os campos personalizados do lead (migração 134).

CREATE FUNCTION pg_temp.esperar(caso text, obtido text, esperado text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF obtido IS DISTINCT FROM esperado THEN
    RAISE EXCEPTION '%: esperado %, obtido %', caso, esperado, obtido;
  END IF;
END $$;

-- Roda a consulta com o papel e o usuário dados e devolve o primeiro valor (ou
-- 'erro <sqlstate>'; 'nenhum' se não há linha)
CREATE FUNCTION pg_temp.valor_como(papel text, usuario uuid, consulta text) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE
  resultado text;
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', usuario, 'role', papel)::text, true);
  EXECUTE format('SET LOCAL ROLE %I', papel);
  BEGIN
    EXECUTE consulta INTO resultado;
    resultado := coalesce(resultado, 'nenhum');
  EXCEPTION WHEN OTHERS THEN
    resultado := 'erro ' || SQLSTATE;
  END;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '', true);
  RETURN resultado;
END $$;

-- ── Forma da view ────────────────────────────────────────────────────────────
-- Mesmas colunas da 132 (iguais às de leads_arquivados), na mesma ordem, e campos no fim
SELECT pg_temp.esperar('leads_kanban = colunas da 132 + campos no fim',
  (SELECT string_agg(attname, ',' ORDER BY attnum) FROM pg_attribute
    WHERE attrelid = 'public.leads_kanban'::regclass AND attnum > 0 AND NOT attisdropped),
  (SELECT string_agg(attname, ',' ORDER BY attnum) FROM pg_attribute
    WHERE attrelid = 'public.leads_arquivados'::regclass AND attnum > 0 AND NOT attisdropped) || ',campos');
SELECT pg_temp.esperar('campos é jsonb',
  (SELECT format_type(atttypid, atttypmod) FROM pg_attribute
    WHERE attrelid = 'public.leads_kanban'::regclass AND attname = 'campos'), 'jsonb');
SELECT pg_temp.esperar('security_invoker',
  (SELECT ('security_invoker=true' = ANY (reloptions))::text FROM pg_class WHERE oid = 'public.leads_kanban'::regclass),
  'true');
SELECT pg_temp.esperar('privilégios na view (anon nada; authenticated lê)',
  has_table_privilege('anon', 'public.leads_kanban', 'SELECT')::text || ' '
    || has_table_privilege('authenticated', 'public.leads_kanban', 'SELECT')::text,
  'false true');

-- ── Dados ────────────────────────────────────────────────────────────────────
INSERT INTO public.tenants (id, nome) VALUES ('00000000-0000-4000-8134-0000000000f0', 'Rede 134');
INSERT INTO public.units (id, tenant_id, nome, tipo) VALUES
  ('00000000-0000-4000-8134-0000000000a0', '00000000-0000-4000-8134-0000000000f0', 'Unidade 134', 'clinica'),
  ('00000000-0000-4000-8134-0000000000b0', '00000000-0000-4000-8134-0000000000f0', 'Outra 134', 'clinica');
INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('00000000-0000-4000-8134-000000000001', 'kc-atendente@teste.invalid', '{"full_name": "Atendente"}'),
  ('00000000-0000-4000-8134-000000000002', 'kc-outra@teste.invalid', '{"full_name": "Outra"}');
UPDATE public.profiles SET
  unit_id = CASE id WHEN '00000000-0000-4000-8134-000000000002' THEN '00000000-0000-4000-8134-0000000000b0'::uuid
                    ELSE '00000000-0000-4000-8134-0000000000a0'::uuid END,
  perfil  = 'atendente'
 WHERE id::text LIKE '00000000-0000-4000-8134-00000000000_';
INSERT INTO public.user_units (user_id, unit_id) VALUES
  ('00000000-0000-4000-8134-000000000001', '00000000-0000-4000-8134-0000000000a0'),
  ('00000000-0000-4000-8134-000000000002', '00000000-0000-4000-8134-0000000000b0');

INSERT INTO public.funnels (id, nome, unit_id) VALUES
  ('00000000-0000-4000-8134-0000000000d0', 'Vacinas', '00000000-0000-4000-8134-0000000000a0');
INSERT INTO public.funnel_stages (id, funnel_id, nome, ordem, unit_id) VALUES
  ('00000000-0000-4000-8134-0000000000c0', '00000000-0000-4000-8134-0000000000d0', 'Novo', 0,
   '00000000-0000-4000-8134-0000000000a0');
INSERT INTO public.campos_lead (unit_id, rotulo, tipo, opcoes, ordem) VALUES
  ('00000000-0000-4000-8134-0000000000a0', 'Convênio', 'selecao', '["Unimed", "Bradesco"]', 1),
  ('00000000-0000-4000-8134-0000000000a0', 'Vacinas de interesse', 'multipla', '["Gripe", "HPV"]', 2),
  ('00000000-0000-4000-8134-0000000000a0', 'Gestante', 'sim_nao', NULL, 3);

INSERT INTO public.leads (id, nome, funnel_id, stage_id, unit_id, campos) VALUES
  ('00000000-0000-4000-8134-000000000101', 'Com campos', '00000000-0000-4000-8134-0000000000d0',
   '00000000-0000-4000-8134-0000000000c0', '00000000-0000-4000-8134-0000000000a0',
   '{"convenio": "Unimed", "vacinas_de_interesse": ["HPV", "Gripe"], "gestante": false}'),
  ('00000000-0000-4000-8134-000000000102', 'Sem campos', '00000000-0000-4000-8134-0000000000d0',
   '00000000-0000-4000-8134-0000000000c0', '00000000-0000-4000-8134-0000000000a0', DEFAULT),
  ('00000000-0000-4000-8134-000000000103', 'Arquivado', '00000000-0000-4000-8134-0000000000d0',
   '00000000-0000-4000-8134-0000000000c0', '00000000-0000-4000-8134-0000000000a0', '{"gestante": true}');
UPDATE public.leads SET arquivado_em = now(), arquivado_motivo = 'Spam'
 WHERE id = '00000000-0000-4000-8134-000000000103';

-- ── Leitura pelo app (authenticated, RLS da unidade) ─────────────────────────
SELECT pg_temp.esperar('atendente da unidade lê os campos do lead no kanban',
  pg_temp.valor_como('authenticated', '00000000-0000-4000-8134-000000000001', $c$
    SELECT campos::text FROM public.leads_kanban WHERE id = '00000000-0000-4000-8134-000000000101'$c$),
  '{"convenio": "Unimed", "gestante": false, "vacinas_de_interesse": ["HPV", "Gripe"]}');
SELECT pg_temp.esperar('lead sem campos vem com objeto vazio',
  pg_temp.valor_como('authenticated', '00000000-0000-4000-8134-000000000001', $c$
    SELECT campos::text FROM public.leads_kanban WHERE id = '00000000-0000-4000-8134-000000000102'$c$),
  '{}');
SELECT pg_temp.esperar('filtro por campo direto na view (sim/não)',
  pg_temp.valor_como('authenticated', '00000000-0000-4000-8134-000000000001', $c$
    SELECT string_agg(nome, ',') FROM public.leads_kanban
     WHERE unit_id = '00000000-0000-4000-8134-0000000000a0' AND campos @> '{"gestante": false}'$c$),
  'Com campos');
SELECT pg_temp.esperar('arquivado continua fora do kanban',
  pg_temp.valor_como('authenticated', '00000000-0000-4000-8134-000000000001', $c$
    SELECT count(*)::text FROM public.leads_kanban WHERE id = '00000000-0000-4000-8134-000000000103'$c$),
  '0');
SELECT pg_temp.esperar('usuário de outra unidade não vê os leads (nem os campos)',
  pg_temp.valor_como('authenticated', '00000000-0000-4000-8134-000000000002', $c$
    SELECT count(*)::text FROM public.leads_kanban WHERE unit_id = '00000000-0000-4000-8134-0000000000a0'$c$),
  '0');
SELECT pg_temp.esperar('anon não lê leads_kanban',
  pg_temp.valor_como('anon', NULL, $c$SELECT campos::text FROM public.leads_kanban LIMIT 1$c$), 'erro 42501');
