-- 136_notificacoes_por_pessoa.sql
-- Notificação pessoal só para quem a recebe, e leitura por pessoa.
--
-- Por quê:
--   - A regra de leitura de notifications (067, redefinida pela 092) libera
--     qualquer notificação das unidades vinculadas, inclusive as pessoais
--     (user_id preenchido: menção, orçamento aceito, recusado, vencendo). O sino
--     (NotificationBell) carrega tudo sem filtro, então cada atendente via as
--     menções e os orçamentos das colegas. Em 05/11/2026, 374 de 376
--     notificações da produção eram pessoais e visíveis a colegas.
--   - `lida` é um booleano da notificação: no aviso da unidade (user_id NULL),
--     a primeira pessoa que clica marca como lido para todo mundo.
--   - A regra de UPDATE deixava qualquer membro da unidade (e anon tinha o
--     privilégio) reescrever título e texto de qualquer notificação visível.
--
-- O que faz:
--   1. notification_reads (notification_id, user_id, lida_em): uma linha por
--      pessoa que leu. RLS: cada um lê e grava só as próprias leituras, e só de
--      notificações que consegue ver. Sem UPDATE nem DELETE pelo app.
--   2. Converte o que já estava lido: notificação pessoal lida vira leitura do
--      destinatário; aviso da unidade lido vira leitura de quem estava na
--      unidade (não dá para saber quem leu, e ninguém recebe de volta como não
--      lido um aviso antigo).
--   3. Nova regra de leitura de notifications: a pessoal só para o destinatário
--      (nem o admin da marca vê a de outra pessoa: o sino é pessoal, e o item a
--      que ela aponta continua visível pelo funil); o aviso da unidade para quem
--      está vinculado a ela e para o admin da marca, como antes.
--   4. Tira UPDATE, INSERT e DELETE de anon e authenticated, e SELECT de anon.
--      Notificações nascem no servidor (service_role, triggers e funções
--      SECURITY DEFINER), que não dependem desses privilégios.
--
-- A coluna `lida` fica, sem uso pelo app desta versão, para o app anterior não
-- quebrar entre a migração e o deploy (ele só deixa de conseguir marcar como
-- lida). Sai numa migração seguinte, depois do deploy.
--
-- Aplicar em produção é [H]: o Infra aplica, com aprovação e backup do dia, como
-- supabase_admin, com --single-transaction; depois registra a versão '136' e roda
-- notify pgrst, 'reload schema'. Sem BEGIN/COMMIT. Idempotente.
--
-- Reversão (o app desta versão para de marcar como lida sem a tabela):
--   DROP TABLE IF EXISTS public.notification_reads;
--   DROP POLICY IF EXISTS "notifications_select" ON public.notifications;
--   CREATE POLICY "unit_members_notifications_select" ON public.notifications FOR SELECT
--     USING ((SELECT is_global_admin()) OR unit_id IN (SELECT unit_id FROM user_units WHERE user_id = (SELECT auth.uid())));
--   GRANT UPDATE ON public.notifications TO authenticated;
--   CREATE POLICY "unit_members_notifications_update" ON public.notifications FOR UPDATE
--     USING (<mesma expressão>) WITH CHECK (<mesma expressão>);

SET LOCAL lock_timeout = '5s';

DO $$
BEGIN
  IF current_setting('lock_timeout') <> '5s' THEN
    RAISE EXCEPTION '136: rode com --single-transaction (lock_timeout atual: %)', current_setting('lock_timeout');
  END IF;
  IF current_user <> 'supabase_admin' THEN
    RAISE EXCEPTION '136: rodar como supabase_admin (atual: %)', current_user;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.notification_reads (
  notification_id uuid        NOT NULL REFERENCES public.notifications(id) ON DELETE CASCADE,
  user_id         uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  lida_em         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (notification_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_notification_reads_user ON public.notification_reads (user_id);

ALTER TABLE public.notification_reads ENABLE ROW LEVEL SECURITY;

INSERT INTO public.notification_reads (notification_id, user_id)
SELECT n.id, n.user_id
  FROM public.notifications n
 WHERE n.lida AND n.user_id IS NOT NULL
ON CONFLICT DO NOTHING;

INSERT INTO public.notification_reads (notification_id, user_id)
SELECT n.id, uu.user_id
  FROM public.notifications n
  JOIN public.user_units uu ON uu.unit_id = n.unit_id
 WHERE n.lida AND n.user_id IS NULL
ON CONFLICT DO NOTHING;

DROP POLICY IF EXISTS "unit_members_notifications_select" ON public.notifications;
DROP POLICY IF EXISTS "unit_members_notifications_update" ON public.notifications;
DROP POLICY IF EXISTS "notifications_select" ON public.notifications;
DROP POLICY IF EXISTS "notifications_update" ON public.notifications;

CREATE POLICY "notifications_select" ON public.notifications AS PERMISSIVE FOR SELECT TO authenticated
  USING (
    user_id = (SELECT auth.uid())
    OR (user_id IS NULL
        AND ((SELECT is_global_admin())
             OR unit_id IN (SELECT unit_id FROM public.user_units WHERE user_id = (SELECT auth.uid()))))
  );

REVOKE ALL ON public.notifications FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.notifications FROM authenticated;

DROP POLICY IF EXISTS "notification_reads_select" ON public.notification_reads;
CREATE POLICY "notification_reads_select" ON public.notification_reads AS PERMISSIVE FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));

-- O EXISTS roda sob o RLS de notifications: só marca como lida o que a pessoa vê
DROP POLICY IF EXISTS "notification_reads_insert" ON public.notification_reads;
CREATE POLICY "notification_reads_insert" ON public.notification_reads AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (
    user_id = (SELECT auth.uid())
    AND EXISTS (SELECT 1 FROM public.notifications n WHERE n.id = notification_id)
  );

REVOKE ALL ON public.notification_reads FROM anon, authenticated;
GRANT SELECT, INSERT ON public.notification_reads TO authenticated;
GRANT ALL ON public.notification_reads TO service_role;

DO $$
DECLARE outras text;
BEGIN
  SELECT string_agg(tablename || '.' || policyname, ', ') INTO outras
    FROM pg_policies
   WHERE schemaname = 'public'
     AND ((tablename = 'notifications' AND policyname <> 'notifications_select')
          OR (tablename = 'notification_reads'
              AND policyname NOT IN ('notification_reads_select', 'notification_reads_insert')));
  IF outras IS NOT NULL THEN
    RAISE EXCEPTION '136: policies inesperadas: %', outras;
  END IF;
END $$;
