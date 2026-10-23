#!/usr/bin/env bash
# Etapa 2 — restaura o dump no Supabase da VPS (destino). Roda NA VPS.
#
# Uso:
#   bash 02-restaurar-destino.sh /root/vitta-migracao/<pasta-do-dump> <container-do-banco>
#
# <container-do-banco>: nome do container supabase-db do serviço vitta-core no
# Coolify (docker ps | grep supabase-db). O destino deve estar recém-criado.

set -euo pipefail
DUMP_DIR="${1:?Informe a pasta do dump}"
DB="${2:?Informe o container do banco de destino}"
HERE="$(cd "$(dirname "$0")" && pwd)"

psql_dest() { docker exec -i "$DB" psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 "$@"; }

echo "== extensões usadas pelo vitta-core"
psql_dest <<'SQL'
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net    WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_trgm   WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto  WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA extensions;
SQL

echo "== estrutura do schema public"
psql_dest < "$DUMP_DIR/01_public_schema.sql"

echo "== usuários (auth) — antes dos dados de public, por causa das FKs para auth.users"
psql_dest < "$DUMP_DIR/03_auth_data.sql"

echo "== dados do schema public"
psql_dest < "$DUMP_DIR/02_public_data.sql"

echo "== buckets"
psql_dest < "$DUMP_DIR/04_storage_buckets.sql"

echo "== objetos fora de public (trigger de auth, policies de storage, realtime)"
psql_dest < "$HERE/03-objetos-fora-de-public.sql"

echo "Restauração concluída. Próximo passo: copiar arquivos (04-copiar-storage.mjs)."
