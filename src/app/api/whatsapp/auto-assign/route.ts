import { NextRequest, NextResponse } from 'next/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'

function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('[WA] NEXT_PUBLIC_SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY não configurados')
  return createAdminClient(url, key)
}

// POST /api/whatsapp/auto-assign
// Body: { conversation_id: string, queue_id: string }
export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return new NextResponse('Unauthorized', { status: 401 })

  const body = await req.json() as { conversation_id: string; queue_id: string }
  if (!body.conversation_id || !body.queue_id) {
    return NextResponse.json({ error: 'conversation_id e queue_id são obrigatórios' }, { status: 400 })
  }

  const result = await runAutoAssign(adminClient(), body.conversation_id, body.queue_id)
  if (!result) return NextResponse.json({ assigned: false })
  return NextResponse.json({ assigned: true, agent_id: result.agentId, agent_name: result.agentName })
}

// ── Core logic (also exported for use in webhook) ─────────────────────────────

export async function runAutoAssign(
  supabase: ReturnType<typeof adminClient>,
  conversationId: string,
  queueId: string,
): Promise<{ agentId: string; agentName: string } | null> {

  // 1. Load queue config
  const { data: queue } = await supabase
    .from('wa_queues')
    .select('id, unit_id, auto_assign, distribution_method, max_per_agent, last_assigned_agent')
    .eq('id', queueId)
    .single()

  if (!queue?.auto_assign) return null

  type QueueRow = { unit_id: string; distribution_method: string; max_per_agent: number; last_assigned_agent: string | null }
  type MemberRow = { user_id: string; profile: { id: string; full_name: string; perfil: string } }

  const q      = queue as unknown as QueueRow
  const unitId = q.unit_id
  const method = q.distribution_method ?? 'round_robin'
  const maxPer = q.max_per_agent ?? 10

  // 2. Get eligible atendentes — restricted to queue agents if any are configured
  const { data: queueAgents } = await supabase
    .from('wa_queue_agents')
    .select('agent_id')
    .eq('queue_id', queueId)

  const { data: members } = await supabase
    .from('user_units')
    .select('user_id, profile:profiles!inner(id, full_name, perfil)')
    .eq('unit_id', unitId)
    .eq('profiles.perfil', 'atendente')

  const allowedIds = queueAgents?.length
    ? new Set(queueAgents.map(r => r.agent_id))
    : null // null = all agents allowed

  const agents = ((members ?? []) as unknown as MemberRow[])
    .map(m => ({ id: m.profile.id, name: m.profile.full_name }))
    .filter(a => a.id && (!allowedIds || allowedIds.has(a.id)))

  if (!agents.length) return null

  let chosenAgent: { id: string; name: string } | null = null

  if (method === 'round_robin') {
    // Find next agent after last_assigned_agent
    const lastIdx   = agents.findIndex(a => a.id === q.last_assigned_agent)
    const nextAgent = agents[(lastIdx + 1) % agents.length]

    // Check they haven't hit the limit
    const { count } = await supabase
      .from('wa_conversations')
      .select('id', { count: 'exact', head: true })
      .eq('assigned_to', nextAgent.id)
      .neq('status', 'resolved')

    chosenAgent = (count ?? 0) < maxPer ? nextAgent : null

    // If over limit, try others in order
    if (!chosenAgent) {
      for (let i = 1; i < agents.length; i++) {
        const candidate = agents[(lastIdx + 1 + i) % agents.length]
        const { count: c2 } = await supabase
          .from('wa_conversations')
          .select('id', { count: 'exact', head: true })
          .eq('assigned_to', candidate.id)
          .neq('status', 'resolved')
        if ((c2 ?? 0) < maxPer) { chosenAgent = candidate; break }
      }
    }
  } else {
    // least_loaded: pick agent with fewest open conversations
    const loads = await Promise.all(
      agents.map(async a => {
        const { count } = await supabase
          .from('wa_conversations')
          .select('id', { count: 'exact', head: true })
          .eq('assigned_to', a.id)
          .neq('status', 'resolved')
        return { agent: a, count: count ?? 0 }
      })
    )
    const eligible = loads.filter(l => l.count < maxPer).sort((a, b) => a.count - b.count)
    chosenAgent = eligible[0]?.agent ?? null
  }

  if (!chosenAgent) return null

  // 3. Assign conversation + update round-robin pointer
  await Promise.all([
    supabase
      .from('wa_conversations')
      .update({ assigned_to: chosenAgent.id })
      .eq('id', conversationId),
    supabase
      .from('wa_queues')
      .update({ last_assigned_agent: chosenAgent.id })
      .eq('id', queueId),
  ])

  return { agentId: chosenAgent.id, agentName: chosenAgent.name }
}
