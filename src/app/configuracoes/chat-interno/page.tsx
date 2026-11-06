import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import type { Profile } from '@/types/database'
import ChatInternoConfigClient from './ChatInternoConfigClient'
import { buscarPerfil } from '@/lib/supabase/perfil'

export const metadata = { title: 'Chat Interno — Configurações — VittaDesk' }

export default async function ChatInternoConfigPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await buscarPerfil(supabase, user.id, '*')
  if (!profile) redirect('/login')
  if (!['admin', 'gestor_vacivitta'].includes(profile.perfil)) redirect('/funil')

  return <ChatInternoConfigClient />
}
