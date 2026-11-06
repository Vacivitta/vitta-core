import { cookies } from 'next/headers'
import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js'
import type { Profile } from '@/types/database'
import { COOKIE_UNIDADE, unidadeDaAba } from '@/lib/unidade-ativa'

/**
 * Perfil do usuário logado com unit_id = unidade ativa da aba (cookie vd_unidade,
 * aceito só se o usuário está vinculado à unidade; senão fica profiles.unit_id).
 * Substitui `.from('profiles').select(colunas).eq('id', userId).single()`; só as
 * colunas pedidas vêm preenchidas.
 */
export async function buscarPerfil(
  cliente: SupabaseClient,
  userId: string,
  colunas = '*',
): Promise<{ data: Profile | null; error: PostgrestError | null }> {
  const { data, error } = await cliente.from('profiles').select(colunas).eq('id', userId).single()
  const perfil = data as unknown as Profile | null
  if (!perfil || !('unit_id' in perfil)) return { data: perfil, error }

  const pedida = (await cookies()).get(COOKIE_UNIDADE)?.value
  if (!pedida || pedida === perfil.unit_id) return { data: perfil, error }

  const { data: vinculo } = await cliente
    .from('user_units').select('unit_id').eq('user_id', userId).eq('unit_id', pedida).maybeSingle()
  return { data: { ...perfil, unit_id: unidadeDaAba(pedida, perfil.unit_id, vinculo ? [pedida] : []) }, error }
}
