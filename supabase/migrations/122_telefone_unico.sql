-- 122_telefone_unico.sql
-- Trava contra lead duplicado: um telefone (forma canônica) por unidade.
--
-- Por quê: com telefone_norm (121) a busca passa a casar, mas nada impede dois
-- leads com o mesmo número na mesma unidade (entrada manual, corrida entre duas
-- mensagens do webhook, importação). O webhook já trata o 23505 relendo o lead.
-- Vale também para arquivados: o webhook reativa o arquivado em vez de criar outro.
--
-- Depende da 121. Só aplicar DEPOIS de mesclar os duplicados existentes (em
-- 03/11/2026 eram 2 grupos, 4 leads) pela tela Clientes → Mesclar: se ainda houver
-- duplicados, a guarda aborta e mostra quantos grupos faltam. Para listar:
--   SELECT unit_id, telefone_norm, count(*) FROM public.leads
--    WHERE telefone_norm IS NOT NULL AND unit_id IS NOT NULL GROUP BY 1, 2 HAVING count(*) > 1;
--
-- Aplicar em produção é [H]: o Infra aplica, com aprovação e backup do dia, como
-- supabase_admin, com --single-transaction; depois registra a versão '122'. Sem
-- BEGIN/COMMIT. Idempotente.

SET LOCAL lock_timeout = '5s';

DO $$
DECLARE grupos bigint;
BEGIN
  IF current_setting('lock_timeout') <> '5s' THEN
    RAISE EXCEPTION '122: rode com --single-transaction (lock_timeout atual: %)', current_setting('lock_timeout');
  END IF;
  IF current_user <> 'supabase_admin' THEN
    RAISE EXCEPTION '122: rodar como supabase_admin (atual: %)', current_user;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_attribute
                  WHERE attrelid = 'public.leads'::regclass AND attname = 'telefone_norm' AND NOT attisdropped) THEN
    RAISE EXCEPTION '122: depende da 121 (leads.telefone_norm não existe)';
  END IF;
  SELECT count(*) INTO grupos FROM (
    SELECT 1 FROM public.leads
     WHERE telefone_norm IS NOT NULL AND unit_id IS NOT NULL
     GROUP BY unit_id, telefone_norm
    HAVING count(*) > 1
  ) d;
  IF grupos > 0 THEN
    RAISE EXCEPTION '122: % grupo(s) de leads com o mesmo telefone na mesma unidade; mescle antes de aplicar', grupos;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_leads_unit_telefone_norm
  ON public.leads (unit_id, telefone_norm)
  WHERE telefone_norm IS NOT NULL;
