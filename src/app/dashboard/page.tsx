import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import DashboardClient from './DashboardClient'
import type { Profile } from '@/types/database'

export const metadata = { title: 'Dashboard — VittaDesk' }

export default async function DashboardPage() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles').select('*').eq('id', user.id).single()

  if (!profile) redirect('/login')
  if (profile.perfil === 'atendente') redirect('/funil')

  const unitId = (profile as Profile).unit_id

  const [
    { data: leadsRaw },
    { data: quotesRaw },
    { data: stagesRaw },
    { data: tasksRaw },
    { data: convsRaw },
    { data: msgsRaw },
    { data: profilesRaw },
  ] = await Promise.all([
    supabase
      .from('leads')
      .select('id, stage_id, created_at, origem')
      .eq('arquivado', false)
      .eq('unit_id', unitId),
    supabase
      .from('quotes')
      .select('id, status, total_calculado, criado_em, aceito_em')
      .eq('unit_id', unitId)
      .order('criado_em', { ascending: false }),
    supabase
      .from('funnel_stages')
      .select('id, nome, cor, ordem, funnel_id, funnels(id, nome)')
      .eq('unit_id', unitId)
      .order('funnel_id')
      .order('ordem'),
    supabase
      .from('lead_tasks')
      .select('id, concluida_em, data_vencimento, responsavel_id')
      .eq('unit_id', unitId)
      .is('concluida_em', null),
    supabase
      .from('wa_conversations')
      .select('id, lead_id, unread_count, last_message_at, last_message_direction')
      .eq('unit_id', unitId)
      .order('last_message_at', { ascending: false }),
    supabase
      .from('wa_messages')
      .select('id, conversation_id, direction, created_at, sent_by')
      .eq('unit_id', unitId)
      .order('created_at', { ascending: false })
      .limit(2000),
    supabase
      .from('profiles')
      .select('id, full_name, apelido')
      .eq('unit_id', unitId),
  ])

  return (
    <DashboardClient
      currentUser={profile as Profile}
      leads={leadsRaw ?? []}
      quotes={quotesRaw ?? []}
      stages={(stagesRaw ?? []).map(s => ({
        ...s,
        funnel: Array.isArray(s.funnels) ? (s.funnels[0] ?? null) : s.funnels,
      }))}
      tasks={tasksRaw ?? []}
      conversations={convsRaw ?? []}
      messages={msgsRaw ?? []}
      profiles={profilesRaw ?? []}
    />
  )
}
