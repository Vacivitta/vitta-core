import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import AgendaClient from './AgendaClient'
import type { Profile } from '@/types/database'
import type { TaskWithLead } from './AgendaClient'

export const metadata = { title: 'Agenda — Vitta Core' }

export default async function AgendaPage() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const [
    { data: profileData },
    { data: profilesData },
    { data: tasksData },
  ] = await Promise.all([
    supabase.from('profiles').select('*').eq('id', user.id).single(),
    supabase.from('profiles').select('*').order('full_name'),
    supabase
      .from('lead_tasks')
      .select('*, responsavel:profiles(*), lead:leads(id, nome, sobrenome)')
      .not('data_limite', 'is', null)
      .order('data_limite'),
  ])

  return (
    <AgendaClient
      initialTasks={(tasksData ?? []) as TaskWithLead[]}
      profiles={(profilesData ?? []) as Profile[]}
      currentUser={profileData as Profile}
    />
  )
}
