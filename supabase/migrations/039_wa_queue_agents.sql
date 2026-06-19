-- Vínculo entre agentes e filas de atendimento
-- Se uma fila não tiver entradas aqui, todos os atendentes da unidade são elegíveis
CREATE TABLE wa_queue_agents (
  queue_id  UUID NOT NULL REFERENCES wa_queues(id) ON DELETE CASCADE,
  agent_id  UUID NOT NULL REFERENCES profiles(id)  ON DELETE CASCADE,
  PRIMARY KEY (queue_id, agent_id)
);

ALTER TABLE wa_queue_agents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "unit members can manage queue agents"
  ON wa_queue_agents FOR ALL
  USING (
    queue_id IN (
      SELECT id FROM wa_queues
      WHERE unit_id IN (
        SELECT unit_id FROM profiles WHERE id = auth.uid()
      )
    )
  );
