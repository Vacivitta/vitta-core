import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import SupervisaoClient from './SupervisaoClient'
import type { Profile } from '@/types/database'

export const metadata = { title: 'Supervisão — Vitta Core' }

export default async function SupervisaoPage() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const [
    { data: profileData },
    { data: profilesData },
  ] = await Promise.all([
    supabase.from('profiles').select('*').eq('id', user.id).single(),
    supabase.from('profiles').select('*').order('full_name'),
  ])

  if (profileData?.perfil === 'atendente') redirect('/funil')

  return (
    <SupervisaoClient
      currentUser={profileData as Profile}
      profiles={(profilesData ?? []) as Profile[]}
    />
  )
}
