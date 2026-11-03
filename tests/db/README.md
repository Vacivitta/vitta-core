# Testes de banco

Monta o banco do zero a partir de `supabase/migrations`, numa imagem
`supabase/postgres` igual à da produção, e confere o comportamento de RLS,
privilégios e guardas. Nada daqui vai para a produção. Roda no CI em todo PR
(job `db` de `.github/workflows/ci.yml`).

## Como rodar

Precisa de bash e Docker (Linux; no Windows, rode numa máquina Linux ou no CI).
Da raiz do repositório:

```bash
bash tests/db/run.sh        # ou: npm run test:db
```

Leva cerca de 1 minuto depois que a imagem está baixada. O container sobe com
`--network none` e é apagado no fim. Variáveis opcionais: `VC_TESTE_IMAGEM`,
`VC_TESTE_CONTAINER` e `VC_TESTE_MANTER=1` (mantém o container para investigar
com `docker exec -it <nome> psql -h 127.0.0.1 -U supabase_admin -d postgres`).

O `run.sh`, em ordem:

1. aplica `prelude.sql` como `supabase_admin`;
2. aplica cada migração em ordem (`LC_ALL=C sort`) com `--single-transaction` e
   `ON_ERROR_STOP`: 001–089 como `postgres`, 090 em diante como `supabase_admin`,
   como o Infra aplica em produção. Para no primeiro erro, mostrando o arquivo;
3. aplica `docs/migracao-vps/registro-migracoes.sql` e registra as versões ≥ 090
   (sempre depois da 089: a 037b e a 066b abortam se o registro já existir);
4. checa as guardas: toda migração ≥ 090 reaplicada como `supabase_admin` passa
   (idempotente), e as que exigem papel ou transação única falham com a
   mensagem certa quando rodadas como `postgres` ou sem `--single-transaction`.
   Exceção conhecida: a 090 reaplicada depois da 113 aborta, porque a guarda dela
   não conhece `is_gestor()`;
5. roda `tests/db/*.test.sql` em ordem, como `supabase_admin`.

## O que o prelúdio faz e por quê

Supre o que a produção tem fora das migrações:

- `pg_cron` e `pg_net` (a 089 agenda um job no cron);
- colunas de `storage.buckets`/`storage.objects` que o serviço storage-api cria
  na produção; a imagem traz só a versão inicial dessas tabelas, e 015, 046, 064
  e 076 precisam delas;
- `auth.uid()` e `auth.role()` no formato do GoTrue atual, que leem
  `request.jwt.claims` (a imagem traz a versão antiga, que só lê
  `request.jwt.claim.sub`).

## Escrever um teste novo

Crie `tests/db/NNN_assunto.test.sql`. O arquivo roda dentro de uma transação que
é desfeita no fim, então pode criar dados, funções em `pg_temp` e até remover
triggers sem afetar os outros testes. Use dados fictícios (e-mails
`@teste.invalid`). Uma falha é uma exceção com mensagem que diga o que se
esperava:

```sql
DO $$
BEGIN
  IF has_function_privilege('anon', 'public.minha_funcao()', 'EXECUTE') THEN
    RAISE EXCEPTION 'minha_funcao executável por anon';
  END IF;
END $$;
```

Para agir como um usuário logado, veja `pg_temp.como(papel, usuario, comando)` em
`030_permissoes.test.sql`: roda o comando com `SET LOCAL ROLE` e
`request.jwt.claims` numa subtransação desfeita e devolve as linhas afetadas ou
`erro <sqlstate>`.
