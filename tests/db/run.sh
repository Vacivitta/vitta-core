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
  # Dados no formato antigo para a migração que os converte (ex.: dados_antes_126.sql)
  nome="${m##*/}"
  dados="tests/db/dados_antes_${nome%%_*}.sql"
  if [[ -f "$dados" ]]; then
    psql_como supabase_admin --single-transaction -f "/testes/${dados##*/}" >"$saida" 2>&1 ||
      { cat "$saida"; falhar "${dados##*/}"; }
  fi
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

# ── Ordem pós-restore (CLAUDE.md, "After any database restore", e runbook) ───
# O restore recria as funções com o privilégio padrão (EXECUTE para authenticated;
# anon fechado pela 091), sem os REVOKE das migrações. Simula isso, reaplica a
# ordem documentada, cada uma como o Infra aplica, e confere que o banco volta
# exatamente ao estado de antes: privilégios e definição de toda função e view
# do public. Mudou a ordem aqui, mude no CLAUDE.md e no runbook (conferido abaixo).
ordem_pos_restore=(113 115 121 123 124 126 127 128 129 130 131 132 133 134 135 137 138 141 143 144 145 146 147 148 149 150 151 118)
texto_ordem="$(printf '%s, ' "${ordem_pos_restore[@]}")"
texto_ordem="${texto_ordem%, }"
for doc in CLAUDE.md docs/migracao-vps/runbook.md; do
  # O run.sh também roda de um recorte do repositório (só migrações e testes)
  [[ -f "$doc" ]] || continue
  grep -qF -- "$texto_ordem" "$doc" || falhar "$doc não traz a ordem pós-restore testada: $texto_ordem"
done

estado_do_banco() {
  cat <<SQL
INSERT INTO zz_pos_restore.estado
SELECT '$1', 'função ' || p.oid::regprocedure::text,
       concat_ws(' ',
         CASE WHEN has_function_privilege('anon', p.oid, 'EXECUTE') THEN 'anon' END,
         CASE WHEN has_function_privilege('authenticated', p.oid, 'EXECUTE') THEN 'authenticated' END,
         CASE WHEN has_function_privilege('service_role', p.oid, 'EXECUTE') THEN 'service_role' END),
       md5(pg_get_functiondef(p.oid))
  FROM pg_proc p
 WHERE p.pronamespace = 'public'::regnamespace AND p.prokind IN ('f', 'p')
UNION ALL
SELECT '$1', 'view ' || c.oid::regclass::text,
       concat_ws(' ',
         CASE WHEN has_table_privilege('anon', c.oid, 'SELECT') THEN 'anon' END,
         CASE WHEN has_table_privilege('authenticated', c.oid, 'SELECT') THEN 'authenticated' END),
       md5(pg_get_viewdef(c.oid))
  FROM pg_class c
 WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'v';
SQL
}

{
  echo 'DROP SCHEMA IF EXISTS zz_pos_restore CASCADE;'
  echo 'CREATE SCHEMA zz_pos_restore;'
  echo 'CREATE TABLE zz_pos_restore.estado (momento text, objeto text, acesso text, definicao text);'
  estado_do_banco antes
  # O "restore": toda função volta executável por authenticated; as views de
  # leads voltam legíveis por anon
  echo 'GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO authenticated;'
  echo 'GRANT SELECT ON public.leads_kanban, public.leads_arquivados TO anon;'
} | psql_como supabase_admin --single-transaction >"$saida" 2>&1 || { cat "$saida"; falhar "simular o restore"; }

# Por que a 118 não pode ir primeiro: a guarda dela recusa as SECURITY DEFINER
# das migrações posteriores (mesclar_leads, tags, anexos...) reabertas
esperar_erro "logo depois do restore" "118: executáveis por authenticated fora das permitidas" \
  supabase_admin "$(arquivo_da_versao 118)" --single-transaction

for v in "${ordem_pos_restore[@]}"; do
  aplicar supabase_admin "$(arquivo_da_versao "$v")" --single-transaction ||
    { cat "$saida"; falhar "ordem pós-restore ($texto_ordem): $(arquivo_da_versao "$v") abortou"; }
done

{
  estado_do_banco depois
  cat <<'SQL'
DO $$
DECLARE diferencas text;
BEGIN
  SELECT string_agg(format('%s: antes [%s] depois [%s]%s', objeto, a.acesso, d.acesso,
                           CASE WHEN a.definicao IS DISTINCT FROM d.definicao THEN ' (definição mudou)' ELSE '' END),
                    E'\n' ORDER BY objeto)
    INTO diferencas
    FROM (SELECT * FROM zz_pos_restore.estado WHERE momento = 'antes') a
    FULL JOIN (SELECT * FROM zz_pos_restore.estado WHERE momento = 'depois') d USING (objeto)
   WHERE a.acesso IS DISTINCT FROM d.acesso OR a.definicao IS DISTINCT FROM d.definicao;
  IF diferencas IS NOT NULL THEN
    RAISE EXCEPTION E'a ordem pós-restore não devolveu o banco ao estado de antes:\n%', diferencas;
  END IF;
END $$;
DROP SCHEMA zz_pos_restore CASCADE;
SQL
} | psql_como supabase_admin --single-transaction >"$saida" 2>&1 ||
  { cat "$saida"; falhar "ordem pós-restore ($texto_ordem) não restaurou privilégios e definições"; }
checagens=$((checagens + 1))
echo "ok  ordem pós-restore $texto_ordem: 118 antes delas aborta; depois do restore simulado, privilégios e definições voltam"

for v in 091 113 115 116 117 118 119 120 121 122 123 124 125 126 127 128 129 130 131 132 133 134 135 136 137 138 139 140 141 142 143 144 145 146 147 148 149 150 151; do
  esperar_erro "como postgres" "rodar como supabase_admin" postgres "$(arquivo_da_versao "$v")" --single-transaction
done
for v in 091 092 093 113 115 116 117 118 119 120 121 122 123 124 125 126 127 128 129 130 131 132 133 134 135 136 137 138 139 140 141 142 143 144 145 146 147 148 149 150 151; do
  esperar_erro "sem --single-transaction" "rode com --single-transaction" supabase_admin "$(arquivo_da_versao "$v")"
done

v122="$(arquivo_da_versao 122)"
if {
  cat <<'SQL'
BEGIN;
DROP INDEX IF EXISTS public.uq_leads_unit_telefone_norm;
DROP INDEX IF EXISTS public.uq_contatos_unit_telefone;
INSERT INTO public.tenants (id, nome) VALUES ('00000000-0000-4000-8122-0000000000f0', 'Rede 122');
INSERT INTO public.units (id, tenant_id, nome, tipo)
VALUES ('00000000-0000-4000-8122-0000000000a0', '00000000-0000-4000-8122-0000000000f0', 'Unidade 122', 'clinica');
INSERT INTO public.funnels (id, nome, unit_id)
VALUES ('00000000-0000-4000-8122-0000000000d0', 'Funil 122', '00000000-0000-4000-8122-0000000000a0');
INSERT INTO public.leads (nome, telefone, funnel_id, unit_id) VALUES
  ('Um', '(31) 99667-4494', '00000000-0000-4000-8122-0000000000d0', '00000000-0000-4000-8122-0000000000a0'),
  ('Dois', '5531996674494', '00000000-0000-4000-8122-0000000000d0', '00000000-0000-4000-8122-0000000000a0');
SQL
  echo "\\i /migracoes/$v122"
  echo 'ROLLBACK;'
} | psql_como supabase_admin >"$saida" 2>&1; then
  falhar "$v122 com leads duplicados deveria abortar, mas passou"
fi
grep -qF "122: 1 grupo(s) de leads com o mesmo telefone" "$saida" ||
  { cat "$saida"; falhar "$v122 com leads duplicados falhou, mas sem a mensagem esperada"; }
checagens=$((checagens + 1))

v135="$(arquivo_da_versao 135)"
if {
  cat <<'SQL'
BEGIN;
ALTER TABLE public.sales_goals DROP CONSTRAINT sales_goals_unit_id_user_id_month_key;
INSERT INTO public.tenants (id, nome) VALUES ('00000000-0000-4000-8135-0000000000f0', 'Rede 135');
INSERT INTO public.units (id, tenant_id, nome, tipo)
VALUES ('00000000-0000-4000-8135-0000000000a0', '00000000-0000-4000-8135-0000000000f0', 'Unidade 135', 'clinica');
INSERT INTO public.sales_goals (unit_id, user_id, month, target) VALUES
  ('00000000-0000-4000-8135-0000000000a0', NULL, '2026-11-01', 100),
  ('00000000-0000-4000-8135-0000000000a0', NULL, '2026-11-01', 200);
SQL
  echo "\\i /migracoes/$v135"
  echo 'ROLLBACK;'
} | psql_como supabase_admin >"$saida" 2>&1; then
  falhar "$v135 com metas repetidas deveria abortar, mas passou"
fi
grep -qF "135: 1 grupo(s) de metas repetidas" "$saida" ||
  { cat "$saida"; falhar "$v135 com metas repetidas falhou, mas sem a mensagem esperada"; }
checagens=$((checagens + 1))
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
