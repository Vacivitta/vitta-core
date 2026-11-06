#!/usr/bin/env bash
# Roda no seu computador. Copia o ambiente de teste (com as migrações da branch
# atual) para a VPS e executa o comando lá; no fim baixa as chaves para
# .env.ambiente-teste.local, que o `npm run dev:teste` usa.
# Uso: bash scripts/ambiente-teste/subir.sh [subir|derrubar|resetar|estado]
# Com AMBIENTE_TESTE_ORIGEM=<outra worktree>, usa as migrações dela e grava o
# .env.ambiente-teste.local lá (para testar uma pilha de PRs; mude de origem com resetar).
set -euo pipefail
export LC_ALL=C

raiz="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$raiz"
origem="$(cd "${AMBIENTE_TESTE_ORIGEM:-$raiz}" && pwd)"

host="${AMBIENTE_TESTE_SSH:-vps}"
pasta="ci-ambiente-teste"
comando="${1:-subir}"

pacote="$(mktemp -d)"
trap 'rm -rf "$pacote"' EXIT
cp scripts/ambiente-teste/{compose.yml,nginx.conf,remoto.sh,semente.sql} "$pacote/"
cp "$origem/tests/db/prelude.sql" "$origem/docs/migracao-vps/registro-migracoes.sql" "$pacote/"
mkdir "$pacote/migrations"
cp "$origem"/supabase/migrations/*.sql "$pacote/migrations/"

# O .env da VPS (segredos) fica lá; o resto é substituído a cada execução
ssh "$host" "mkdir -p ~/$pasta && cd ~/$pasta && find . -mindepth 1 -maxdepth 1 ! -name .env -exec rm -rf {} +"
tar -C "$pacote" -cf - . | ssh "$host" "tar -C ~/$pasta -xf -"
ssh "$host" "cd ~/$pasta && SEM_SEMENTE=${SEM_SEMENTE:-} bash remoto.sh $comando"

if [[ "$comando" == subir || "$comando" == resetar ]]; then
  segredos="$(ssh "$host" "cat ~/$pasta/.env")"
  valor() { printf '%s\n' "$segredos" | sed -n "s/^$1=//p"; }
  umask 077
  cat > "$origem/.env.ambiente-teste.local" <<ENV
# Gerado por scripts/ambiente-teste/subir.sh. Só vale para o ambiente de teste
# (túnel SSH para 127.0.0.1:54321 da VPS). Nunca use estas chaves na produção.
NEXT_PUBLIC_SUPABASE_URL=http://localhost:54321
NEXT_PUBLIC_SUPABASE_ANON_KEY=$(valor ANON_KEY)
SUPABASE_SERVICE_ROLE_KEY=$(valor SERVICE_ROLE_KEY)
CRON_SECRET=$(valor CRON_SECRET)
# Usuários de teste (todos com a mesma senha):
# multi@teste.invalid (Itu e Salto), itu@teste.invalid (só Itu),
# gestor@teste.invalid (gestor de Itu), admin@teste.invalid (admin da marca)
AMBIENTE_TESTE_SENHA=$(valor SENHA_USUARIOS)
ENV
  echo "ok  chaves em $origem/.env.ambiente-teste.local"
fi
