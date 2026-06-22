import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import type { Profile } from '@/types/database'
import TemplatesWhatsAppClient from './TemplatesWhatsAppClient'

export const metadata = { title: 'Templates WhatsApp — VittaDesk' }

export default async function TemplatesWhatsAppPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase.from('profiles').select('*').eq('id', user.id).single()
  if (!profile) redirect('/login')
  if (profile.perfil === 'atendente') redirect('/funil')

  return <TemplatesWhatsAppClient currentUser={profile as Profile} />
}
