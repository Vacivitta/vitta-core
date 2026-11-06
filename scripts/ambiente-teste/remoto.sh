#!/usr/bin/env bash
# Roda na VPS, dentro da pasta do ambiente (scripts/ambiente-teste/subir.sh copia
# tudo para lá). Uso: remoto.sh subir | derrubar | resetar | estado
set -euo pipefail
export LC_ALL=C
cd "$(dirname "${BASH_SOURCE[0]}")"

projeto=ci-ambiente-teste
banco=ci-ambiente-teste-db

falhar() { echo "FALHA: $*" >&2; exit 1; }
compose() { docker compose -p "$projeto" -f compose.yml "$@"; }
psql_como() {
  local papel="$1"; shift
  docker exec -i -e PGOPTIONS='-c client_min_messages=warning' "$banco" \
    psql -h 127.0.0.1 -U "$papel" -d postgres -X -q -v ON_ERROR_STOP=1 "$@"
}

b64url() { openssl base64 -A | tr '+/' '-_' | tr -d '='; }
jwt() {
  local papel="$1" agora cabecalho carga assinatura
  agora=$(date +%s)
  cabecalho=$(printf '{"alg":"HS256","typ":"JWT"}' | b64url)
  carga=$(printf '{"role":"%s","iss":"supabase","iat":%d,"exp":%d}' "$papel" "$agora" $((agora + 315360000)) | b64url)
  assinatura=$(printf '%s.%s' "$cabecalho" "$carga" | openssl dgst -sha256 -hmac "$JWT_SECRET" -binary | b64url)
  printf '%s.%s.%s' "$cabecalho" "$carga" "$assinatura"
}
aleatorio() { openssl rand -base64 48 | tr -dc 'A-Za-z0-9' | head -c "$1"; }

gerar_segredos() {
  [[ -f .env ]] && return
  umask 077
  JWT_SECRET=$(aleatorio 48)
  {
    echo "SENHA_BANCO=$(aleatorio 32)"
    echo "JWT_SECRET=$JWT_SECRET"
    echo "CHAVE_REALTIME=$(aleatorio 64)"
    echo "ANON_KEY=$(jwt anon)"
    echo "SERVICE_ROLE_KEY=$(jwt service_role)"
    echo "CRON_SECRET=$(aleatorio 32)"
    echo "SENHA_USUARIOS=$(aleatorio 20)"
  } > .env
}

esperar() {
  local descricao="$1"; shift
  for _ in $(seq 1 120); do "$@" >/dev/null 2>&1 && return 0; sleep 1; done
  falhar "$descricao não ficou pronto"
}

numero() { local nome="${1##*/}"; echo "$((10#${nome:0:3}))"; }

migrar() {
  if [[ "$(psql_como supabase_admin -tAc "select to_regclass('public.units') is not null")" == t ]]; then
    echo "ok  banco já migrado"
    return
  fi
  psql_como supabase_admin --single-transaction < prelude.sql || falhar "prelúdio"
  local m papel
  for m in $(find migrations -maxdepth 1 -name '*.sql' | sort); do
    if (($(numero "$m") >= 90)); then papel=supabase_admin; else papel=postgres; fi
    psql_como "$papel" --single-transaction < "$m" || falhar "migração ${m##*/} (como $papel)"
  done
  psql_como supabase_admin --single-transaction < registro-migracoes.sql || falhar "registro-migracoes.sql"
  for m in $(find migrations -maxdepth 1 -name '*.sql' | sort); do
    (($(numero "$m") >= 90)) || continue
    local nome="${m##*/}"; nome="${nome%.sql}"
    echo "INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES ('${nome%%_*}', '${nome#*_}') ON CONFLICT (version) DO NOTHING;"
  done | psql_como supabase_admin --single-transaction
  echo "ok  migrações aplicadas: $(find migrations -maxdepth 1 -name '*.sql' | wc -l)"
}

criar_usuario() {
  local email="$1" nome="$2" resposta
  resposta=$(psql_como supabase_admin -tAc "select id from auth.users where email = '$email'")
  if [[ -n "$resposta" ]]; then echo "$resposta"; return; fi
  resposta=$(curl -sS -X POST http://127.0.0.1:54321/auth/v1/admin/users \
    -H "Authorization: Bearer $SERVICE_ROLE_KEY" -H "apikey: $SERVICE_ROLE_KEY" -H 'Content-Type: application/json' \
    -d "$(jq -n --arg e "$email" --arg p "$SENHA_USUARIOS" --arg n "$nome" \
          '{email: $e, password: $p, email_confirm: true, user_metadata: {full_name: $n}}')")
  echo "$resposta" | jq -er .id || falhar "criar $email: $resposta"
}

semear() {
  [[ -n "${SEM_SEMENTE:-}" ]] && return
  if [[ "$(psql_como supabase_admin -tAc "select count(*) from public.tenants where id = '00000000-0000-4000-9000-0000000000f0'")" != 0 ]]; then
    echo "ok  dados de teste já existem"
    return
  fi
  local multi itu gestor admin
  multi=$(criar_usuario multi@teste.invalid 'Ana Duas Unidades')
  itu=$(criar_usuario itu@teste.invalid 'Bia Só Itu')
  gestor=$(criar_usuario gestor@teste.invalid 'Caio Gestor Itu')
  admin=$(criar_usuario admin@teste.invalid 'Dora Admin Marca')
  psql_como supabase_admin --single-transaction \
    -v multi="$multi" -v itu="$itu" -v gestor="$gestor" -v admin="$admin" < semente.sql || falhar "semente.sql"
  echo "ok  dados de teste criados"
}

subir() {
  gerar_segredos
  set -a; source .env; set +a
  compose up -d db
  esperar "Postgres" docker exec "$banco" pg_isready -h 127.0.0.1 -U postgres -q
  psql_como supabase_admin <<SQL
ALTER ROLE authenticator WITH PASSWORD '$SENHA_BANCO';
ALTER ROLE supabase_auth_admin WITH PASSWORD '$SENHA_BANCO';
CREATE SCHEMA IF NOT EXISTS _realtime AUTHORIZATION supabase_admin;
SQL
  compose up -d auth
  esperar "GoTrue (migrações do auth)" bash -c "docker logs $projeto-auth 2>&1 | grep -q 'GoTrue API started'"
  migrar
  compose up -d rest realtime
  compose up -d --force-recreate gateway
  esperar "gateway" curl -sf http://127.0.0.1:54321/auth/v1/health
  esperar "PostgREST" curl -sf http://127.0.0.1:54321/rest/v1/ -H "apikey: $ANON_KEY" -H "Authorization: Bearer $ANON_KEY"
  semear
  echo "ok  ambiente de teste no ar em 127.0.0.1:54321 (VPS)"
}

case "${1:-}" in
  subir)    subir ;;
  derrubar) compose down ;;
  resetar)  compose down -v; rm -f .env; subir ;;
  estado)   compose ps ;;
  *)        falhar "uso: remoto.sh subir | derrubar | resetar | estado" ;;
esac
