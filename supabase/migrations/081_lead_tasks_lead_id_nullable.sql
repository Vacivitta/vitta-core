-- Permite criar tarefas sem lead vinculado (tarefas internas/administrativas)
ALTER TABLE lead_tasks ALTER COLUMN lead_id DROP NOT NULL;
