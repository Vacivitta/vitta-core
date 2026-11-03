INSERT INTO public.tenants (id, nome) VALUES ('00000000-0000-4000-8000-0000000006f0', 'Rede Teste Erros');
INSERT INTO public.units (id, tenant_id, nome, tipo)
VALUES ('00000000-0000-4000-8000-0000000006a0', '00000000-0000-4000-8000-0000000006f0', 'Clínica Erros', 'clinica');

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('00000000-0000-4000-8000-000000000601', 'atendente@teste.invalid', '{"full_name": "Atendente"}'),
  ('00000000-0000-4000-8000-000000000603', 'gestor@teste.invalid', '{"full_name": "Gestor Unidade"}'),
  ('00000000-0000-4000-8000-000000000604', 'gestorvv@teste.invalid', '{"full_name": "Gestor Vacivitta"}'),
  ('00000000-0000-4000-8000-000000000605', 'admin@teste.invalid', '{"full_name": "Admin"}');

UPDATE public.profiles SET unit_id = '00000000-0000-4000-8000-0000000006a0',
  perfil = CASE id
    WHEN '00000000-0000-4000-8000-000000000603' THEN 'gestor_unidade'
    WHEN '00000000-0000-4000-8000-000000000604' THEN 'gestor_vacivitta'
    WHEN '00000000-0000-4000-8000-000000000605' THEN 'admin'
    ELSE 'atendente' END
 WHERE id::text LIKE '00000000-0000-4000-8000-00000000060_';

CREATE FUNCTION pg_temp.como(papel text, usuario uuid, comando text) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE
  linhas bigint;
  valor text;
  resultado text;
BEGIN
  BEGIN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', usuario, 'role', papel)::text, true);
    EXECUTE format('SET LOCAL ROLE %I', papel);
    IF comando ILIKE 'select%' THEN
      EXECUTE comando INTO valor;
    ELSE
      EXECUTE comando;
      GET DIAGNOSTICS linhas = ROW_COUNT;
      valor := linhas::text;
    END IF;
    RAISE EXCEPTION USING ERRCODE = 'VCT01', MESSAGE = coalesce(valor, 'null');
  EXCEPTION
    WHEN SQLSTATE 'VCT01' THEN resultado := SQLERRM;
    WHEN OTHERS THEN resultado := 'erro ' || SQLSTATE;
  END;
  RETURN resultado;
END $$;

SET LOCAL ROLE service_role;
SELECT public.registrar_erro_app('teste-assinatura-1', 'rota', '/api/teste', 'POST', 'TypeError',
                                 'falha de teste', '    at teste (arquivo.ts:1:1)', 'digest-1');
SELECT public.registrar_erro_app('teste-assinatura-1', 'rota', '/api/teste', 'POST', 'TypeError',
                                 'falha de teste', NULL, NULL);
RESET ROLE;

DO $$
DECLARE
  e public.app_errors;
BEGIN
  IF (SELECT count(*) FROM public.app_errors WHERE assinatura = 'teste-assinatura-1') <> 1 THEN
    RAISE EXCEPTION 'mesma assinatura duas vezes deveria virar 1 linha';
  END IF;
  SELECT * INTO e FROM public.app_errors WHERE assinatura = 'teste-assinatura-1';
  IF e.ocorrencias <> 2 THEN
    RAISE EXCEPTION 'ocorrencias: esperado 2, obtido %', e.ocorrencias;
  END IF;
  IF e.stack IS NULL OR e.digest IS NULL THEN
    RAISE EXCEPTION 'ocorrência sem stack/digest não deveria apagar os já gravados';
  END IF;
END $$;

UPDATE public.app_errors SET resolvido_em = now(), resolvido_por = '00000000-0000-4000-8000-000000000605'
 WHERE assinatura = 'teste-assinatura-1';

SET LOCAL ROLE service_role;
SELECT public.registrar_erro_app('teste-assinatura-1', 'rota', '/api/teste', 'POST', 'TypeError',
                                 'falha de teste', NULL, NULL, 3);
RESET ROLE;

DO $$
DECLARE
  e public.app_errors;
BEGIN
  SELECT * INTO e FROM public.app_errors WHERE assinatura = 'teste-assinatura-1';
  IF e.resolvido_em IS NOT NULL OR e.resolvido_por IS NOT NULL THEN
    RAISE EXCEPTION 'erro resolvido que volta a acontecer deveria reabrir';
  END IF;
  IF e.ocorrencias <> 5 THEN
    RAISE EXCEPTION 'ocorrencias com p_quantidade = 3: esperado 5, obtido %', e.ocorrencias;
  END IF;
END $$;

CREATE TEMP TABLE casos (ordem serial, caso text, papel text, usuario uuid, comando text, esperado text);

INSERT INTO casos (caso, papel, usuario, comando, esperado) VALUES
  ('admin lê os erros', 'authenticated', '00000000-0000-4000-8000-000000000605',
   $c$SELECT (count(*) > 0)::text FROM public.app_errors$c$, 'true'),
  ('gestor_vacivitta (admin global) lê os erros', 'authenticated', '00000000-0000-4000-8000-000000000604',
   $c$SELECT (count(*) > 0)::text FROM public.app_errors$c$, 'true'),
  ('gestor_unidade lê os erros', 'authenticated', '00000000-0000-4000-8000-000000000603',
   $c$SELECT count(*)::text FROM public.app_errors$c$, '0'),
  ('atendente lê os erros', 'authenticated', '00000000-0000-4000-8000-000000000601',
   $c$SELECT count(*)::text FROM public.app_errors$c$, '0'),
  ('anon lê os erros', 'anon', NULL,
   $c$SELECT count(*)::text FROM public.app_errors$c$, 'erro 42501'),
  ('authenticated executa registrar_erro_app', 'authenticated', '00000000-0000-4000-8000-000000000605',
   $c$SELECT public.registrar_erro_app('x', 'rota', NULL, NULL, 'Error', 'x', NULL, NULL)::text$c$, 'erro 42501'),
  ('anon executa registrar_erro_app', 'anon', NULL,
   $c$SELECT public.registrar_erro_app('x', 'rota', NULL, NULL, 'Error', 'x', NULL, NULL)::text$c$, 'erro 42501'),
  ('admin marca como resolvido', 'authenticated', '00000000-0000-4000-8000-000000000605',
   $c$UPDATE public.app_errors SET resolvido_em = now(), resolvido_por = '00000000-0000-4000-8000-000000000605'
       WHERE assinatura = 'teste-assinatura-1'$c$, '1'),
  ('admin marca como resolvido em nome de outra pessoa', 'authenticated', '00000000-0000-4000-8000-000000000605',
   $c$UPDATE public.app_errors SET resolvido_em = now(), resolvido_por = '00000000-0000-4000-8000-000000000604'
       WHERE assinatura = 'teste-assinatura-1'$c$, 'erro 42501'),
  ('admin edita a mensagem', 'authenticated', '00000000-0000-4000-8000-000000000605',
   $c$UPDATE public.app_errors SET mensagem = 'outra' WHERE assinatura = 'teste-assinatura-1'$c$, 'erro 42501'),
  ('atendente marca como resolvido', 'authenticated', '00000000-0000-4000-8000-000000000601',
   $c$UPDATE public.app_errors SET resolvido_em = now() WHERE assinatura = 'teste-assinatura-1'$c$, '0'),
  ('gestor_unidade marca como resolvido', 'authenticated', '00000000-0000-4000-8000-000000000603',
   $c$UPDATE public.app_errors SET resolvido_em = now() WHERE assinatura = 'teste-assinatura-1'$c$, '0'),
  ('admin insere erro direto', 'authenticated', '00000000-0000-4000-8000-000000000605',
   $c$INSERT INTO public.app_errors (assinatura, origem, tipo, mensagem) VALUES ('y', 'rota', 'Error', 'y')$c$, 'erro 42501'),
  ('admin apaga erro', 'authenticated', '00000000-0000-4000-8000-000000000605',
   $c$DELETE FROM public.app_errors WHERE assinatura = 'teste-assinatura-1'$c$, 'erro 42501'),
  ('authenticated trunca a tabela', 'authenticated', '00000000-0000-4000-8000-000000000605',
   $c$TRUNCATE public.app_errors$c$, 'erro 42501');

DO $$
DECLARE
  c record;
  obtido text;
  divergentes text[] := '{}';
BEGIN
  FOR c IN SELECT * FROM casos ORDER BY ordem LOOP
    obtido := pg_temp.como(c.papel, c.usuario, c.comando);
    IF obtido IS DISTINCT FROM c.esperado THEN
      divergentes := divergentes || format('%s: esperado %s, obtido %s', c.caso, c.esperado, obtido);
    END IF;
  END LOOP;
  IF cardinality(divergentes) > 0 THEN
    RAISE EXCEPTION E'% de % casos divergentes:\n  %', cardinality(divergentes), (SELECT count(*) FROM casos),
      array_to_string(divergentes, E'\n  ');
  END IF;
END $$;

DO $$
DECLARE
  comando text;
BEGIN
  SELECT j.command INTO comando FROM cron.job j WHERE j.jobname = 'purge-app-errors';
  IF comando IS NULL THEN
    RAISE EXCEPTION 'job purge-app-errors não está agendado';
  END IF;
  IF (SELECT count(*) FROM cron.job WHERE jobname = 'purge-app-errors') <> 1 THEN
    RAISE EXCEPTION 'job purge-app-errors agendado mais de uma vez (reaplicar a 124 deveria substituir)';
  END IF;
END $$;

INSERT INTO public.app_errors (assinatura, origem, tipo, mensagem, ultimo_em, resolvido_em) VALUES
  ('purge-resolvido-antigo', 'cron', 'Error', 'x', now() - interval '40 days', now() - interval '31 days'),
  ('purge-resolvido-recente', 'cron', 'Error', 'x', now() - interval '40 days', now() - interval '5 days'),
  ('purge-aberto-antigo', 'cron', 'Error', 'x', now() - interval '91 days', NULL),
  ('purge-aberto-recente', 'cron', 'Error', 'x', now() - interval '60 days', NULL);

DO $$
DECLARE
  sobraram text;
BEGIN
  EXECUTE (SELECT command FROM cron.job WHERE jobname = 'purge-app-errors');
  SELECT string_agg(assinatura, ',' ORDER BY assinatura) INTO sobraram
    FROM public.app_errors WHERE assinatura LIKE 'purge-%';
  IF sobraram IS DISTINCT FROM 'purge-aberto-recente,purge-resolvido-recente' THEN
    RAISE EXCEPTION 'purge-app-errors deixou: % (esperado purge-aberto-recente,purge-resolvido-recente)', sobraram;
  END IF;
END $$;
