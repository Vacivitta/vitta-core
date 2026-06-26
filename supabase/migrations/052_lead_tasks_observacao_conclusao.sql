-- Adiciona campo de observação ao concluir/reabrir uma tarefa
ALTER TABLE lead_tasks
  ADD COLUMN IF NOT EXISTS observacao_conclusao TEXT;
