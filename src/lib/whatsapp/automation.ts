import type { SupabaseClient } from '@supabase/supabase-js'
import { getWaCredentials } from '@/lib/whatsapp/credentials'

const META_API_URL = 'https://graph.facebook.com/v20.0'

/**
 * Executa automações configuradas em `wa_automations` para um evento de WhatsApp.
 * Triggers suportados: `inbound_message`, `outbound_message`, `conversation_resolved`.
 *
 * `move_stage` roda a cada evento, mas só a partir de etapas específicas — ver
 * `getMovableStages`: mensagem recebida reabre leads finalizados; mensagem enviada
 * tira o lead da etapa de entrada. Etapas comerciais (Orçamento, Agendado...) não mudam.
 * `send_template` mantém o limite de uma vez por janela de 24h, para não repetir
 * o template a cada mensagem.
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
  const { data: automations } = await supabase
    .from('wa_automations')
    .select('action, stage_id, template_id')
    .eq('unit_id', unitId)
    .eq('trigger', trigger)
    .eq('ativo', true)

  if (!automations || automations.length === 0) return

  for (const automation of automations) {
    if (automation.action === 'move_stage' && automation.stage_id) {
      await handleMoveStage(supabase, unitId, conversationId, automation.stage_id, trigger)
    } else if (automation.action === 'send_template' && automation.template_id) {
      const isMessageTrigger = trigger === 'inbound_message' || trigger === 'outbound_message'
      if (isMessageTrigger && await isRepeatedWithin24h(supabase, conversationId, trigger)) continue
      await handleSendTemplate(supabase, unitId, conversationId, automation.template_id)
    }
  }
}

/**
 * Etapas de onde uma automação de mensagem pode tirar o lead.
 * - Mensagem recebida: só reabre leads da etapa de "conversa resolvida"
 *   (ex.: Finalizados), pois o cliente voltou a escrever. Leads que já estão em
 *   atendimento ficam onde estão — antes cada mensagem do cliente devolvia o lead
 *   para "Sem atendimento" e cada resposta o empurrava de volta (vai-e-volta).
 *   O "cliente aguardando" aparece no alerta do card (ver LeadCard).
 * - Mensagem enviada: tira o lead da etapa de entrada (destino da regra de
 *   mensagem recebida, ex.: Sem atendimento) para "Em atendimento".
 * Etapas comerciais (Orçamento, Agendado, Captações, Perdido) nunca são alteradas.
 *
 * @param supabase - Cliente Supabase
 * @param unitId - ID da unidade
 * @param trigger - Evento que disparou a automação
 * @returns Conjunto de stage_ids de origem permitidos
 */
async function getMovableStages(supabase: SupabaseClient, unitId: string, trigger: string): Promise<Set<string>> {
  const { data: rules } = await supabase
    .from('wa_automations')
    .select('trigger, stage_id')
    .eq('unit_id', unitId)
    .eq('action', 'move_stage')
    .eq('ativo', true)

  const movable = new Set<string>()
  for (const r of rules ?? []) {
    if (!r.stage_id) continue
    if (trigger === 'inbound_message' && r.trigger === 'conversation_resolved') movable.add(r.stage_id)
    if (trigger === 'outbound_message' && r.trigger === 'inbound_message') movable.add(r.stage_id)
  }
  return movable
}

/**
 * Verifica se já houve mensagem na mesma direção (inbound/outbound) nas últimas 24h.
 * Usado para que templates automáticos só sejam enviados na primeira mensagem
 * de uma nova janela de conversa.
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
 * Pula se o lead já está no destino. Para eventos de mensagem, também pula se o
 * lead está numa etapa que a automação não pode alterar (ver `getMovableStages`);
 * `conversation_resolved` move de qualquer etapa. Registra a mudança no histórico.
 *
 * @param supabase - Cliente Supabase
 * @param unitId - ID da unidade (define as etapas que podem ser alteradas)
 * @param conversationId - ID da conversa para localizar o lead
 * @param stageId - ID do estágio destino em `funnel_stages`
 * @param trigger - Evento que disparou a automação
 */
async function handleMoveStage(
  supabase: SupabaseClient,
  unitId: string,
  conversationId: string,
  stageId: string,
  trigger: string,
) {
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

  if (!lead || lead.stage_id === stageId) return

  // Resolver a conversa é uma ação explícita do atendente: move de qualquer etapa.
  // Já as mensagens só movem a partir das etapas de atendimento.
  if (lead.stage_id && trigger !== 'conversation_resolved') {
    const movable = await getMovableStages(supabase, unitId, trigger)
    if (!movable.has(lead.stage_id)) return
  }

  const { data: stage } = await supabase
    .from('funnel_stages')
    .select('funnel_id')
    .eq('id', stageId)
    .single()

  const updatePayload: Record<string, string> = { stage_id: stageId }
  if (stage?.funnel_id) updatePayload.funnel_id = stage.funnel_id

  const { error } = await supabase
    .from('leads')
    .update(updatePayload)
    .eq('id', conv.lead_id)

  if (error) {
    console.error(`[wa-automation] move_stage falhou lead=${conv.lead_id}:`, error.message)
    return
  }

  await supabase.from('lead_stage_history').insert({
    lead_id:       conv.lead_id,
    de_stage_id:   lead.stage_id,
    para_stage_id: stageId,
    movido_por:    null,
    movido_via:    'automacao',
  })
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

  const autoImgUrl = (template.header_type === 'IMAGE' && template.header_image_url) ? template.header_image_url as string : null

  await Promise.all([
    supabase.from('wa_messages').insert({
      conversation_id: conversationId,
      unit_id: unitId,
      wa_message_id: waId,
      direction: 'outbound',
      type: 'template',
      content: renderedText,
      template_name: template.template_name,
      media_url: autoImgUrl,
      media_mime_type: autoImgUrl ? 'image/jpeg' : null,
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
