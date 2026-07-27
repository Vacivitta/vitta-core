import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import ChatInternoClient from './ChatInternoClient'
import type { Profile, InternalChannel } from '@/types/database'
import { createAdminClient } from '@/lib/supabase/admin'

export const metadata = { title: 'Chat Interno — VittaDesk' }

export default async function ChatInternoPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profileData } = await supabase
    .from('profiles').select('*').eq('id', user.id).single()

  const profile = profileData as Profile
  if (!profile?.unit_id) redirect('/login')

  const admin = createAdminClient()

  const [
    { data: channelsData },
    { data: profilesData },
  ] = await Promise.all([
    admin
      .from('internal_channels')
      .select('id, unit_a_id, unit_b_id, ativo, criado_em, unit_a:units!unit_a_id(id, nome), unit_b:units!unit_b_id(id, nome)')
      .or(`unit_a_id.eq.${profile.unit_id},unit_b_id.eq.${profile.unit_id}`)
      .eq('ativo', true)
      .order('criado_em'),
    admin
      .from('profiles')
      .select('id, full_name, apelido')
      .eq('unit_id', profile.unit_id)
      .eq('ativo', true),
  ])

  return (
    <ChatInternoClient
      channels={(channelsData ?? []) as unknown as InternalChannel[]}
      currentUser={profile}
      unitProfiles={(profilesData ?? []) as Pick<Profile, 'id' | 'full_name' | 'apelido'>[]}
    />
  )
}
