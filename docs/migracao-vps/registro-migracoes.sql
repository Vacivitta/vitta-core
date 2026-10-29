-- registro-migracoes.sql
-- Cria o registro de versões das migrações do VittaCore na produção (VPS), que
-- não existe desde a migração para o Supabase auto-hospedado (26/10/2026).
--
-- NÃO é uma migração numerada: o schema supabase_migrations pertence ao formato
-- da CLI do Supabase. Fica em docs/ e é aplicado UMA vez pelo Infra, com aprovação
-- humana, como supabase_admin:
--   psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 --single-transaction -f registro-migracoes.sql
--
-- Linha de base: as migrações 001–089 NÃO são registradas uma a uma. A 085 foi
-- aplicada só em parte (os REVOKE não tiveram efeito) e algumas não rodam num
-- banco do zero; marcá-las como aplicadas seria falso. O estado de 001–089 é o
-- conferido objeto a objeto no diagnóstico do Infra de 28/10/2026.
--
-- Daí em diante, cada migração aplicada registra a própria versão (só o número
-- em `version`, o resto em `name`), por exemplo:
--   INSERT INTO supabase_migrations.schema_migrations (version, name)
--   VALUES ('090', 'function_execute_grants') ON CONFLICT (version) DO NOTHING;
--
-- NUNCA usar a CLI do Supabase (db push, migration repair, db reset) contra a
-- produção: ela não vê 001–089 na tabela e tentaria aplicá-las.
--
-- Idempotente. Sem BEGIN/COMMIT (usa a transação do --single-transaction).

CREATE SCHEMA IF NOT EXISTS supabase_migrations;

CREATE TABLE IF NOT EXISTS supabase_migrations.schema_migrations (
  version    text PRIMARY KEY,
  name       text,
  statements text[]
);

-- Registro só para o banco: nada de acesso pela API (anon/authenticated)
REVOKE ALL ON SCHEMA supabase_migrations FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE  supabase_migrations.schema_migrations FROM PUBLIC, anon, authenticated;

INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('089', 'baseline: 001-089 conferidas objeto a objeto (diagnóstico Infra 28/10/2026), não registradas uma a uma')
ON CONFLICT (version) DO NOTHING;

-- Guarda: aborta se a API conseguir ler o registro
DO $$
BEGIN
  IF has_table_privilege('anon', 'supabase_migrations.schema_migrations', 'SELECT')
     OR has_table_privilege('authenticated', 'supabase_migrations.schema_migrations', 'SELECT') THEN
    RAISE EXCEPTION 'registro-migracoes: schema_migrations legível por anon/authenticated';
  END IF;
END $$;
