import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import TarefasClient from './TarefasClient'
import type { Profile } from '@/types/database'
import type { TaskWithLead } from './TarefasClient'

export const metadata = { title: 'Tarefas — VittaDesk' }

export default async function TarefasPage() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profileData } = await supabase
    .from('profiles').select('*').eq('id', user.id).single()

  const unitId = (profileData as Profile)?.unit_id

  const [
    { data: profilesData },
    { data: tasksData },
  ] = await Promise.all([
    supabase.from('profiles').select('id, full_name, apelido').eq('ativo', true).eq('unit_id', unitId).order('full_name'),
    supabase
      .from('lead_tasks')
      .select('*, responsavel:profiles(id, full_name, apelido), lead:leads(id, nome, sobrenome)')
      .eq('unit_id', unitId)
      .order('concluida', { ascending: true })
      .order('data_limite', { ascending: true, nullsFirst: false }),
  ])

  return (
    <TarefasClient
      initialTasks={(tasksData ?? []) as TaskWithLead[]}
      profiles={(profilesData ?? []) as Pick<Profile, 'id' | 'full_name' | 'apelido'>[]}
      currentUser={profileData as Profile}
    />
  )
}
