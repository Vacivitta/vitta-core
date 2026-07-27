import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import type { Profile } from '@/types/database'
import ChatInternoConfigClient from './ChatInternoConfigClient'

export const metadata = { title: 'Chat Interno — Configurações — VittaDesk' }

export default async function ChatInternoConfigPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase.from('profiles').select('*').eq('id', user.id).single()
  if (!profile) redirect('/login')
  if (!['admin', 'gestor_vacivitta'].includes(profile.perfil)) redirect('/funil')

  return <ChatInternoConfigClient />
}
