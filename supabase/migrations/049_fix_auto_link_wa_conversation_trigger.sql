-- Remove referências a client_id e public.clients da função de auto-vínculo
-- O trigger continuava quebrando o upsert de wa_conversations após a remoção da tabela clients

CREATE OR REPLACE FUNCTION auto_link_wa_conversation()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_lead_id uuid;
BEGIN
  -- Já veio vinculado manualmente — não sobrescreve
  IF NEW.lead_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  -- Busca lead pelo telefone na mesma unidade
  SELECT id INTO v_lead_id
  FROM public.leads
  WHERE unit_id = NEW.unit_id
    AND telefone = NEW.wa_phone
  LIMIT 1;

  IF v_lead_id IS NOT NULL THEN
    NEW.lead_id = v_lead_id;
  END IF;

  RETURN NEW;
END;
$$;
