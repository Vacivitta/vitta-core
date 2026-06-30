import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import AgendaClient from './AgendaClient'
import type { Profile } from '@/types/database'
import type { TaskWithLead, ScheduledMsg } from './AgendaClient'

export const metadata = { title: 'Agenda — VittaDesk' }

export default async function AgendaPage() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const [
    { data: profileData },
    { data: profilesData },
    { data: tasksData },
    { data: messagesData },
  ] = await Promise.all([
    supabase.from('profiles').select('*').eq('id', user.id).single(),
    supabase.from('profiles').select('*').order('full_name'),
    supabase
      .from('lead_tasks')
      .select('*, responsavel:profiles(*), lead:leads(id, nome, sobrenome)')
      .not('data_limite', 'is', null)
      .eq('concluida', false)
      .order('data_limite'),
    supabase
      .from('wa_scheduled_messages')
      .select('id, conversation_id, content, type, template_name, scheduled_for, status, created_by, conversation:wa_conversations(wa_contact_name, lead:leads(nome, sobrenome))')
      .neq('status', 'cancelled')
      .order('scheduled_for'),
  ])

  return (
    <AgendaClient
      initialTasks={(tasksData ?? []) as TaskWithLead[]}
      initialMessages={(messagesData ?? []) as unknown as ScheduledMsg[]}
      profiles={(profilesData ?? []) as Profile[]}
      currentUser={profileData as Profile}
    />
  )
}
