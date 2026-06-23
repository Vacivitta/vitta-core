-- ── Migration 045: corrige SECURITY DEFINER nas views ────────────────────────
-- As views leads_arquivados, leads_kanban e product_current_price estavam com
-- SECURITY DEFINER implícito, o que faz com que consultas nelas ignorem as
-- políticas RLS do usuário consultante e usem as permissões do criador da view.
-- Isso bypassa o isolamento por unidade (unit_id) implementado via RLS.
--
-- Correção: marcar as views como SECURITY INVOKER para que o RLS do usuário
-- autenticado seja respeitado normalmente.

ALTER VIEW public.leads_arquivados      SET (security_invoker = true);
ALTER VIEW public.leads_kanban          SET (security_invoker = true);
ALTER VIEW public.product_current_price SET (security_invoker = true);
