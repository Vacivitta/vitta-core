-- Conexão por QR Code (144): limite de envio por minuto e conversa única por conexão.

INSERT INTO public.tenants (id, nome) VALUES ('00000000-0000-4000-8144-0000000000f0', 'Rede 144');
INSERT INTO public.units (id, tenant_id, nome, tipo) VALUES
  ('00000000-0000-4000-8144-0000000000a0', '00000000-0000-4000-8144-0000000000f0', 'Unidade 144', 'clinica');
INSERT INTO public.conexoes (id, unit_id, tipo, nome, status) VALUES
  ('00000000-0000-4000-8144-0000000000c1', '00000000-0000-4000-8144-0000000000a0', 'oficial', 'Oficial', 'conectada');
INSERT INTO public.conexoes (id, unit_id, tipo, nome, instancia, status, limite_por_minuto) VALUES
  ('00000000-0000-4000-8144-0000000000c2', '00000000-0000-4000-8144-0000000000a0', 'qrcode', 'QR', 'ci-144', 'conectada', 3);

DO $$
DECLARE
  resultados boolean[] := '{}';
BEGIN
  FOR i IN 1..4 LOOP
    resultados := resultados || public.reservar_envio_conexao('00000000-0000-4000-8144-0000000000c2');
  END LOOP;
  IF resultados <> ARRAY[true, true, true, false] THEN
    RAISE EXCEPTION 'limite 3 por minuto: esperado {t,t,t,f}, obtido %', resultados;
  END IF;
  -- Reserva de mais de um minuto não conta; de mais de uma hora é apagada
  UPDATE public.conexao_envios SET reservado_em = now() - interval '2 hours'
   WHERE conexao_id = '00000000-0000-4000-8144-0000000000c2';
  IF NOT public.reservar_envio_conexao('00000000-0000-4000-8144-0000000000c2') THEN
    RAISE EXCEPTION 'passado o minuto, a conexão deveria ter vaga de novo';
  END IF;
  IF (SELECT count(*) FROM public.conexao_envios WHERE conexao_id = '00000000-0000-4000-8144-0000000000c2') <> 1 THEN
    RAISE EXCEPTION 'reservas com mais de uma hora deveriam ser apagadas';
  END IF;
  IF public.reservar_envio_conexao('00000000-0000-4000-8144-0000000000ff') THEN
    RAISE EXCEPTION 'conexão inexistente não tem vaga';
  END IF;
  BEGIN
    UPDATE public.conexoes SET limite_por_minuto = 0 WHERE id = '00000000-0000-4000-8144-0000000000c2';
    RAISE EXCEPTION 'limite fora de 1 a 60 deveria ser recusado';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END $$;

-- O mesmo cliente pode ter uma conversa em cada número da unidade, e só uma por número
INSERT INTO public.wa_conversations (unit_id, conexao_id, wa_phone) VALUES
  ('00000000-0000-4000-8144-0000000000a0', '00000000-0000-4000-8144-0000000000c1', '5511900000144'),
  ('00000000-0000-4000-8144-0000000000a0', '00000000-0000-4000-8144-0000000000c2', '5511900000144');

DO $$
BEGIN
  BEGIN
    INSERT INTO public.wa_conversations (unit_id, conexao_id, wa_phone) VALUES
      ('00000000-0000-4000-8144-0000000000a0', '00000000-0000-4000-8144-0000000000c2', '5511900000144');
    RAISE EXCEPTION 'segunda conversa do mesmo telefone na mesma conexão deveria ser recusada';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
END $$;

DO $$
DECLARE
  papel text;
BEGIN
  FOREACH papel IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF has_function_privilege(papel, 'public.reservar_envio_conexao(uuid)', 'EXECUTE') THEN
      RAISE EXCEPTION '% não deveria executar reservar_envio_conexao', papel;
    END IF;
    IF has_table_privilege(papel, 'public.conexao_envios', 'SELECT') THEN
      RAISE EXCEPTION '% não deveria ler conexao_envios', papel;
    END IF;
  END LOOP;
  IF NOT has_function_privilege('service_role', 'public.reservar_envio_conexao(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'service_role deveria executar reservar_envio_conexao';
  END IF;
END $$;
