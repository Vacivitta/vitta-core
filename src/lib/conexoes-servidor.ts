import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { isPerfilAdminGlobal, isPerfilGestor } from '@/lib/auth/access'
import type { QuemPede } from '@/lib/conexoes'

/** Cliente service-role: conexoes só é escrita pelo servidor (143). */
export function adminConexoes(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('[conexões] NEXT_PUBLIC_SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY não configurados')
  return createClient(url, key)
}

/**
 * Usuário logado e o que ele é na unidade. `null` sem sessão.
 *
 * @param unitId - Unidade da conexão
 */
export async function quemPede(unitId: string): Promise<QuemPede | null> {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const [{ data: perfil }, { data: vinculo }] = await Promise.all([
    supabase.from('profiles').select('perfil').eq('id', user.id).single(),
    supabase.from('user_units').select('unit_id').eq('user_id', user.id).eq('unit_id', unitId).maybeSingle(),
  ])
  const p = (perfil as { perfil?: string } | null)?.perfil
  return { userId: user.id, ehMarca: isPerfilAdminGlobal(p), ehGestor: isPerfilGestor(p), membro: !!vinculo }
}
