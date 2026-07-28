import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import DashboardClient from './DashboardClient'
import type { Profile, SalesGoal } from '@/types/database'

export const metadata = { title: 'Dashboard — VittaDesk' }

export default async function DashboardPage() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles').select('*').eq('id', user.id).single()

  if (!profile) redirect('/login')
  if (profile.perfil === 'atendente') redirect('/funil')

  const unitId    = (profile as Profile).unit_id
  const monthYear = new Date().toISOString().slice(0, 7)
  const todayISO  = new Date().toISOString().slice(0, 10)

  const [
    { data: leadsRaw },
    { data: quotesRaw },
    { data: stagesRaw },
    { data: tasksRaw },
    { data: convsRaw },
    { data: msgsRaw },
    { data: profilesRaw },
    { data: billingRaw },
    { data: queuesRaw },
    { data: agentStatsRaw },
    { data: salesGoalsRaw },
    { data: stageHistoryRaw },
  ] = await Promise.all([
    supabase
      .from('leads')
      .select('id, stage_id, created_at, origem, motivo_perda')
      .eq('arquivado', false)
      .eq('unit_id', unitId),
    supabase
      .from('quotes')
      .select('id, status, total_calculado, criado_em, aceito_em, responsavel_id, motivo_recusa')
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
      .select('id, lead_id, unread_count, last_message_at, last_message_direction, status, assigned_to, queue_id, resolved_at')
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
      .select('id, full_name, apelido, perfil')
      .eq('unit_id', unitId),
    supabase
      .from('wa_message_costs')
      .select('category, cost_usd, billable')
      .eq('unit_id', unitId)
      .eq('month_year', monthYear),
    supabase
      .from('wa_queues')
      .select('id, nome, cor')
      .eq('unit_id', unitId)
      .eq('ativo', true)
      .order('nome'),
    supabase.rpc('get_agent_stats', { p_unit_id: unitId }),
    supabase
      .from('sales_goals')
      .select('id, unit_id, user_id, month, target, created_at')
      .eq('unit_id', unitId)
      .is('user_id', null)
      .order('month', { ascending: false }),
    supabase
      .from('lead_stage_history')
      .select('id, lead_id, de_stage_id, para_stage_id, criado_em, lead:leads!inner(unit_id)')
      .eq('lead.unit_id', unitId)
      .order('criado_em'),
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
      billing={billingRaw ?? []}
      queues={queuesRaw ?? []}
      agentStats={agentStatsRaw ?? []}
      todayISO={todayISO}
      salesGoals={(salesGoalsRaw ?? []) as SalesGoal[]}
      stageHistory={(stageHistoryRaw ?? []).map((h: Record<string, unknown>) => ({
        id: h.id as string,
        lead_id: h.lead_id as string,
        de_stage_id: h.de_stage_id as string | null,
        para_stage_id: h.para_stage_id as string,
        criado_em: h.criado_em as string,
      }))}
    />
  )
}
