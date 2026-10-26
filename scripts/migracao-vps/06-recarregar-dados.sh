#!/usr/bin/env bash
# Etapa da troca — recarrega só os DADOS num destino que já tem a estrutura (o do ensaio).
# Roda NA VPS. Usar quando a estrutura de public na origem for igual à do destino
# (conferir com diff do 01_public_schema.sql; na troca de 26/10/2026 eram idênticas).
#
# Uso:
#   bash 06-recarregar-dados.sh /root/vitta-migracao/<pasta-do-dump> <container-do-banco>
#
# Esvazia todas as tabelas de public e os usuários do auth e carrega o dump novo.
# Mantém o que fica fora de public (policies de storage, publicação do Realtime,
# trigger de auth, buckets e arquivos já copiados).

set -euo pipefail
DUMP_DIR="${1:?Informe a pasta do dump}"
DB="${2:?Informe o container do banco de destino}"

psql_dest() { docker exec -i "$DB" psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 "$@"; }

echo "== esvaziando public e auth.users"
psql_dest <<'SQL'
DO $$
DECLARE lista text;
BEGIN
  SELECT string_agg(format('public.%I', tablename), ', ') INTO lista
    FROM pg_tables WHERE schemaname = 'public';
  EXECUTE 'TRUNCATE ' || lista || ' RESTART IDENTITY CASCADE';
  TRUNCATE auth.users CASCADE;
END $$;
SQL

echo "== usuários (auth)"
psql_dest < "$DUMP_DIR/03_auth_data.sql"

echo "== dados de public"
psql_dest < "$DUMP_DIR/02_public_data.sql"

echo "== buckets (ignora os que já existem)"
psql_dest < "$DUMP_DIR/04_storage_buckets.sql"

echo "Dados recarregados. Próximo passo: 04-copiar-storage.mjs (delta) e 05-pos-migracao.sql."
