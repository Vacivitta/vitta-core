import type { SupabaseClient } from '@supabase/supabase-js'
import { getWaCredentials } from '@/lib/whatsapp/credentials'

const META_API_URL = 'https://graph.facebook.com/v20.0'

export async function runWaAutomation(
  supabase:       SupabaseClient,
  trigger:        string,
  unitId:         string,
  conversationId: string,
) {
  const { data: automations } = await supabase
    .from('wa_automations')
    .select('action, stage_id, template_id')
    .eq('unit_id', unitId)
    .eq('trigger', trigger)
    .eq('ativo', true)

  if (!automations || automations.length === 0) return

  for (const automation of automations) {
    if (automation.action === 'move_stage' && automation.stage_id) {
      await handleMoveStage(supabase, conversationId, automation.stage_id)
    } else if (automation.action === 'send_template' && automation.template_id) {
      await handleSendTemplate(supabase, unitId, conversationId, automation.template_id)
    }
  }
}

async function handleMoveStage(supabase: SupabaseClient, conversationId: string, stageId: string) {
  const { data: conv } = await supabase
    .from('wa_conversations')
    .select('lead_id')
    .eq('id', conversationId)
    .single()

  if (!conv?.lead_id) return

  await supabase
    .from('leads')
    .update({ stage_id: stageId })
    .eq('id', conv.lead_id)
}

async function handleSendTemplate(
  supabase: SupabaseClient,
  unitId: string,
  conversationId: string,
  templateId: string,
) {
  const { data: conv } = await supabase
    .from('wa_conversations')
    .select('id, wa_phone, lead_id')
    .eq('id', conversationId)
    .single()

  if (!conv?.wa_phone) return

  const { data: template } = await supabase
    .from('wa_message_templates')
    .select('template_name, content, language, variable_order')
    .eq('id', templateId)
    .single()

  if (!template?.template_name) return

  const creds = await getWaCredentials(unitId)
  if (!creds.phoneNumberId || !creds.accessToken) return

  const varCount = (template.content?.match(/\{\{\d+\}\}/g) ?? []).length
  let components: object[] = []
  let renderedText = template.content ?? ''

  if (varCount > 0) {
    const variableValues = await resolveVariables(
      supabase, unitId, conv.lead_id, template.variable_order as string[] | null, varCount,
    )
    components = [{
      type: 'body',
      parameters: variableValues.map(v => ({ type: 'text', text: v })),
    }]
    renderedText = template.content?.replace(
      /\{\{(\d+)\}\}/g,
      (_m: string, n: string) => variableValues[parseInt(n, 10) - 1] ?? `{{${n}}}`,
    ) ?? ''
  }

  const metaPayload = {
    messaging_product: 'whatsapp',
    to: conv.wa_phone,
    type: 'template',
    template: {
      name: template.template_name,
      language: { code: template.language ?? 'pt_BR' },
      components,
    },
  }

  const metaRes = await fetch(`${META_API_URL}/${creds.phoneNumberId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${creds.accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(metaPayload),
    signal: AbortSignal.timeout(15_000),
  })

  const metaData = await metaRes.json() as { messages?: { id: string }[] }

  if (!metaRes.ok) {
    console.error('[wa-automation] send_template failed:', JSON.stringify(metaData))
    return
  }

  const waId = metaData.messages?.[0]?.id ?? null

  await Promise.all([
    supabase.from('wa_messages').insert({
      conversation_id: conversationId,
      unit_id: unitId,
      wa_message_id: waId,
      direction: 'outbound',
      type: 'template',
      content: renderedText,
      template_name: template.template_name,
      status: 'sent',
    }),
    supabase.from('wa_conversations').update({
      last_message_at: new Date().toISOString(),
      last_message_content: renderedText || `📋 ${template.template_name}`,
      last_message_direction: 'outbound',
    }).eq('id', conversationId),
  ])
}

async function resolveVariables(
  supabase: SupabaseClient,
  unitId: string,
  leadId: string | null,
  variableOrder: string[] | null,
  varCount: number,
): Promise<string[]> {
  const order = variableOrder && variableOrder.length === varCount
    ? variableOrder
    : ['nome_cliente', 'nome_atendente', 'data', 'horario'].slice(0, varCount)

  let leadName = ''
  let atendenteName = ''

  if (order.includes('nome_cliente') || order.includes('nome_atendente')) {
    if (leadId) {
      const { data: lead } = await supabase
        .from('leads')
        .select('nome, sobrenome, responsavel_id')
        .eq('id', leadId)
        .single()

      if (lead) {
        leadName = [lead.nome, lead.sobrenome].filter(Boolean).join(' ')
        if (lead.responsavel_id && order.includes('nome_atendente')) {
          const { data: profile } = await supabase
            .from('profiles')
            .select('nome')
            .eq('id', lead.responsavel_id)
            .single()
          atendenteName = profile?.nome ?? ''
        }
      }
    }

    if (!atendenteName && order.includes('nome_atendente')) {
      const { data: unit } = await supabase
        .from('units')
        .select('nome')
        .eq('id', unitId)
        .single()
      atendenteName = unit?.nome ?? 'Equipe'
    }
  }

  const now = new Date()
  return order.map(id => {
    switch (id) {
      case 'nome_cliente':    return leadName || 'Cliente'
      case 'nome_atendente':  return atendenteName || 'Equipe'
      case 'data':            return now.toLocaleDateString('pt-BR')
      case 'horario':         return now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
      default:                return ''
    }
  })
}
