-- Adiciona parâmetro p_movido_via à função record_stage_history
-- Permite distinguir movimentações via kanban vs. modal manual

CREATE OR REPLACE FUNCTION public.record_stage_history(
  p_lead_id    uuid,
  p_de_stage   uuid,
  p_para_stage uuid,
  p_movido_por uuid DEFAULT NULL::uuid,
  p_movido_via text DEFAULT 'manual'::text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO lead_stage_history (lead_id, de_stage_id, para_stage_id, movido_por, movido_via)
  VALUES (p_lead_id, p_de_stage, p_para_stage, p_movido_por, p_movido_via);
END;
$function$;
