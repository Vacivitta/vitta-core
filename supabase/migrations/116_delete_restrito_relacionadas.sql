-- 116_delete_restrito_relacionadas.sql
-- RLS: DELETE restrito em lead_notes, lead_tasks e quotes (SELECT/INSERT/UPDATE iguais).
--
-- Por quê: cada tabela tinha 1 policy ALL "admin global OU unidade vinculada"
-- (leitura do Infra, F0-C, 29/10/2026), então qualquer membro da unidade apagava
-- nota, tarefa e orçamento de qualquer pessoa direto pelo PostgREST. O Pedro
-- aprovou restringir o DELETE. A regra de cada tabela mantém o que a tela já faz:
--   lead_notes:  autor da nota, gestor da unidade ou admin global
--                (a tela só mostra Excluir para o autor: LeadModal, isOwn)
--   lead_tasks:  responsável pela tarefa, tarefa sem responsável, gestor da
--                unidade ou admin global (a tela passa a esconder Excluir nos demais)
--   quotes:      gestor da unidade ou admin global (a tela já só mostra para
--                gestor: OrcamentosClient, canDelete)
--   quote_items: SEM mudança. Editar um orçamento apaga e regrava os itens
--                (QuoteModal), e o atendente edita orçamentos.
-- Gestor = is_gestor() da 113 (admin, gestor_vacivitta, gestor_unidade).
-- service_role ignora RLS e não muda.
--
-- Cada policy ALL vira 4 policies por comando. SELECT, INSERT e UPDATE ficam com
-- o MESMO texto da policy ALL atual (USING e WITH CHECK).
--
-- Depende da 113 (is_gestor). Aplicar em produção é [H]: o Infra aplica, com
-- aprovação e backup do dia, como supabase_admin, com --single-transaction;
-- depois registra a versão 116. Sem BEGIN/COMMIT. Idempotente.
-- Reversão: docs/migracao-vps/reversao-116.sql (volta as 3 policies ALL).

SET LOCAL lock_timeout = '5s';

DO $$
BEGIN
  IF current_setting('lock_timeout') <> '5s' THEN
    RAISE EXCEPTION '116: rode com --single-transaction (lock_timeout atual: %)', current_setting('lock_timeout');
  END IF;
  IF current_user <> 'supabase_admin' THEN
    RAISE EXCEPTION '116: rodar como supabase_admin (atual: %)', current_user;
  END IF;
  IF to_regprocedure('public.is_gestor()') IS NULL THEN
    RAISE EXCEPTION '116: depende da 113 (função is_gestor() não existe)';
  END IF;
END $$;

-- Recria, para cada tabela, as policies por comando. SELECT, INSERT e UPDATE com o
-- texto exato da policy ALL de produção; DELETE com a regra nova.
DO $$
DECLARE
  t text;
  regra_unidade constant text :=
    '(( SELECT is_global_admin() AS is_global_admin) OR (unit_id IN ( SELECT user_units.unit_id '
    'FROM user_units WHERE (user_units.user_id = ( SELECT auth.uid() AS uid)))))';
BEGIN
  FOREACH t IN ARRAY ARRAY['lead_notes', 'lead_tasks', 'quotes'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'unit_members_' || t, t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'unit_members_' || t || '_select', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'unit_members_' || t || '_insert', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'unit_members_' || t || '_update', t);
    EXECUTE format('CREATE POLICY %I ON public.%I AS PERMISSIVE FOR SELECT TO public USING (%s)',
                   'unit_members_' || t || '_select', t, regra_unidade);
    EXECUTE format('CREATE POLICY %I ON public.%I AS PERMISSIVE FOR INSERT TO public WITH CHECK (%s)',
                   'unit_members_' || t || '_insert', t, regra_unidade);
    EXECUTE format('CREATE POLICY %I ON public.%I AS PERMISSIVE FOR UPDATE TO public USING (%s) WITH CHECK (%s)',
                   'unit_members_' || t || '_update', t, regra_unidade, regra_unidade);
  END LOOP;
END $$;

DROP POLICY IF EXISTS "autor_ou_gestor_lead_notes_delete" ON public.lead_notes;
CREATE POLICY "autor_ou_gestor_lead_notes_delete" ON public.lead_notes AS PERMISSIVE FOR DELETE TO public
  USING (
    (SELECT is_global_admin())
    OR (unit_id IN (SELECT unit_id FROM user_units WHERE user_id = (SELECT auth.uid()))
        AND (autor_id = (SELECT auth.uid()) OR (SELECT is_gestor())))
  );

DROP POLICY IF EXISTS "responsavel_ou_gestor_lead_tasks_delete" ON public.lead_tasks;
CREATE POLICY "responsavel_ou_gestor_lead_tasks_delete" ON public.lead_tasks AS PERMISSIVE FOR DELETE TO public
  USING (
    (SELECT is_global_admin())
    OR (unit_id IN (SELECT unit_id FROM user_units WHERE user_id = (SELECT auth.uid()))
        AND (responsavel_id = (SELECT auth.uid()) OR responsavel_id IS NULL OR (SELECT is_gestor())))
  );

DROP POLICY IF EXISTS "gestores_quotes_delete" ON public.quotes;
CREATE POLICY "gestores_quotes_delete" ON public.quotes AS PERMISSIVE FOR DELETE TO public
  USING (
    (SELECT is_global_admin())
    OR (unit_id IN (SELECT unit_id FROM user_units WHERE user_id = (SELECT auth.uid()))
        AND (SELECT is_gestor()))
  );

-- Guarda: policies se somam (OR). Se sobrar qualquer outra PERMISSIVE de
-- DELETE/ALL nessas tabelas (por exemplo, criada fora das migrações), a regra não
-- vale. Aborta nesse caso.
DO $$
DECLARE outras text;
BEGIN
  SELECT string_agg(tablename || '.' || policyname, ', ') INTO outras
    FROM pg_policies
   WHERE schemaname = 'public'
     AND tablename IN ('lead_notes', 'lead_tasks', 'quotes')
     AND cmd IN ('DELETE', 'ALL') AND permissive = 'PERMISSIVE'
     AND policyname NOT IN ('autor_ou_gestor_lead_notes_delete',
                            'responsavel_ou_gestor_lead_tasks_delete',
                            'gestores_quotes_delete');
  IF outras IS NOT NULL THEN
    RAISE EXCEPTION '116: outras policies de DELETE/ALL anulariam a regra: %', outras;
  END IF;
END $$;
