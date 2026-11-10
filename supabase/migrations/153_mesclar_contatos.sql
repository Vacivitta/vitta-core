-- 153_mesclar_contatos.sql
-- Mesclar contatos (Fase 3·2, entrega 7; ADR 0001).
--
-- Por quê: o telefone é único no contato (148/150), então duplicado por telefone
-- não sobra; sobram as pessoas cadastradas duas vezes com telefones diferentes ou
-- sem telefone. Mesclar dois contatos junta a pessoa: os negócios, os dependentes,
-- as conversas e os campos da pessoa vão para o contato mantido, e o outro some.
-- mesclar_leads (147) continua juntando dois negócios.
--
-- O que faz:
--   1. mesclar_contatos(manter, remover, por): SECURITY DEFINER, só o servidor
--      (api/contatos/mesclar) chama; recusa JWT anon/authenticated mesmo se o
--      EXECUTE voltar depois de um restore. Os dois têm de ser titulares da mesma
--      unidade. Passo a passo, com os dois contatos travados (FOR UPDATE):
--      - o mantido completa o que não tem com o do removido (pessoa, campos da
--        pessoa, opt-in/opt-out: o mais antigo vence, porque opt-out é obrigação);
--        telefone e e-mail diferentes do removido vão para as observações, para
--        não se perderem;
--      - os negócios do removido passam para o mantido (fn_lead_contato_troca da
--        152 confere unidade e titular) e recebem a pessoa do mantido;
--      - dependentes e conversas passam para o mantido;
--      - cliente = algum negócio convertido; o removido é apagado.
--   2. abrir_negocio_da_mensagem (152) ganha a mesma recusa a JWT anon/authenticated.
--
-- Aplicar em produção é [H]: o Infra aplica, com aprovação e backup do dia, como
-- supabase_admin, com --single-transaction; depois registra a versão '153' e roda
-- notify pgrst, 'reload schema'. Sem BEGIN/COMMIT. Idempotente. Antes do deploy do
-- app. Depois de um restore: reaplicar depois da 152 (ordem pós-restore).
--
-- Reversão: DROP FUNCTION IF EXISTS public.mesclar_contatos(uuid, uuid, uuid);
--   e reaplicar a 152 (abrir_negocio_da_mensagem sem a recusa).

SET LOCAL lock_timeout = '5s';

DO $$
BEGIN
  IF current_setting('lock_timeout') <> '5s' THEN
    RAISE EXCEPTION '153: rode com --single-transaction (lock_timeout atual: %)', current_setting('lock_timeout');
  END IF;
  IF current_user <> 'supabase_admin' THEN
    RAISE EXCEPTION '153: rodar como supabase_admin (atual: %)', current_user;
  END IF;
  IF to_regprocedure('public.abrir_negocio_da_mensagem(uuid,uuid,text)') IS NULL THEN
    RAISE EXCEPTION '153: depende da 152';
  END IF;
END $$;

-- ── 1. mesclar_contatos ──────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.mesclar_contatos(manter uuid, remover uuid, por uuid DEFAULT NULL)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  cm public.contatos%ROWTYPE;
  cr public.contatos%ROWTYPE;
  extras text[] := '{}';
BEGIN
  IF coalesce(auth.role(), '') IN ('anon', 'authenticated') THEN
    RAISE EXCEPTION 'mesclar_contatos: só o servidor mescla contatos (api/contatos/mesclar)' USING ERRCODE = '42501';
  END IF;
  IF manter IS NULL OR remover IS NULL THEN
    RAISE EXCEPTION 'mesclar_contatos: informe os dois contatos' USING ERRCODE = '22004';
  END IF;
  IF manter = remover THEN
    RAISE EXCEPTION 'mesclar_contatos: o contato a manter e o a remover são o mesmo' USING ERRCODE = '22023';
  END IF;

  -- Trava os dois na mesma ordem (por id) para duas mesclagens cruzadas não se travarem
  PERFORM 1 FROM public.contatos WHERE id IN (manter, remover) ORDER BY id FOR UPDATE;
  SELECT * INTO cm FROM public.contatos WHERE id = manter;
  SELECT * INTO cr FROM public.contatos WHERE id = remover;
  IF cm.id IS NULL OR cr.id IS NULL THEN
    RAISE EXCEPTION 'mesclar_contatos: contato não encontrado' USING ERRCODE = 'P0002';
  END IF;
  IF cm.responsavel_id IS NOT NULL OR cr.responsavel_id IS NOT NULL THEN
    RAISE EXCEPTION 'mesclar_contatos: dependente não é mesclado (mescle o responsável)' USING ERRCODE = '22023';
  END IF;
  IF cm.unit_id IS DISTINCT FROM cr.unit_id THEN
    RAISE EXCEPTION 'mesclar_contatos: os contatos são de unidades diferentes' USING ERRCODE = '22023';
  END IF;

  -- O que o removido tem e o mantido não guardaria: vai para as observações
  IF cr.telefone IS NOT NULL AND cm.telefone IS NOT NULL AND cr.telefone_norm IS DISTINCT FROM cm.telefone_norm THEN
    extras := extras || ('Outro telefone: ' || cr.telefone);
  END IF;
  IF cr.email IS NOT NULL AND cm.email IS NOT NULL AND lower(cr.email) <> lower(cm.email) THEN
    extras := extras || ('Outro e-mail: ' || cr.email);
  END IF;
  IF cr.observacoes IS NOT NULL AND cr.observacoes IS DISTINCT FROM cm.observacoes THEN
    extras := extras || cr.observacoes;
  END IF;

  -- Libera o telefone do removido (índice único da unidade) antes de passá-lo
  UPDATE public.contatos SET telefone = NULL WHERE id = remover AND telefone IS NOT NULL;

  -- Negócios, dependentes e conversas vão para o mantido
  UPDATE public.leads SET contato_id = manter WHERE contato_id = remover;
  UPDATE public.contatos SET responsavel_id = manter WHERE responsavel_id = remover;
  UPDATE public.wa_conversations SET contato_id = manter WHERE contato_id = remover;

  -- O mantido completa a pessoa. Este UPDATE dispara fn_contato_espelho (149), que
  -- leva a pessoa a todos os negócios dele, inclusive os que vieram do removido.
  UPDATE public.contatos c
     SET sobrenome = coalesce(c.sobrenome, cr.sobrenome),
         telefone = coalesce(c.telefone, cr.telefone),
         email = coalesce(c.email, cr.email), cpf = coalesce(c.cpf, cr.cpf),
         data_nascimento = coalesce(c.data_nascimento, cr.data_nascimento),
         profissao = coalesce(c.profissao, cr.profissao), cidade = coalesce(c.cidade, cr.cidade),
         estado = coalesce(c.estado, cr.estado), pais = coalesce(c.pais, cr.pais),
         instagram = coalesce(c.instagram, cr.instagram), site = coalesce(c.site, cr.site),
         observacoes = nullif(concat_ws(E'\n', c.observacoes, nullif(array_to_string(extras, E'\n'), '')), ''),
         wa_optin_at = least(c.wa_optin_at, cr.wa_optin_at),
         wa_optout_at = least(c.wa_optout_at, cr.wa_optout_at),
         campos = cr.campos || c.campos,
         cliente = EXISTS (SELECT 1 FROM public.leads l WHERE l.contato_id = manter AND l.is_converted)
   WHERE c.id = manter;

  DELETE FROM public.contatos WHERE id = remover;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.mesclar_contatos(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mesclar_contatos(uuid, uuid, uuid) TO service_role;

-- ── 2. abrir_negocio_da_mensagem recusa JWT do app ───────────────────────────
CREATE OR REPLACE FUNCTION public.abrir_negocio_da_mensagem(p_contato uuid, p_stage uuid, p_origem text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_contato public.contatos%ROWTYPE;
  v_lead uuid;
BEGIN
  -- Depois de um restore o EXECUTE volta para authenticated: não depender só do GRANT
  IF coalesce(auth.role(), '') IN ('anon', 'authenticated') THEN
    RAISE EXCEPTION 'abrir_negocio_da_mensagem: só o servidor (webhook)' USING ERRCODE = '42501';
  END IF;

  -- Duas mensagens seguidas do mesmo contato esperam aqui uma pela outra
  PERFORM pg_advisory_xact_lock(hashtextextended('abrir_negocio:' || p_contato::text, 0));

  SELECT l.id INTO v_lead FROM public.leads l
   WHERE l.contato_id = p_contato AND l.status = 'aberto' AND NOT l.arquivado
   ORDER BY l.created_at DESC LIMIT 1;
  IF v_lead IS NOT NULL THEN
    RETURN v_lead;
  END IF;

  SELECT * INTO v_contato FROM public.contatos WHERE id = p_contato AND responsavel_id IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'contato % não existe ou não é titular', p_contato USING ERRCODE = '23514';
  END IF;

  INSERT INTO public.leads (unit_id, contato_id, nome, origem, funnel_id, stage_id)
  SELECT v_contato.unit_id, v_contato.id, v_contato.nome, p_origem, fs.funnel_id, fs.id
    FROM public.funnel_stages fs
    JOIN public.funnels f ON f.id = fs.funnel_id
   WHERE fs.id = p_stage AND f.unit_id = v_contato.unit_id AND f.objeto = 'negocio'
  RETURNING id INTO v_lead;
  IF v_lead IS NULL THEN
    RAISE EXCEPTION 'etapa % não é de um funil de negócio da unidade do contato', p_stage USING ERRCODE = '23514';
  END IF;
  RETURN v_lead;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.abrir_negocio_da_mensagem(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.abrir_negocio_da_mensagem(uuid, uuid, text) TO service_role;

-- ── Conferência ──────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF has_function_privilege('authenticated', 'public.mesclar_contatos(uuid, uuid, uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.mesclar_contatos(uuid, uuid, uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.abrir_negocio_da_mensagem(uuid, uuid, text)', 'EXECUTE') THEN
    RAISE EXCEPTION '153: funções executáveis por anon/authenticated';
  END IF;
END $$;
