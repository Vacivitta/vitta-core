import { redirect }    from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import SupervisaoClient from './SupervisaoClient'
import type { Profile } from '@/types/database'
import type { CampaignRow, TemplateRow, FunnelStageRow } from '@/app/campanhas/page'

export const metadata = { title: 'Dashboard de Atendimento — VittaDesk' }

export default async function SupervisaoPage() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase.from('profiles').select('*').eq('id', user.id).single()
  if (!profile) redirect('/login')
  if (profile.perfil === 'atendente') redirect('/funil')

  const unitId    = profile.unit_id ?? ''
  const monthYear = new Date().toISOString().slice(0, 7)
  const todayISO  = new Date().toISOString().slice(0, 10)

  const results = await Promise.allSettled([
    // 0 Conversas ativas
    supabase
      .from('wa_conversations')
      .select('id,wa_phone,wa_contact_name,status,unread_count,last_message_at,assigned_to,queue_id,resolved_at,lead_id')
      .eq('unit_id', unitId)
      .order('last_message_at', { ascending: false }),

    // 1 Filas
    supabase
      .from('wa_queues')
      .select('id,nome,cor,ativo,auto_assign,distribution_method,max_per_agent')
      .eq('unit_id', unitId)
      .eq('ativo', true)
      .order('nome'),

    // 2 Membros da unidade
    supabase
      .from('profiles')
      .select('id,full_name,perfil,email')
      .eq('unit_id', unitId)
      .order('full_name'),

    // 3 Billing WA do mês
    supabase
      .from('wa_message_costs')
      .select('category,cost_usd,billable')
      .eq('unit_id', unitId)
      .eq('month_year', monthYear),

    // 4 Estatísticas por agente (RPC)
    supabase.rpc('get_agent_stats', { p_unit_id: unitId }),

    // 5 Campanhas
    supabase.from('wa_campaigns')
      .select('id,nome,template_nome,template_category,status,scheduled_at,started_at,completed_at,daily_limit,total_recipients,sent_count,delivered_count,read_count,replied_count,optout_count,failed_count,estimated_cost_usd,actual_cost_usd,created_at')
      .eq('unit_id', unitId)
      .order('created_at', { ascending: false }),

    // 6 Templates de mensagem
    supabase.from('wa_message_templates')
      .select('id,name,content,category,template_name,language')
      .eq('ativo', true)
      .order('name'),

    // 7 Estágios de funil
    supabase.from('funnel_stages')
      .select('id,nome,funnel_id,funnels(id,nome)')
      .order('funnel_id').order('ordem'),
  ])

  function settled<T>(r: PromiseSettledResult<unknown>): T[] {
    if (r.status !== 'fulfilled') return []
    const v = (r as PromiseFulfilledResult<{ data: T[] | null }>).value
    return v?.data ?? []
  }

  const conversations = settled<SupervisaoConvRow>(results[0])
  const queues        = settled<QueueRow>(results[1])
  const profiles      = settled<Profile>(results[2])
  const billing       = settled<{ category: string; cost_usd: number; billable: boolean }>(results[3])
  const agentStats    = settled<AgentStatRow>(results[4])
  const campaigns     = settled<CampaignRow>(results[5])
  const templates     = settled<TemplateRow>(results[6])
  const rawStages     = settled<unknown>(results[7])
  const stages        = rawStages.map((s) => {
    const r = s as { id: string; nome: string; funnel_id: string; funnels: unknown }
    return { ...r, funnel: Array.isArray(r.funnels) ? (r.funnels[0] ?? null) : r.funnels } as FunnelStageRow
  })

  return (
    <SupervisaoClient
      currentUser={profile as Profile}
      initialConversations={conversations}
      initialQueues={queues}
      profiles={profiles}
      billing={billing}
      agentStats={agentStats}
      todayISO={todayISO}
      campaigns={campaigns}
      templates={templates}
      stages={stages}
    />
  )
}

// ── Shared types (exported for client) ───────────────────────────────────────

export interface SupervisaoConvRow {
  id: string; wa_phone: string; wa_contact_name: string | null
  status: string; unread_count: number; last_message_at: string | null
  assigned_to: string | null; queue_id: string | null
  resolved_at: string | null; lead_id: string | null
}

export interface QueueRow {
  id: string; nome: string; cor: string; ativo: boolean
  auto_assign: boolean; distribution_method: string; max_per_agent: number
}

export interface AgentStatRow {
  agent_id: string; open_count: number; resolved_today: number; avg_response_minutes: number | null
}
