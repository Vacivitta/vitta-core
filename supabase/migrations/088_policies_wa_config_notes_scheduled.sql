-- 088_policies_wa_config_notes_scheduled.sql
--
-- 1. wa_config guarda o access_token da Meta. A policy "unit members" (ALL) deixava
--    qualquer usuário da unidade — inclusive atendente — ler e alterar o token direto
--    pela API REST. Todo acesso já passa pelo servidor (service-role), então a tabela
--    fica sem policy para o navegador (RLS ligado = acesso negado).
-- 2. Notas internas e mensagens agendadas pertencem a uma conversa. Passam a usar a
--    mesma regra de wa_conversations (unidades vinculadas em user_units ou admin global)
--    em vez da unidade ativa do perfil.

DROP POLICY IF EXISTS "unit members" ON wa_config;
ALTER TABLE wa_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "unit_members_notes" ON wa_internal_notes;
CREATE POLICY "unit_members_notes" ON wa_internal_notes
  FOR ALL
  USING      (is_global_admin() OR unit_id IN (SELECT unit_id FROM user_units WHERE user_id = auth.uid()))
  WITH CHECK (is_global_admin() OR unit_id IN (SELECT unit_id FROM user_units WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "unit members" ON wa_scheduled_messages;
CREATE POLICY "unit members" ON wa_scheduled_messages
  FOR ALL
  USING      (is_global_admin() OR unit_id IN (SELECT unit_id FROM user_units WHERE user_id = auth.uid()))
  WITH CHECK (is_global_admin() OR unit_id IN (SELECT unit_id FROM user_units WHERE user_id = auth.uid()));
