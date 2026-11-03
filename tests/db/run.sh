#!/usr/bin/env bash
set -euo pipefail
export LC_ALL=C

raiz="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$raiz"

imagem="${VC_TESTE_IMAGEM:-supabase/postgres:15.8.1.085}"
container="${VC_TESTE_CONTAINER:-vc-teste-db-$$}"
saida="$(mktemp)"

limpar() {
  rm -f "$saida"
  if [[ "${VC_TESTE_MANTER:-}" == 1 ]]; then
    echo "container mantido: $container"
  else
    docker rm -f "$container" >/dev/null 2>&1 || true
  fi
}
trap limpar EXIT

falhar() {
  echo "FALHA: $*" >&2
  exit 1
}

# psql dentro do container, por TCP local (o pg_hba da imagem confia em 127.0.0.1)
psql_como() {
  local papel="$1"
  shift
  docker exec -i -e PGOPTIONS='-c client_min_messages=warning' "$container" \
    psql -h 127.0.0.1 -U "$papel" -d postgres -X -q -v ON_ERROR_STOP=1 "$@"
}

numero() {
  local nome="${1##*/}"
  echo "$((10#${nome:0:3}))"
}

papel_da_migracao() {
  if (($(numero "$1") >= 90)); then echo supabase_admin; else echo postgres; fi
}

aplicar() {
  local papel="$1" arquivo="$2"
  shift 2
  psql_como "$papel" "$@" -f "/migracoes/${arquivo##*/}" >"$saida" 2>&1
}

mapfile -t migracoes < <(find supabase/migrations -maxdepth 1 -name '*.sql' | sort)
((${#migracoes[@]} > 0)) || falhar "nenhuma migração em supabase/migrations"

docker run -d --name "$container" --network none --memory 1g --cpus 1 \
  -e POSTGRES_PASSWORD=somente-teste-local \
  -v "$raiz/supabase/migrations:/migracoes:ro" \
  -v "$raiz/tests/db:/testes:ro" \
  -v "$raiz/docs/migracao-vps/registro-migracoes.sql:/registro-migracoes.sql:ro" \
  "$imagem" >/dev/null

# A imagem sobe um servidor temporário (só socket) para os scripts de init e
# depois o definitivo; só o definitivo escuta em 127.0.0.1.
for _ in $(seq 1 120); do
  docker exec "$container" pg_isready -h 127.0.0.1 -U postgres -q 2>/dev/null && break
  sleep 1
done
docker exec "$container" pg_isready -h 127.0.0.1 -U postgres -q ||
  { docker logs "$container" 2>&1 | tail -30; falhar "Postgres não ficou pronto"; }

psql_como supabase_admin --single-transaction -f /testes/prelude.sql >"$saida" 2>&1 ||
  { cat "$saida"; falhar "prelúdio"; }
echo "ok  prelúdio"

for m in "${migracoes[@]}"; do
  papel="$(papel_da_migracao "$m")"
  aplicar "$papel" "$m" --single-transaction || { cat "$saida"; falhar "migração ${m##*/} (como $papel)"; }
done
echo "ok  ${#migracoes[@]} migrações aplicadas do zero (001-089 como postgres, 090+ como supabase_admin)"

psql_como supabase_admin --single-transaction -f /registro-migracoes.sql >"$saida" 2>&1 ||
  { cat "$saida"; falhar "registro-migracoes.sql"; }
for m in "${migracoes[@]}"; do
  if (($(numero "$m") >= 90)); then
    nome="${m##*/}"
    nome="${nome%.sql}"
    echo "INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES ('${nome%%_*}', '${nome#*_}') ON CONFLICT (version) DO NOTHING;"
  fi
done | psql_como supabase_admin --single-transaction >"$saida" 2>&1 || { cat "$saida"; falhar "registro das versões >= 090"; }
echo "ok  registro de versões"

checagens=0

esperar_erro() {
  local motivo="$1" esperado="$2" papel="$3" arquivo="$4"
  shift 4
  if aplicar "$papel" "supabase/migrations/$arquivo" "$@"; then
    falhar "$arquivo $motivo deveria falhar, mas passou"
  fi
  grep -qF -- "$esperado" "$saida" ||
    { cat "$saida"; falhar "$arquivo $motivo falhou, mas sem a mensagem esperada: $esperado"; }
  checagens=$((checagens + 1))
}

arquivo_da_versao() {
  local achado
  achado="$(find supabase/migrations -maxdepth 1 -name "$1_*.sql" | sort)"
  [[ -n "$achado" && "$achado" != *$'\n'* ]] || falhar "migração $1 não encontrada (ou ambígua)"
  echo "${achado##*/}"
}

for m in "${migracoes[@]}"; do
  (($(numero "$m") >= 90)) || continue
  # A 090 foi substituída pela 118: a guarda dela é anterior à is_gestor() (113)
  [[ "${m##*/}" == 090_* ]] && continue
  aplicar supabase_admin "$m" --single-transaction ||
    { cat "$saida"; falhar "reaplicar ${m##*/} como supabase_admin deveria ser idempotente"; }
  checagens=$((checagens + 1))
done

for v in 091 113 115 116 117 118 119 125; do
  esperar_erro "como postgres" "rodar como supabase_admin" postgres "$(arquivo_da_versao "$v")" --single-transaction
done
for v in 091 092 093 113 115 116 117 118 119 125; do
  esperar_erro "sem --single-transaction" "rode com --single-transaction" supabase_admin "$(arquivo_da_versao "$v")"
done
echo "ok  $checagens checagens de guarda (reaplicação idempotente, papel errado, sem transação única)"

mapfile -t testes < <(find tests/db -maxdepth 1 -name '*.test.sql' | sort)
passaram=0
falharam=()
for t in "${testes[@]}"; do
  if { echo 'BEGIN;'; cat "$t"; printf '\nROLLBACK;\n'; } | psql_como supabase_admin >"$saida" 2>&1; then
    echo "ok  ${t##*/}"
    passaram=$((passaram + 1))
  else
    echo "ERRO ${t##*/}"
    sed 's/^/    /' "$saida"
    falharam+=("${t##*/}")
  fi
done

echo "resumo: ${#migracoes[@]} migrações, $checagens checagens de guarda, $passaram de ${#testes[@]} testes passaram"
((${#falharam[@]} == 0)) || falhar "testes com erro: ${falharam[*]}"
