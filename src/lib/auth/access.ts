import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Verificações de acesso para rotas de API que usam o service-role (que ignora o RLS).
 * A consulta é feita com o client do usuário, então é o próprio RLS que decide:
 * se a linha não aparece, o usuário não pertence àquela unidade.
 */

/**
 * Busca a conversa respeitando o RLS do usuário.
 *
 * @param userClient - Client com a sessão do usuário (`createClient` de `@/lib/supabase/server`)
 * @param conversationId - ID em `wa_conversations`
 * @returns `{ id, unit_id }` ou `null` se não existir ou não for da unidade do usuário
 */
export async function getAccessibleConversation(
  userClient: SupabaseClient,
  conversationId: string,
): Promise<{ id: string; unit_id: string } | null> {
  const { data } = await userClient
    .from('wa_conversations')
    .select('id, unit_id')
    .eq('id', conversationId)
    .maybeSingle()
  return data
}

/**
 * Indica se o usuário pode agir em nome da unidade: admins globais sempre,
 * demais perfis só nas unidades vinculadas em `user_units`.
 *
 * @param userClient - Client com a sessão do usuário
 * @param userId - ID do usuário autenticado
 * @param unitId - Unidade alvo
 */
export async function canAccessUnit(userClient: SupabaseClient, userId: string, unitId: string): Promise<boolean> {
  const [{ data: isAdmin }, { data: link }] = await Promise.all([
    userClient.rpc('is_global_admin'),
    userClient.from('user_units').select('unit_id').eq('user_id', userId).eq('unit_id', unitId).maybeSingle(),
  ])
  return isAdmin === true || !!link
}
