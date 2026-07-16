/**
 * POST /api/whatsapp/process-timed-automations
 *
 * Processa automações baseadas em tempo: leads parados, conversas sem resposta, etc.
 * Deve ser chamado a cada hora via pg_cron ou cron externo.
 *
 * Authorization: Bearer <CRON_SECRET>
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getWaCredentials } from '@/lib/whatsapp/credentials'

const META_API_URL = 'https://graph.facebook.com/v20.0'
export const maxDuration = 60

function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Missing Supabase env vars')
  return createClient(url, key)
}

export async function POST(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (secret) {
    const auth = req.headers.get('authorization') ?? ''
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

  const admin = adminClient()

  const { data: automations } = await admin
    .from('wa_timed_automations')
    .select('*')
    .eq('ativo', true)

  if (!automations || automations.length === 0) {
    return NextResponse.json({ processed: 0 })
  }

  let totalProcessed = 0

  for (const auto of automations) {
    try {
      const count = await processAutomation(admin, auto)
      totalProcessed += count
    } catch (e) {
      console.error(`[timed-auto] erro automation=${auto.id} condition=${auto.condition}:`, e)
    }
  }

  return NextResponse.json({ processed: totalProcessed })
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function processAutomation(admin: ReturnType<typeof adminClient>, auto: any): Promise<number> {
  const cutoff = new Date(Date.now() - auto.threshold_hours * 3600_000).toISOString()

  switch (auto.condition) {
    case 'no_patient_reply':
      return processNoPatientReply(admin, auto, cutoff)
    case 'lead_stuck_stage':
      return processLeadStuckStage(admin, auto, cutoff)
    case 'no_agent_reply':
      return processNoAgentReply(admin, auto, cutoff)
    case 'lead_no_task':
      return processLeadNoTask(admin, auto)
    default:
      return 0
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function processNoPatientReply(admin: ReturnType<typeof adminClient>, auto: any, cutoff: string) {
  let query = admin
    .from('wa_conversations')
    .select('id, wa_phone, lead_id, unit_id')
    .eq('unit_id', auto.unit_id)
    .eq('last_message_direction', 'outbound')
    .lt('last_message_at', cutoff)
    .neq('status', 'resolved')
    .limit(50)

  if (auto.filter_funnel_id || auto.filter_stage_id) {
    const leadIds = await getFilteredLeadIds(admin, auto)
    if (leadIds.length === 0) return 0
    query = query.in('lead_id', leadIds)
  }

  const { data: convs } = await query
  if (!convs || convs.length === 0) return 0

  return executeForConversations(admin, auto, convs)
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function processNoAgentReply(admin: ReturnType<typeof adminClient>, auto: any, cutoff: string) {
  let query = admin
    .from('wa_conversations')
    .select('id, wa_phone, lead_id, unit_id')
    .eq('unit_id', auto.unit_id)
    .eq('last_message_direction', 'inbound')
    .gt('unread_count', 0)
    .lt('last_message_at', cutoff)
    .neq('status', 'resolved')
    .limit(50)

  if (auto.filter_funnel_id || auto.filter_stage_id) {
    const leadIds = await getFilteredLeadIds(admin, auto)
    if (leadIds.length === 0) return 0
    query = query.in('lead_id', leadIds)
  }

  const { data: convs } = await query
  if (!convs || convs.length === 0) return 0

  return executeForConversations(admin, auto, convs)
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function processLeadStuckStage(admin: ReturnType<typeof adminClient>, auto: any, cutoff: string) {
  if (!auto.filter_stage_id) return 0

  let query = admin
    .from('leads')
    .select('id, unit_id')
    .eq('unit_id', auto.unit_id)
    .eq('stage_id', auto.filter_stage_id)
    .eq('arquivado', false)
    .lt('updated_at', cutoff)
    .limit(50)

  if (auto.filter_funnel_id) {
    const { data: stageIds } = await admin
      .from('funnel_stages')
      .select('id')
      .eq('funnel_id', auto.filter_funnel_id)
    if (stageIds) {
      query = query.in('stage_id', stageIds.map(s => s.id))
    }
  }

  const { data: leads } = await query
  if (!leads || leads.length === 0) return 0

  return executeForLeads(admin, auto, leads)
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function processLeadNoTask(admin: ReturnType<typeof adminClient>, auto: any) {
  const { data: leads } = await admin
    .from('leads')
    .select('id, unit_id')
    .eq('unit_id', auto.unit_id)
    .eq('arquivado', false)
    .limit(200)

  if (!leads || leads.length === 0) return 0

  const leadIds = leads.map(l => l.id)
  const { data: tasksWithLead } = await admin
    .from('lead_tasks')
    .select('lead_id')
    .in('lead_id', leadIds)
    .gte('due_date', new Date().toISOString())
    .eq('completed', false)

  const leadsWithTask = new Set((tasksWithLead ?? []).map(t => t.lead_id))
  const leadsWithout = leads.filter(l => !leadsWithTask.has(l.id))

  if (leadsWithout.length === 0) return 0

  return executeForLeads(admin, auto, leadsWithout)
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getFilteredLeadIds(admin: ReturnType<typeof adminClient>, auto: any): Promise<string[]> {
  let query = admin
    .from('leads')
    .select('id')
    .eq('unit_id', auto.unit_id)
    .eq('arquivado', false)

  if (auto.filter_stage_id) query = query.eq('stage_id', auto.filter_stage_id)
  if (auto.filter_funnel_id) {
    const { data: stageIds } = await admin
      .from('funnel_stages')
      .select('id')
      .eq('funnel_id', auto.filter_funnel_id)
    if (stageIds && stageIds.length > 0) {
      query = query.in('stage_id', stageIds.map(s => s.id))
    }
  }

  const { data } = await query.limit(200)
  return (data ?? []).map(l => l.id)
}

async function executeForConversations(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: ReturnType<typeof adminClient>, auto: any, convs: { id: string; wa_phone: string; lead_id: string | null; unit_id: string }[],
) {
  let count = 0
  for (const conv of convs) {
    const alreadyTriggered = await wasAlreadyTriggered(admin, auto.id, conv.lead_id, conv.id)
    if (alreadyTriggered) continue

    if (auto.action === 'send_template' && auto.template_id) {
      const sent = await sendTemplateToConv(admin, auto.unit_id, conv, auto.template_id)
      if (sent) {
        await logTrigger(admin, auto.id, conv.lead_id, conv.id)
        count++
      }
    } else if (auto.action === 'move_stage' && auto.action_stage_id && conv.lead_id) {
      await admin.from('leads').update({ stage_id: auto.action_stage_id }).eq('id', conv.lead_id)
      await logTrigger(admin, auto.id, conv.lead_id, conv.id)
      count++
    }
  }
  return count
}

async function executeForLeads(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: ReturnType<typeof adminClient>, auto: any, leads: { id: string; unit_id: string }[],
) {
  let count = 0
  for (const lead of leads) {
    const alreadyTriggered = await wasAlreadyTriggered(admin, auto.id, lead.id, null)
    if (alreadyTriggered) continue

    if (auto.action === 'move_stage' && auto.action_stage_id) {
      await admin.from('leads').update({ stage_id: auto.action_stage_id }).eq('id', lead.id)
      await logTrigger(admin, auto.id, lead.id, null)
      count++
    } else if (auto.action === 'send_template' && auto.template_id) {
      const { data: conv } = await admin
        .from('wa_conversations')
        .select('id, wa_phone, lead_id, unit_id')
        .eq('lead_id', lead.id)
        .eq('unit_id', auto.unit_id)
        .order('last_message_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (conv) {
        const sent = await sendTemplateToConv(admin, auto.unit_id, conv, auto.template_id)
        if (sent) {
          await logTrigger(admin, auto.id, lead.id, conv.id)
          count++
        }
      }
    }
  }
  return count
}

async function sendTemplateToConv(
  admin: ReturnType<typeof adminClient>,
  unitId: string,
  conv: { id: string; wa_phone: string },
  templateId: string,
) {
  const { data: template } = await admin
    .from('wa_message_templates')
    .select('template_name, content, language, variable_order')
    .eq('id', templateId)
    .single()

  if (!template?.template_name) return false

  const creds = await getWaCredentials(unitId)
  if (!creds.phoneNumberId || !creds.accessToken) return false

  const varCount = (template.content?.match(/\{\{\d+\}\}/g) ?? []).length
  let components: object[] = []
  let renderedText = template.content ?? ''

  if (varCount > 0) {
    const order = (template.variable_order as string[] | null)?.length === varCount
      ? template.variable_order as string[]
      : ['nome_cliente', 'nome_atendente', 'data', 'horario'].slice(0, varCount)

    const now = new Date()
    const values = order.map((id: string) => {
      switch (id) {
        case 'nome_cliente':   return 'Cliente'
        case 'nome_atendente': return 'Equipe'
        case 'data':           return now.toLocaleDateString('pt-BR')
        case 'horario':        return now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
        default:               return ''
      }
    })

    components = [{ type: 'body', parameters: values.map(v => ({ type: 'text', text: v })) }]
    renderedText = template.content?.replace(
      /\{\{(\d+)\}\}/g,
      (_m: string, n: string) => values[parseInt(n, 10) - 1] ?? `{{${n}}}`,
    ) ?? ''
  }

  const metaRes = await fetch(`${META_API_URL}/${creds.phoneNumberId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${creds.accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to: conv.wa_phone,
      type: 'template',
      template: {
        name: template.template_name,
        language: { code: template.language ?? 'pt_BR' },
        components,
      },
    }),
    signal: AbortSignal.timeout(15_000),
  })

  if (!metaRes.ok) {
    console.error(`[timed-auto] Meta send failed conv=${conv.id}`)
    return false
  }

  const metaData = await metaRes.json() as { messages?: { id: string }[] }
  const waId = metaData.messages?.[0]?.id ?? null

  await Promise.all([
    admin.from('wa_messages').insert({
      conversation_id: conv.id,
      unit_id: unitId,
      wa_message_id: waId,
      direction: 'outbound',
      type: 'template',
      content: renderedText,
      template_name: template.template_name,
      status: 'sent',
    }),
    admin.from('wa_conversations').update({
      last_message_at: new Date().toISOString(),
      last_message_content: renderedText || `📋 ${template.template_name}`,
      last_message_direction: 'outbound',
    }).eq('id', conv.id),
  ])

  return true
}

async function wasAlreadyTriggered(
  admin: ReturnType<typeof adminClient>,
  automationId: string,
  leadId: string | null,
  conversationId: string | null,
) {
  let query = admin
    .from('wa_timed_automation_log')
    .select('id', { count: 'exact', head: true })
    .eq('automation_id', automationId)

  if (leadId) query = query.eq('lead_id', leadId)
  if (conversationId) query = query.eq('conversation_id', conversationId)

  const { count } = await query
  return (count ?? 0) > 0
}

async function logTrigger(
  admin: ReturnType<typeof adminClient>,
  automationId: string,
  leadId: string | null,
  conversationId: string | null,
) {
  await admin.from('wa_timed_automation_log').insert({
    automation_id: automationId,
    lead_id: leadId,
    conversation_id: conversationId,
  })
}
