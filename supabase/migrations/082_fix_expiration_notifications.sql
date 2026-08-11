-- ============================================================================
-- Migration 082: Corrigir notificações de expiração de orçamentos
--
-- Problema: page.tsx marca orçamentos como 'expirado' antes do cron rodar,
-- mas sem criar notificação. O cron não encontra mais esses orçamentos.
--
-- Solução: trigger AFTER UPDATE em quotes que cria notificação automaticamente
-- quando o status muda para 'expirado', independente de quem fez a mudança.
--
-- Também corrige: triggers de menção para usar apelido ao invés de full_name
-- quando disponível, evitando mostrar emails como nome do autor.
-- ============================================================================

-- ── 1. Trigger: notificação automática ao expirar orçamento ─────────────────

CREATE OR REPLACE FUNCTION fn_notify_quote_expired()
RETURNS TRIGGER AS $$
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
      SELECT 1 FROM notifications
      WHERE quote_id = NEW.id AND type = 'quote_expirado'
    ) THEN
      RETURN NEW;
    END IF;

    -- Busca nome do lead/paciente
    SELECT nome, sobrenome INTO lead_name, lead_sobrenome
    FROM leads WHERE id = NEW.lead_id;

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

    INSERT INTO notifications (unit_id, user_id, type, title, body, quote_id, lead_id)
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
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_notify_quote_expired ON quotes;
CREATE TRIGGER trg_notify_quote_expired
  AFTER UPDATE ON quotes
  FOR EACH ROW
  EXECUTE FUNCTION fn_notify_quote_expired();


-- ── 2. Corrigir triggers de menção: preferir apelido sobre full_name ────────

-- 2a. Lead notes
CREATE OR REPLACE FUNCTION fn_notify_note_mentions()
RETURNS TRIGGER AS $$
DECLARE
  mentioned_id UUID;
  lead_name TEXT;
  author_name TEXT;
BEGIN
  IF NEW.mencoes IS NULL OR jsonb_array_length(NEW.mencoes) = 0 THEN
    RETURN NEW;
  END IF;

  SELECT nome INTO lead_name FROM leads WHERE id = NEW.lead_id;
  SELECT COALESCE(NULLIF(apelido, ''), NULLIF(full_name, ''), 'Alguém')
    INTO author_name FROM profiles WHERE id = NEW.autor_id;

  FOR mentioned_id IN SELECT jsonb_array_elements_text(NEW.mencoes)::uuid
  LOOP
    IF mentioned_id != COALESCE(NEW.autor_id, '00000000-0000-0000-0000-000000000000'::uuid) THEN
      INSERT INTO notifications (unit_id, user_id, type, title, body, lead_id)
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
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 2b. WA internal notes
CREATE OR REPLACE FUNCTION fn_notify_wa_note_mentions()
RETURNS TRIGGER AS $$
DECLARE
  mentioned_id UUID;
  author_name TEXT;
  lead_id_val UUID;
BEGIN
  IF NEW.mencoes IS NULL OR jsonb_array_length(NEW.mencoes) = 0 THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(NULLIF(apelido, ''), NULLIF(full_name, ''), 'Alguém')
    INTO author_name FROM profiles WHERE id = NEW.author_id;

  SELECT c.lead_id INTO lead_id_val
    FROM wa_conversations c WHERE c.id = NEW.conversation_id;

  FOR mentioned_id IN SELECT jsonb_array_elements_text(NEW.mencoes)::uuid
  LOOP
    IF mentioned_id != COALESCE(NEW.author_id, '00000000-0000-0000-0000-000000000000'::uuid) THEN
      INSERT INTO notifications (unit_id, user_id, type, title, body, lead_id)
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
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 2c. Chat interno
CREATE OR REPLACE FUNCTION fn_notify_chat_interno_mentions()
RETURNS TRIGGER AS $$
DECLARE
  mentioned_id UUID;
  author_name TEXT;
  mentioned_unit_id UUID;
BEGIN
  IF NEW.mencoes IS NULL OR jsonb_array_length(NEW.mencoes) = 0 THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(NULLIF(apelido, ''), NULLIF(full_name, ''), 'Alguém')
    INTO author_name FROM profiles WHERE id = NEW.autor_id;

  FOR mentioned_id IN SELECT jsonb_array_elements_text(NEW.mencoes)::uuid
  LOOP
    IF mentioned_id != COALESCE(NEW.autor_id, '00000000-0000-0000-0000-000000000000'::uuid) THEN
      SELECT unit_id INTO mentioned_unit_id FROM profiles WHERE id = mentioned_id;

      INSERT INTO notifications (unit_id, user_id, type, title, body)
      VALUES (
        COALESCE(mentioned_unit_id, (SELECT unit_id FROM profiles WHERE id = NEW.autor_id)),
        mentioned_id,
        'mention_note',
        author_name || ' mencionou você no chat interno',
        LEFT(NEW.conteudo, 120)
      );
    END IF;
  END LOOP;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
