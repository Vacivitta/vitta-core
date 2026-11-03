import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { isPerfilAdminGlobal } from '@/lib/auth/access'
import type { AppError } from '@/types/database'
import ErrosClient from './ErrosClient'

export const metadata = { title: 'Erros do servidor — Configurações — VittaDesk' }

export default async function ErrosPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase.from('profiles').select('perfil').eq('id', user.id).single()
  if (!profile) redirect('/login')
  if (!isPerfilAdminGlobal(profile.perfil)) redirect('/funil')

  const [{ data: abertos }, { data: resolvidos }] = await Promise.all([
    supabase.from('app_errors').select('*').is('resolvido_em', null)
      .order('ultimo_em', { ascending: false }).limit(200),
    supabase.from('app_errors').select('*').not('resolvido_em', 'is', null)
      .order('ultimo_em', { ascending: false }).limit(100),
  ])

  return (
    <ErrosClient
      currentUserId={user.id}
      initialErros={[...(abertos ?? []), ...(resolvidos ?? [])] as AppError[]}
    />
  )
}
