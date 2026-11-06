-- 142_security_definer_search_path.sql
-- search_path fixo nas funções SECURITY DEFINER do public que não tinham.
--
-- Por quê:
--   - Uma SECURITY DEFINER sem search_path usa o de quem chama. Chamada de uma
--     função com search_path '' (a 141 faz isso), is_global_admin() falha com
--     42P01 "relation profiles does not exist", e com ela as políticas de RLS que
--     a usam.
--   - Pior: quem chama escolhe o search_path. Com pg_temp na frente e uma tabela
--     temporária "profiles" dando o próprio id como admin, is_global_admin()
--     devolvia true para um atendente (provado em tests/db/190_search_path.test.sql
--     antes desta migração). A função roda com os privilégios do dono.
--
-- O que faz: recria, com o mesmo corpo, as 10 SECURITY DEFINER do public sem
-- search_path, agora com SET search_path TO 'public' e tabelas qualificadas com
-- public. (o search_path fixo resolve o primeiro problema; o nome qualificado, o
-- de pg_temp: sem pg_temp na lista, ele continua procurado antes para tabelas). Funções do pg_catalog e
-- auth.uid() não mudam. Assinatura, volatilidade, linguagem, dono e EXECUTE ficam
-- (CREATE OR REPLACE mantém dono e privilégios):
--   is_global_admin()                  067, lida pelas políticas de RLS
--   is_admin()                         092
--   get_agent_stats(uuid)              036, dashboard
--   increment_wa_unread(uuid)          032b, webhook do WhatsApp
--   log_responsible_change()           001, trigger em leads
--   fn_auto_link_creator_to_unit()     066, trigger em units
--   fn_notify_quote_expired()          082, trigger em quotes
--   fn_notify_note_mentions()          082, trigger em lead_notes
--   fn_notify_wa_note_mentions()       082, trigger em wa_internal_notes
--   fn_notify_chat_interno_mentions()  082, trigger em internal_channel_messages
--
-- Corpo igual ao da última migração que criou cada uma (a 092 trouxe is_admin()
-- do pg_get_functiondef de produção). Antes de aplicar, conferir que o
-- pg_get_functiondef de produção dessas 10 bate com essas migrações; se alguma
-- divergir, não aplicar e trazer a divergência para cá.
--
-- Aplicar em produção: o Infra aplica, com aprovação e backup do dia, como
-- supabase_admin, com --single-transaction; depois registra a versão '142' e roda
-- notify pgrst, 'reload schema'. Sem BEGIN/COMMIT. Idempotente. Independe do app.
-- Não muda privilégio nem recria função da ordem pós-restore: o restore traz o
-- search_path de volta junto com a função, então não entra nela.
--
-- Reversão (só com aprovação; reabre o problema): ALTER FUNCTION <assinatura>
-- RESET search_path para cada uma das 10.

SET LOCAL lock_timeout = '5s';

DO $$
BEGIN
  IF current_setting('lock_timeout') <> '5s' THEN
    RAISE EXCEPTION '142: rode com --single-transaction (lock_timeout atual: %)', current_setting('lock_timeout');
  END IF;
  IF current_user <> 'supabase_admin' THEN
    RAISE EXCEPTION '142: rodar como supabase_admin (atual: %)', current_user;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.is_global_admin()
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid()
      AND perfil IN ('admin', 'gestor_vacivitta')
  );
$$;

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND perfil = 'admin'
  );
$$;

CREATE OR REPLACE FUNCTION public.get_agent_stats(p_unit_id UUID)
RETURNS TABLE(
  agent_id            UUID,
  open_count          BIGINT,
  resolved_today      BIGINT,
  avg_response_minutes NUMERIC
) LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  WITH response_times AS (
    SELECT
      c.assigned_to,
      EXTRACT(EPOCH FROM (
        MAX(CASE WHEN m.direction = 'outbound' THEN m.created_at END) -
        MAX(CASE WHEN m.direction = 'inbound'  THEN m.created_at END)
      )) / 60 AS resp_minutes
    FROM public.wa_conversations c
    JOIN public.wa_messages m ON m.conversation_id = c.id
    WHERE c.unit_id      = p_unit_id
      AND c.assigned_to  IS NOT NULL
      AND c.status       != 'resolved'
    GROUP BY c.assigned_to, c.id
    HAVING
      MAX(CASE WHEN m.direction = 'outbound' THEN m.created_at END) >
      MAX(CASE WHEN m.direction = 'inbound'  THEN m.created_at END)
  )
  SELECT
    p.id                                                                            AS agent_id,
    COUNT(DISTINCT c.id) FILTER (WHERE c.status != 'resolved')                    AS open_count,
    COUNT(DISTINCT c.id) FILTER (
      WHERE c.status = 'resolved' AND c.resolved_at >= CURRENT_DATE
    )                                                                               AS resolved_today,
    ROUND(AVG(rt.resp_minutes))                                                     AS avg_response_minutes
  FROM public.profiles p
  LEFT JOIN public.wa_conversations c  ON c.assigned_to = p.id AND c.unit_id = p.unit_id
  LEFT JOIN response_times   rt ON rt.assigned_to = p.id
  WHERE p.unit_id = p_unit_id
    AND p.perfil  = 'atendente'
  GROUP BY p.id
$$;

CREATE OR REPLACE FUNCTION public.increment_wa_unread(p_conversation_id UUID)
RETURNS void LANGUAGE sql SECURITY DEFINER
SET search_path TO 'public'
AS $$
  UPDATE public.wa_conversations
  SET unread_count = unread_count + 1
  WHERE id = p_conversation_id;
$$;

CREATE OR REPLACE FUNCTION public.log_responsible_change()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF OLD.responsavel_id IS DISTINCT FROM NEW.responsavel_id THEN
    INSERT INTO public.lead_responsible_history (
      lead_id, responsavel_anterior_id, novo_responsavel_id, trocado_por_id
    ) VALUES (
      NEW.id, OLD.responsavel_id, NEW.responsavel_id, auth.uid()
    );
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_auto_link_creator_to_unit()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF auth.uid() IS NOT NULL THEN
    INSERT INTO public.user_units (user_id, unit_id)
    VALUES (auth.uid(), NEW.id)
    ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_notify_quote_expired()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  lead_name TEXT;
  lead_sobrenome TEXT;
  patient_name TEXT;
  num_str TEXT;
  valor_str TEXT;
BEGIN
  -- Só dispara quando o status MUDA para 'expirado'
  IF NEW.status = 'expirado' AND OLD.status IS DISTINCT FROM 'expirado' THEN
    -- Evita notificação duplicada
    IF EXISTS (
      SELECT 1 FROM public.notifications
      WHERE quote_id = NEW.id AND type = 'quote_expirado'
    ) THEN
      RETURN NEW;
    END IF;

    -- Busca nome do lead/paciente
    SELECT nome, sobrenome INTO lead_name, lead_sobrenome
    FROM public.leads WHERE id = NEW.lead_id;

    patient_name := COALESCE(lead_name, 'Paciente');
    IF lead_sobrenome IS NOT NULL AND lead_sobrenome != '' THEN
      patient_name := patient_name || ' ' || lead_sobrenome;
    END IF;

    num_str := lpad(COALESCE(NEW.numero, 0)::text, 4, '0');

    IF NEW.total_calculado IS NOT NULL THEN
      valor_str := to_char(NEW.total_calculado, 'FM999G999G999D00');
      valor_str := replace(replace(replace(valor_str, ',', '#T#'), '.', ','), '#T#', '.');
      valor_str := ' · R$ ' || valor_str;
    ELSE
      valor_str := '';
    END IF;

    INSERT INTO public.notifications (unit_id, user_id, type, title, body, quote_id, lead_id)
    VALUES (
      NEW.unit_id,
      NEW.responsavel_id,
      'quote_expirado',
      '⏰ Orçamento expirado',
      '#' || num_str || ' · ' || patient_name || valor_str,
      NEW.id,
      NEW.lead_id
    );
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_notify_note_mentions()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  mentioned_id UUID;
  lead_name TEXT;
  author_name TEXT;
BEGIN
  IF NEW.mencoes IS NULL OR jsonb_array_length(NEW.mencoes) = 0 THEN
    RETURN NEW;
  END IF;

  SELECT nome INTO lead_name FROM public.leads WHERE id = NEW.lead_id;
  SELECT COALESCE(NULLIF(apelido, ''), NULLIF(full_name, ''), 'Alguém')
    INTO author_name FROM public.profiles WHERE id = NEW.autor_id;

  FOR mentioned_id IN SELECT jsonb_array_elements_text(NEW.mencoes)::uuid
  LOOP
    IF mentioned_id != COALESCE(NEW.autor_id, '00000000-0000-0000-0000-000000000000'::uuid) THEN
      INSERT INTO public.notifications (unit_id, user_id, type, title, body, lead_id)
      VALUES (
        NEW.unit_id,
        mentioned_id,
        'mention_note',
        author_name || ' mencionou você',
        LEFT(NEW.conteudo, 120),
        NEW.lead_id
      );
    END IF;
  END LOOP;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_notify_wa_note_mentions()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  mentioned_id UUID;
  author_name TEXT;
  lead_id_val UUID;
BEGIN
  IF NEW.mencoes IS NULL OR jsonb_array_length(NEW.mencoes) = 0 THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(NULLIF(apelido, ''), NULLIF(full_name, ''), 'Alguém')
    INTO author_name FROM public.profiles WHERE id = NEW.author_id;

  SELECT c.lead_id INTO lead_id_val
    FROM public.wa_conversations c WHERE c.id = NEW.conversation_id;

  FOR mentioned_id IN SELECT jsonb_array_elements_text(NEW.mencoes)::uuid
  LOOP
    IF mentioned_id != COALESCE(NEW.author_id, '00000000-0000-0000-0000-000000000000'::uuid) THEN
      INSERT INTO public.notifications (unit_id, user_id, type, title, body, lead_id)
      VALUES (
        NEW.unit_id,
        mentioned_id,
        'mention_note',
        author_name || ' mencionou você',
        LEFT(NEW.content, 120),
        lead_id_val
      );
    END IF;
  END LOOP;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_notify_chat_interno_mentions()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  mentioned_id UUID;
  author_name TEXT;
  mentioned_unit_id UUID;
BEGIN
  IF NEW.mencoes IS NULL OR jsonb_array_length(NEW.mencoes) = 0 THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(NULLIF(apelido, ''), NULLIF(full_name, ''), 'Alguém')
    INTO author_name FROM public.profiles WHERE id = NEW.autor_id;

  FOR mentioned_id IN SELECT jsonb_array_elements_text(NEW.mencoes)::uuid
  LOOP
    IF mentioned_id != COALESCE(NEW.autor_id, '00000000-0000-0000-0000-000000000000'::uuid) THEN
      SELECT unit_id INTO mentioned_unit_id FROM public.profiles WHERE id = mentioned_id;

      INSERT INTO public.notifications (unit_id, user_id, type, title, body)
      VALUES (
        COALESCE(mentioned_unit_id, (SELECT unit_id FROM public.profiles WHERE id = NEW.autor_id)),
        mentioned_id,
        'mention_note',
        author_name || ' mencionou você no chat interno',
        LEFT(NEW.conteudo, 120)
      );
    END IF;
  END LOOP;

  RETURN NEW;
END;
$$;
