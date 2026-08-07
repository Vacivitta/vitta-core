import type { SupabaseClient } from '@supabase/supabase-js'
import { getWaCredentials } from '@/lib/whatsapp/credentials'

const META_API_URL = 'https://graph.facebook.com/v20.0'

/**
 * Executa automações configuradas em `wa_automations` para um evento de WhatsApp.
 * Triggers suportados: `inbound_message`, `outbound_message`, `conversation_resolved`.
 *
 * Para inbound/outbound, só dispara se não houve mensagem na mesma direção
 * nas últimas 24h — evita loop de ping-pong entre estágios do funil.
 *
 * @param supabase - Cliente Supabase (service-role, chamado do webhook/send)
 * @param trigger - Tipo do evento: 'inbound_message' | 'outbound_message' | 'conversation_resolved'
 * @param unitId - ID da unidade (clínica) que recebeu/enviou a mensagem
 * @param conversationId - ID da conversa em `wa_conversations`
 */
export async function runWaAutomation(
  supabase:       SupabaseClient,
  trigger:        string,
  unitId:         string,
  conversationId: string,
) {
  if (trigger === 'inbound_message' || trigger === 'outbound_message') {
    const shouldSkip = await isRepeatedWithin24h(supabase, conversationId, trigger)
    if (shouldSkip) return
  }

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

/**
 * Verifica se já houve mensagem na mesma direção (inbound/outbound) nas últimas 24h.
 * Usado para garantir que a automação só dispare na primeira mensagem de uma
 * nova janela de conversa, respeitando o ciclo de 24h da API do WhatsApp.
 *
 * @param supabase - Cliente Supabase
 * @param conversationId - ID da conversa
 * @param trigger - Tipo do trigger para determinar a direção (inbound/outbound)
 * @returns `true` se deve pular a automação (já houve mensagem recente)
 */
async function isRepeatedWithin24h(
  supabase: SupabaseClient,
  conversationId: string,
  trigger: string,
): Promise<boolean> {
  const direction = trigger === 'inbound_message' ? 'inbound' : 'outbound'

  const { data: messages } = await supabase
    .from('wa_messages')
    .select('created_at')
    .eq('conversation_id', conversationId)
    .eq('direction', direction)
    .order('created_at', { ascending: false })
    .limit(2)

  if (!messages || messages.length < 2) return false

  // A mensagem [0] é a atual (já inserida); [1] é a anterior.
  // Se a anterior tem menos de 24h, a automação já foi executada nessa janela.
  const previousMsg = messages[1]
  const hoursSince = (Date.now() - new Date(previousMsg.created_at).getTime()) / (1000 * 60 * 60)
  return hoursSince < 24
}

/**
 * Move o lead associado à conversa para um estágio do funil.
 * Atualiza tanto `stage_id` quanto `funnel_id` para evitar que o card
 * desapareça do kanban quando o estágio destino pertence a outro funil.
 * Pula a operação se o lead já está no estágio destino.
 *
 * @param supabase - Cliente Supabase
 * @param conversationId - ID da conversa para localizar o lead
 * @param stageId - ID do estágio destino em `funnel_stages`
 */
async function handleMoveStage(supabase: SupabaseClient, conversationId: string, stageId: string) {
  const { data: conv } = await supabase
    .from('wa_conversations')
    .select('lead_id')
    .eq('id', conversationId)
    .single()

  if (!conv?.lead_id) return

  const { data: lead } = await supabase
    .from('leads')
    .select('stage_id')
    .eq('id', conv.lead_id)
    .single()

  if (lead?.stage_id === stageId) return

  const { data: stage } = await supabase
    .from('funnel_stages')
    .select('funnel_id')
    .eq('id', stageId)
    .single()

  const updatePayload: Record<string, string> = { stage_id: stageId }
  if (stage?.funnel_id) updatePayload.funnel_id = stage.funnel_id

  await supabase
    .from('leads')
    .update(updatePayload)
    .eq('id', conv.lead_id)
}

/**
 * Envia um template de WhatsApp automaticamente para o contato da conversa.
 * Resolve variáveis dinâmicas (nome do cliente, atendente, data, horário),
 * monta o payload da Meta Graph API v20.0, envia e registra em `wa_messages`.
 *
 * @param supabase - Cliente Supabase
 * @param unitId - ID da unidade para buscar credenciais WhatsApp
 * @param conversationId - ID da conversa (destino e registro)
 * @param templateId - ID do template em `wa_message_templates`
 */
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
    .select('template_name, content, language, variable_order, header_type, header_image_url')
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

  if (template.header_type === 'IMAGE' && template.header_image_url) {
    components = [
      { type: 'header', parameters: [{ type: 'image', image: { link: template.header_image_url } }] },
      ...components,
    ]
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

/**
 * Resolve variáveis dinâmicas de um template (ex: `{{1}}`, `{{2}}`).
 * A ordem das variáveis vem de `variable_order` no banco; se ausente,
 * usa o fallback padrão: nome_cliente, nome_atendente, data, horario.
 * Se não encontrar o atendente responsável, usa o nome da unidade como fallback.
 *
 * @param supabase - Cliente Supabase
 * @param unitId - ID da unidade (fallback para nome do atendente)
 * @param leadId - ID do lead para buscar nome e responsável
 * @param variableOrder - Mapeamento posição → semântica salvo no template
 * @param varCount - Quantidade de variáveis `{{N}}` no conteúdo do template
 * @returns Array de valores resolvidos na ordem das variáveis
 */
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
