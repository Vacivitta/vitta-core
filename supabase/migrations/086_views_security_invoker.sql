-- 086_views_security_invoker.sql
-- leads_kanban e leads_arquivados eram views "security definer" (padrão do Postgres:
-- rodam com as permissões do dono, postgres) e ignoravam o RLS de leads. Como anon
-- tinha SELECT, a chave pública lia todos os leads de todas as unidades.
-- Com security_invoker, o RLS das tabelas base vale para quem consulta.

ALTER VIEW leads_kanban     SET (security_invoker = true);
ALTER VIEW leads_arquivados SET (security_invoker = true);

REVOKE ALL ON leads_kanban, leads_arquivados FROM anon;
