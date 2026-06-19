-- ── Fatia 05: Distribuição automática de conversas ───────────────────────────

ALTER TABLE wa_queues
  ADD COLUMN IF NOT EXISTS auto_assign         BOOLEAN  DEFAULT false,
  ADD COLUMN IF NOT EXISTS distribution_method TEXT     DEFAULT 'round_robin',
  ADD COLUMN IF NOT EXISTS max_per_agent       INT      DEFAULT 10,
  ADD COLUMN IF NOT EXISTS last_assigned_agent UUID     REFERENCES profiles(id) ON DELETE SET NULL;

-- ── RPC: estatísticas por agente para o Dashboard de Atendimento ─────────────

CREATE OR REPLACE FUNCTION get_agent_stats(p_unit_id UUID)
RETURNS TABLE(
  agent_id            UUID,
  open_count          BIGINT,
  resolved_today      BIGINT,
  avg_response_minutes NUMERIC
) LANGUAGE sql STABLE SECURITY DEFINER AS $$
  WITH response_times AS (
    SELECT
      c.assigned_to,
      EXTRACT(EPOCH FROM (
        MAX(CASE WHEN m.direction = 'outbound' THEN m.created_at END) -
        MAX(CASE WHEN m.direction = 'inbound'  THEN m.created_at END)
      )) / 60 AS resp_minutes
    FROM wa_conversations c
    JOIN wa_messages m ON m.conversation_id = c.id
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
  FROM profiles p
  LEFT JOIN wa_conversations c  ON c.assigned_to = p.id AND c.unit_id = p.unit_id
  LEFT JOIN response_times   rt ON rt.assigned_to = p.id
  WHERE p.unit_id = p_unit_id
    AND p.perfil  = 'atendente'
  GROUP BY p.id
$$;
