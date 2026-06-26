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

  const [
    { data: profileData },
    { data: profilesData },
    { data: tasksData },
  ] = await Promise.all([
    supabase.from('profiles').select('*').eq('id', user.id).single(),
    supabase.from('profiles').select('id, full_name, apelido').eq('ativo', true).order('full_name'),
    supabase
      .from('lead_tasks')
      .select('*, responsavel:profiles(id, full_name, apelido), lead:leads(id, nome, sobrenome)')
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
