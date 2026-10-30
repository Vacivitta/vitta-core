-- reversao-116.sql: desfaz a 116 e volta as policies ALL de lead_notes, lead_tasks
-- e quotes (texto de produção, F0-C de 29/10/2026). Só com aprovação, como
-- supabase_admin, com --single-transaction. Sem BEGIN/COMMIT. Depois, remover a
-- linha 116 do registro de versões.

DO $$
DECLARE
  t text;
  regra_unidade constant text :=
    '(( SELECT is_global_admin() AS is_global_admin) OR (unit_id IN ( SELECT user_units.unit_id '
    'FROM user_units WHERE (user_units.user_id = ( SELECT auth.uid() AS uid)))))';
BEGIN
  FOREACH t IN ARRAY ARRAY['lead_notes', 'lead_tasks', 'quotes'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'unit_members_' || t || '_select', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'unit_members_' || t || '_insert', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'unit_members_' || t || '_update', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'unit_members_' || t, t);
    EXECUTE format('CREATE POLICY %I ON public.%I AS PERMISSIVE FOR ALL TO public USING (%s) WITH CHECK (%s)',
                   'unit_members_' || t, t, regra_unidade, regra_unidade);
  END LOOP;
END $$;

DROP POLICY IF EXISTS "autor_ou_gestor_lead_notes_delete"       ON public.lead_notes;
DROP POLICY IF EXISTS "responsavel_ou_gestor_lead_tasks_delete" ON public.lead_tasks;
DROP POLICY IF EXISTS "gestores_quotes_delete"                  ON public.quotes;
