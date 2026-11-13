INSERT INTO public.tenants (id, nome) VALUES ('00000000-0000-4000-8128-0000000000f0', 'Rede 128');
INSERT INTO public.units (id, tenant_id, nome, tipo) VALUES
  ('00000000-0000-4000-8128-0000000000a0', '00000000-0000-4000-8128-0000000000f0', 'Clínica A', 'clinica'),
  ('00000000-0000-4000-8128-0000000000b0', '00000000-0000-4000-8128-0000000000f0', 'Clínica B', 'clinica');

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('00000000-0000-4000-8128-000000000001', 'atendente-a@teste.invalid', '{"full_name": "Atendente A"}'),
  ('00000000-0000-4000-8128-000000000002', 'atendente-b@teste.invalid', '{"full_name": "Atendente B"}'),
  ('00000000-0000-4000-8128-000000000003', 'admin@teste.invalid', '{"full_name": "Admin"}');

UPDATE public.profiles SET
  unit_id = CASE id WHEN '00000000-0000-4000-8128-000000000002' THEN '00000000-0000-4000-8128-0000000000b0'::uuid
                    ELSE '00000000-0000-4000-8128-0000000000a0'::uuid END,
  perfil  = CASE id WHEN '00000000-0000-4000-8128-000000000003' THEN 'admin' ELSE 'atendente' END
 WHERE id::text LIKE '00000000-0000-4000-8128-00000000000_';

INSERT INTO public.user_units (user_id, unit_id) VALUES
  ('00000000-0000-4000-8128-000000000001', '00000000-0000-4000-8128-0000000000a0'),
  ('00000000-0000-4000-8128-000000000002', '00000000-0000-4000-8128-0000000000b0');

INSERT INTO public.funnels (id, nome, unit_id) VALUES
  ('00000000-0000-4000-8128-0000000000d0', 'Funil A', '00000000-0000-4000-8128-0000000000a0');

INSERT INTO public.leads (id, nome, funnel_id, unit_id) VALUES
  ('00000000-0000-4000-8128-000000000101', 'Paciente Um', '00000000-0000-4000-8128-0000000000d0',
   '00000000-0000-4000-8128-0000000000a0'),
  ('00000000-0000-4000-8128-000000000102', 'Paciente Dois', '00000000-0000-4000-8128-0000000000d0',
   '00000000-0000-4000-8128-0000000000a0'),
  ('00000000-0000-4000-8128-000000000103', 'Paciente Três', '00000000-0000-4000-8128-0000000000d0',
   '00000000-0000-4000-8128-0000000000a0');

-- unit_id omitido: vem do lead
INSERT INTO public.lead_anexos (id, lead_id, caminho, nome, mime, tamanho, enviado_por) VALUES
  ('00000000-0000-4000-8128-000000000201', '00000000-0000-4000-8128-000000000101',
   '00000000-0000-4000-8128-0000000000a0/00000000-0000-4000-8128-000000000101/x-carteira.pdf',
   'carteira.pdf', 'application/pdf', 1000, '00000000-0000-4000-8128-000000000001'),
  ('00000000-0000-4000-8128-000000000202', '00000000-0000-4000-8128-000000000101',
   '00000000-0000-4000-8128-0000000000a0/00000000-0000-4000-8128-000000000101/y-pedido.jpg',
   'pedido.jpg', 'image/jpeg', 2000, '00000000-0000-4000-8128-000000000001'),
  ('00000000-0000-4000-8128-000000000203', '00000000-0000-4000-8128-000000000103',
   '00000000-0000-4000-8128-0000000000a0/00000000-0000-4000-8128-000000000103/z-contrato.pdf',
   'contrato.pdf', 'application/pdf', 3000, NULL);

INSERT INTO storage.objects (bucket_id, name)
VALUES ('lead-anexos', '00000000-0000-4000-8128-0000000000a0/00000000-0000-4000-8128-000000000101/x-carteira.pdf');

DO $$
DECLARE b storage.buckets%ROWTYPE;
BEGIN
  SELECT * INTO b FROM storage.buckets WHERE id = 'lead-anexos';
  IF NOT FOUND OR b.public IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'bucket lead-anexos deveria existir e ser privado';
  END IF;
  IF b.file_size_limit IS DISTINCT FROM 20971520 THEN
    RAISE EXCEPTION 'bucket lead-anexos deveria ter limite de 20 MB (obtido %)', b.file_size_limit;
  END IF;
  IF NOT (b.allowed_mime_types @> ARRAY['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']
          AND b.allowed_mime_types <@ ARRAY['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']) THEN
    RAISE EXCEPTION 'tipos do bucket lead-anexos fora do combinado: %', b.allowed_mime_types;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies
              WHERE schemaname = 'storage' AND tablename = 'objects'
                AND coalesce(qual, '') || coalesce(with_check, '') LIKE '%lead-anexos%') THEN
    RAISE EXCEPTION 'nenhuma policy em storage.objects deveria citar lead-anexos';
  END IF;
  IF (SELECT unit_id FROM public.lead_anexos WHERE id = '00000000-0000-4000-8128-000000000201')
     IS DISTINCT FROM '00000000-0000-4000-8128-0000000000a0' THEN
    RAISE EXCEPTION 'unit_id do anexo deveria vir do lead';
  END IF;
END $$;

-- O RAISE com SQLSTATE próprio desfaz a subtransação; a mensagem leva o ROW_COUNT para fora
CREATE FUNCTION pg_temp.linhas_afetadas_como(papel text, usuario uuid, comando text) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE
  linhas bigint;
  resultado text;
BEGIN
  BEGIN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', usuario, 'role', papel)::text, true);
    EXECUTE format('SET LOCAL ROLE %I', papel);
    EXECUTE comando;
    GET DIAGNOSTICS linhas = ROW_COUNT;
    RAISE EXCEPTION USING ERRCODE = 'VCT01', MESSAGE = linhas::text;
  EXCEPTION
    WHEN SQLSTATE 'VCT01' THEN resultado := SQLERRM;
    WHEN OTHERS THEN resultado := 'erro ' || SQLSTATE;
  END;
  RETURN resultado;
END $$;

CREATE TEMP TABLE casos (ordem serial, caso text, papel text, usuario uuid, comando text, esperado text);

INSERT INTO casos (caso, papel, usuario, comando, esperado) VALUES
  ('membro da unidade lê os anexos da unidade', 'authenticated', '00000000-0000-4000-8128-000000000001',
   $c$SELECT * FROM public.lead_anexos$c$, '3'),
  ('membro de outra unidade não lê', 'authenticated', '00000000-0000-4000-8128-000000000002',
   $c$SELECT * FROM public.lead_anexos$c$, '0'),
  ('admin global lê', 'authenticated', '00000000-0000-4000-8128-000000000003',
   $c$SELECT * FROM public.lead_anexos WHERE unit_id = '00000000-0000-4000-8128-0000000000a0'$c$, '3'),
  ('anon não lê', 'anon', NULL,
   $c$SELECT * FROM public.lead_anexos$c$, 'erro 42501'),
  ('membro não insere', 'authenticated', '00000000-0000-4000-8128-000000000001',
   $c$INSERT INTO public.lead_anexos (lead_id, caminho, nome, mime, tamanho)
      VALUES ('00000000-0000-4000-8128-000000000101', 'a/b/c.pdf', 'c.pdf', 'application/pdf', 1)$c$, 'erro 42501'),
  ('membro não apaga', 'authenticated', '00000000-0000-4000-8128-000000000001',
   $c$DELETE FROM public.lead_anexos$c$, 'erro 42501'),
  ('membro não altera', 'authenticated', '00000000-0000-4000-8128-000000000001',
   $c$UPDATE public.lead_anexos SET nome = 'x.pdf'$c$, 'erro 42501'),
  ('admin global também não grava pelo navegador', 'authenticated', '00000000-0000-4000-8128-000000000003',
   $c$DELETE FROM public.lead_anexos$c$, 'erro 42501'),
  ('service_role insere', 'service_role', NULL,
   $c$INSERT INTO public.lead_anexos (lead_id, caminho, nome, mime, tamanho)
      VALUES ('00000000-0000-4000-8128-000000000101', 'a/b/novo.png', 'novo.png', 'image/png', 10)$c$, '1'),
  ('unit_id diferente do lead é recusado', 'service_role', NULL,
   $c$INSERT INTO public.lead_anexos (lead_id, unit_id, caminho, nome, mime, tamanho)
      VALUES ('00000000-0000-4000-8128-000000000101', '00000000-0000-4000-8128-0000000000b0',
              'a/b/outro.pdf', 'outro.pdf', 'application/pdf', 10)$c$, 'erro 23514'),
  ('trocar unit_id do anexo à mão é recusado', 'service_role', NULL,
   $c$UPDATE public.lead_anexos SET unit_id = '00000000-0000-4000-8128-0000000000b0'
       WHERE id = '00000000-0000-4000-8128-000000000201'$c$, 'erro 23514'),
  ('tipo fora da lista é recusado', 'service_role', NULL,
   $c$INSERT INTO public.lead_anexos (lead_id, caminho, nome, mime, tamanho)
      VALUES ('00000000-0000-4000-8128-000000000101', 'a/b/x.exe', 'x.exe', 'application/octet-stream', 10)$c$, 'erro 23514'),
  ('maior que 20 MB é recusado', 'service_role', NULL,
   $c$INSERT INTO public.lead_anexos (lead_id, caminho, nome, mime, tamanho)
      VALUES ('00000000-0000-4000-8128-000000000101', 'a/b/g.pdf', 'g.pdf', 'application/pdf', 20971521)$c$, 'erro 23514'),
  ('caminho repetido é recusado', 'service_role', NULL,
   $c$INSERT INTO public.lead_anexos (lead_id, caminho, nome, mime, tamanho)
      VALUES ('00000000-0000-4000-8128-000000000101',
              '00000000-0000-4000-8128-0000000000a0/00000000-0000-4000-8128-000000000101/x-carteira.pdf',
              'c.pdf', 'application/pdf', 1)$c$, 'erro 23505'),
  -- Sem policy, o RLS de storage.objects esconde o objeto de quem não é service_role
  ('membro não lê o objeto no storage', 'authenticated', '00000000-0000-4000-8128-000000000001',
   $c$SELECT * FROM storage.objects WHERE bucket_id = 'lead-anexos'$c$, '0'),
  ('anon não lê o objeto no storage', 'anon', NULL,
   $c$SELECT * FROM storage.objects WHERE bucket_id = 'lead-anexos'$c$, '0'),
  ('membro não grava no bucket', 'authenticated', '00000000-0000-4000-8128-000000000001',
   $c$INSERT INTO storage.objects (bucket_id, name) VALUES ('lead-anexos', 'a/b/c.pdf')$c$, 'erro 42501'),
  ('membro não apaga no bucket', 'authenticated', '00000000-0000-4000-8128-000000000001',
   $c$DELETE FROM storage.objects WHERE bucket_id = 'lead-anexos'$c$, '0');

DO $$
DECLARE
  c record;
  obtido text;
  divergentes text[] := '{}';
BEGIN
  FOR c IN SELECT * FROM casos ORDER BY ordem LOOP
    obtido := pg_temp.linhas_afetadas_como(c.papel, c.usuario, c.comando);
    IF obtido IS DISTINCT FROM c.esperado THEN
      divergentes := divergentes || format('%s: esperado %s, obtido %s', c.caso, c.esperado, obtido);
    END IF;
  END LOOP;
  IF cardinality(divergentes) > 0 THEN
    RAISE EXCEPTION E'% de % casos divergentes:\n  %', cardinality(divergentes), (SELECT count(*) FROM casos),
      array_to_string(divergentes, E'\n  ');
  END IF;
END $$;

-- Mesclar: os anexos do lead removido passam para o mantido, com o mesmo caminho.
-- 126, 127 e 128 recriam mesclar_leads inteira e a última aplicada é a que vale:
-- a mesma mesclagem tem de consolidar o status (126), mover as tags (127) e os
-- anexos (128). Se a 128 partisse de um corpo antigo, uma dessas partes sumiria.
INSERT INTO public.wa_tags (id, unit_id, name, tipo) VALUES
  ('00000000-0000-4000-8128-000000000301', '00000000-0000-4000-8128-0000000000a0', 'VIP', 'lead'),
  ('00000000-0000-4000-8128-000000000302', '00000000-0000-4000-8128-0000000000a0', 'Gestante', 'lead');
INSERT INTO public.lead_tags (lead_id, tag_id) VALUES
  ('00000000-0000-4000-8128-000000000101', '00000000-0000-4000-8128-000000000301'),
  ('00000000-0000-4000-8128-000000000103', '00000000-0000-4000-8128-000000000301'),
  ('00000000-0000-4000-8128-000000000103', '00000000-0000-4000-8128-000000000302');
UPDATE public.leads SET status = 'ganho' WHERE id = '00000000-0000-4000-8128-000000000103';

SELECT public.mesclar_leads('00000000-0000-4000-8128-000000000101', '00000000-0000-4000-8128-000000000103');

DO $$
DECLARE
  l public.leads%ROWTYPE;
  tags text;
BEGIN
  SELECT * INTO l FROM public.leads WHERE id = '00000000-0000-4000-8128-000000000101';
  IF l.status IS DISTINCT FROM 'ganho' OR l.ganho_em IS NULL OR NOT l.is_converted THEN
    RAISE EXCEPTION 'mesclar_leads deveria consolidar o status (aberto + ganho = ganho, com ganho_em): obtido %, ganho_em %, cliente %',
      l.status, l.ganho_em, l.is_converted;
  END IF;
  SELECT string_agg(right(tag_id::text, 3), ' ' ORDER BY tag_id) INTO tags
    FROM public.lead_tags WHERE lead_id = '00000000-0000-4000-8128-000000000101';
  IF tags IS DISTINCT FROM '301 302' THEN
    RAISE EXCEPTION 'mesclar_leads deveria mover as tags sem duplicar (esperado 301 302, obtido %)', tags;
  END IF;
  IF (SELECT count(*) FROM public.lead_anexos WHERE lead_id = '00000000-0000-4000-8128-000000000101') <> 3 THEN
    RAISE EXCEPTION 'mesclar_leads deveria mover os anexos na mesma mesclagem';
  END IF;
END $$;

DO $$
BEGIN
  IF (SELECT lead_id FROM public.lead_anexos WHERE id = '00000000-0000-4000-8128-000000000203')
     IS DISTINCT FROM '00000000-0000-4000-8128-000000000101' THEN
    RAISE EXCEPTION 'mesclar_leads deveria mover os anexos para o lead mantido';
  END IF;
  IF (SELECT caminho FROM public.lead_anexos WHERE id = '00000000-0000-4000-8128-000000000203')
     <> '00000000-0000-4000-8128-0000000000a0/00000000-0000-4000-8128-000000000103/z-contrato.pdf' THEN
    RAISE EXCEPTION 'mesclar_leads não deveria mudar o caminho do anexo';
  END IF;
END $$;

-- Troca de unidade feita pelo admin global no navegador: os anexos acompanham
DO $$
BEGIN
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', '00000000-0000-4000-8128-000000000003', 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  UPDATE public.leads SET unit_id = '00000000-0000-4000-8128-0000000000b0'
   WHERE id = '00000000-0000-4000-8128-000000000101';
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '', true);

  IF EXISTS (SELECT 1 FROM public.lead_anexos
              WHERE lead_id = '00000000-0000-4000-8128-000000000101'
                AND unit_id IS DISTINCT FROM '00000000-0000-4000-8128-0000000000b0') THEN
    RAISE EXCEPTION 'anexos deveriam seguir a unidade nova do lead';
  END IF;
  IF (SELECT count(*) FROM public.lead_anexos WHERE lead_id = '00000000-0000-4000-8128-000000000101') <> 3 THEN
    RAISE EXCEPTION 'lead 101 deveria ter 3 anexos (2 dele e 1 da mesclagem)';
  END IF;
END $$;

DO $$
BEGIN
  DELETE FROM public.leads WHERE id = '00000000-0000-4000-8128-000000000101';
  IF EXISTS (SELECT 1 FROM public.lead_anexos WHERE lead_id = '00000000-0000-4000-8128-000000000101') THEN
    RAISE EXCEPTION 'apagar o lead deveria apagar as linhas de anexo (o objeto é a rota que remove)';
  END IF;
END $$;
