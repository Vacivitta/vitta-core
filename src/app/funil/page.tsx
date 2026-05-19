import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import FunilClient from './FunilClient'
import type { Profile } from '@/types/database'

export default async function FunilPage() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const [{ data: profileData }, { data: leadsData }, { data: profilesData }] = await Promise.all([
    supabase.from('profiles').select('*').eq('id', user.id).single(),
    supabase.from('leads_kanban').select('*').order('ordem').order('created_at'),
    supabase.from('profiles').select('*').order('full_name'),
  ])

  return (
    <FunilClient
      initialLeads={leadsData ?? []}
      profiles={(profilesData ?? []) as Profile[]}
      currentUser={profileData as Profile}
    />
  )
}
