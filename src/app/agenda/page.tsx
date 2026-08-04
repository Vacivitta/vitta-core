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

  const { data: profileData } = await supabase
    .from('profiles').select('*').eq('id', user.id).single()

  const unitId = (profileData as Profile)?.unit_id

  const [
    { data: profilesData },
    { data: tasksData },
    { data: messagesData },
    { data: userUnits },
  ] = await Promise.all([
    supabase.from('profiles').select('*').eq('unit_id', unitId).order('full_name'),
    supabase
      .from('lead_tasks')
      .select('*, responsavel:profiles(*), lead:leads(id, nome, sobrenome)')
      .eq('unit_id', unitId)
      .not('data_limite', 'is', null)
      .eq('concluida', false)
      .order('data_limite'),
    supabase
      .from('wa_scheduled_messages')
      .select('id, conversation_id, content, type, template_name, scheduled_for, status, created_by, conversation:wa_conversations(wa_contact_name, lead:leads(nome, sobrenome))')
      .eq('unit_id', unitId)
      .neq('status', 'cancelled')
      .order('scheduled_for'),
    supabase.from('user_units').select('user_id').eq('unit_id', unitId).eq('ativo', true),
  ])

  const extraUserIds = (userUnits ?? [])
    .map(r => r.user_id as string)
    .filter(id => !(profilesData ?? []).some(p => p.id === id))

  let allProfiles = profilesData ?? []
  if (extraUserIds.length > 0) {
    const { data: extra } = await supabase
      .from('profiles').select('*').in('id', extraUserIds).order('full_name')
    if (extra) allProfiles = [...allProfiles, ...extra]
  }

  return (
    <AgendaClient
      initialTasks={(tasksData ?? []) as TaskWithLead[]}
      initialMessages={(messagesData ?? []) as unknown as ScheduledMsg[]}
      profiles={allProfiles as Profile[]}
      currentUser={profileData as Profile}
    />
  )
}
