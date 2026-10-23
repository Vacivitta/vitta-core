#!/usr/bin/env bash
# Etapa 1 — exporta o banco do Supabase gerenciado (origem). Roda NA VPS.
#
# Uso:
#   export SRC_DB_URL='postgresql://postgres.<ref>:<senha>@aws-0-us-east-2.pooler.supabase.com:5432/postgres'
#   bash 01-dump-origem.sh
#
# SRC_DB_URL: Supabase → Project Settings → Database → Connection string
# ("Session pooler", porta 5432). Não versionar nem colar a senha no chat.
#
# Usa a imagem postgres:17 porque o pg_dump precisa ser da mesma versão ou mais
# nova que o servidor de origem (Postgres 17).

set -euo pipefail
: "${SRC_DB_URL:?Defina SRC_DB_URL com a connection string do Supabase de origem}"

OUT=/root/vitta-migracao/$(date +%Y%m%d-%H%M)
mkdir -p "$OUT"
PGDUMP=(docker run --rm -e PGCONNECT_TIMEOUT=20 -v "$OUT:/out" postgres:17 pg_dump "$SRC_DB_URL" --no-owner --no-privileges)

echo "== schema public (estrutura)"
"${PGDUMP[@]}" --schema-only --schema=public --file=/out/01_public_schema.sql

echo "== schema public (dados)"
# cron.job_run_details/net.* ficam de fora (são logs da origem)
"${PGDUMP[@]}" --data-only --schema=public --disable-triggers --file=/out/02_public_data.sql

echo "== auth (usuários e identidades, com hash de senha)"
"${PGDUMP[@]}" --data-only --disable-triggers \
  --table=auth.users --table=auth.identities \
  --file=/out/03_auth_data.sql

echo "== storage (buckets — arquivos são copiados pela etapa 3)"
# INSERT só com colunas comuns: o storage gerenciado tem colunas novas
# (ex.: versioning_status) que a versão do storage na VPS não tem.
docker run --rm -e PGCONNECT_TIMEOUT=20 postgres:17 psql "$SRC_DB_URL" -At -c \
  "SELECT format('INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types) VALUES (%L, %L, %L, %s, %L) ON CONFLICT (id) DO NOTHING;', id, name, public, coalesce(file_size_limit::text, 'NULL'), allowed_mime_types) FROM storage.buckets" \
  > "$OUT/04_storage_buckets.sql"

# O destino é Postgres 15 (imagem do Coolify). O pg_dump 17 emite comandos que o
# psql 15 não conhece: o parâmetro transaction_timeout e os meta-comandos
# \restrict / \unrestrict (proteção contra injeção no restore, pg_dump ≥ 17.6).
# (o "." casa a barra invertida sem depender de escape)
sed -i -e '/^SET transaction_timeout/d' -e '/^.restrict /d' -e '/^.unrestrict /d' "$OUT"/*.sql
# O schema public já existe no Supabase de destino
sed -i '/^CREATE SCHEMA public;$/d' "$OUT/01_public_schema.sql"

ls -lh "$OUT"
echo "Dump salvo em $OUT"
