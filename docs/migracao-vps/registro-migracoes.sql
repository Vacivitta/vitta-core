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
-- em `version`, o resto em `name`), SEMPRE como supabase_admin. Na produção
-- (Postgres 15.8) o papel postgres não é superusuário e não grava neste registro
-- (só lê, via pg_read_all_data): o INSERT como postgres dá "permission denied".
-- Isso é proposital — o
-- registro só é tocado pelo mesmo papel que aplica as migrações sensíveis. Exemplo:
--   psql -U supabase_admin -d postgres -c "..."
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

-- Registro só do supabase_admin: nada para a API (anon, authenticated,
-- service_role); postgres não grava
REVOKE ALL ON SCHEMA supabase_migrations FROM PUBLIC, anon, authenticated, service_role, postgres;
REVOKE ALL ON TABLE  supabase_migrations.schema_migrations FROM PUBLIC, anon, authenticated, service_role, postgres;

INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('089', 'baseline: 001-089 conferidas objeto a objeto (diagnóstico Infra 28/10/2026), não registradas uma a uma')
ON CONFLICT (version) DO NOTHING;

-- Guarda: aborta se a API (anon, authenticated, service_role) tiver qualquer
-- acesso ao registro, se postgres puder gravar nele, ou se houver default ACL no
-- schema. postgres continua LENDO o registro: ele é membro de pg_read_all_data na
-- imagem do Supabase (15.8), o que dá leitura em tudo e não se revoga por objeto.
DO $$
DECLARE r text;
BEGIN
  IF current_user <> 'supabase_admin' THEN
    RAISE EXCEPTION 'registro-migracoes: rodar como supabase_admin (atual: %)', current_user;
  END IF;
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF has_schema_privilege(r, 'supabase_migrations', 'USAGE')
       OR has_table_privilege(r, 'supabase_migrations.schema_migrations', 'SELECT')
       OR has_table_privilege(r, 'supabase_migrations.schema_migrations', 'INSERT') THEN
      RAISE EXCEPTION 'registro-migracoes: % tem acesso ao registro', r;
    END IF;
  END LOOP;
  IF has_table_privilege('postgres', 'supabase_migrations.schema_migrations', 'INSERT')
     OR has_table_privilege('postgres', 'supabase_migrations.schema_migrations', 'UPDATE')
     OR has_table_privilege('postgres', 'supabase_migrations.schema_migrations', 'DELETE') THEN
    RAISE EXCEPTION 'registro-migracoes: postgres pode gravar no registro';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_default_acl WHERE defaclnamespace = 'supabase_migrations'::regnamespace) THEN
    RAISE EXCEPTION 'registro-migracoes: há default ACL no schema supabase_migrations';
  END IF;
END $$;
