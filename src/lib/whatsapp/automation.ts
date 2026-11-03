import type { SupabaseClient } from '@supabase/supabase-js'
import { getWaCredentials } from '@/lib/whatsapp/credentials'
import { resumoErro } from '@/lib/log-seguro'
import { contarVariaveis, montarComponentesTemplate, resolveVariables } from '@/lib/whatsapp/template-variaveis'
import {
  falha,
  registrarExecucao,
  tentativasSemSucessoRecentes,
  type ContextoExecucao,
  type MotivoPulo,
  type ResultadoAutomacao,
} from '@/lib/automacoes/execucao'
import { moverLeadDeEtapa } from '@/lib/automacoes/mover-etapa'

const META_API_URL = 'https://graph.facebook.com/v20.0'

const PULOS_DE_ROTINA_POR_MENSAGEM: ReadonlySet<MotivoPulo> = new Set<MotivoPulo>([
  'sem_lead', 'ja_na_etapa', 'etapa_nao_movivel',
])

interface ConversaAlvo { lead_id: string | null; wa_phone: string | null }

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
 * Cada execução é gravada em `automation_runs`, exceto os pulos de rotina das
 * mensagens. Nunca lança: quem chama já enviou ou recebeu a mensagem.
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
): Promise<void> {
  try {
    await executarAutomacoes(supabase, trigger, unitId, conversationId)
  } catch (e) {
    console.error(`[wa-automation] erro inesperado trigger=${trigger} conversa=${conversationId}:`, resumoErro(e))
  }
}

async function executarAutomacoes(
  supabase:       SupabaseClient,
  trigger:        string,
  unitId:         string,
  conversationId: string,
) {
  const { data: automations, error } = await supabase
    .from('wa_automations')
    .select('id, action, stage_id, template_id')
    .eq('unit_id', unitId)
    .eq('trigger', trigger)
    .eq('ativo', true)

  if (error) {
    console.error(`[wa-automation] leitura de wa_automations falhou unidade=${unitId}:`, resumoErro(error))
    return
  }
  const comAcao = (automations ?? []).filter(a => a.action === 'move_stage' || a.action === 'send_template')
  if (comAcao.length === 0) return

  const isMessageTrigger = trigger === 'inbound_message' || trigger === 'outbound_message'

  const { data: conv } = await supabase
    .from('wa_conversations')
    .select('lead_id, wa_phone')
    .eq('id', conversationId)
    .maybeSingle<ConversaAlvo>()

  for (const automation of comAcao) {
    const contexto: ContextoExecucao = {
      unitId,
      origem:         'evento',
      automationId:   automation.id,
      gatilho:        trigger,
      acao:           automation.action,
      leadId:         conv?.lead_id ?? null,
      conversationId,
    }

    if (automation.action === 'send_template' && automation.template_id && isMessageTrigger
        && await isRepeatedWithin24h(supabase, conversationId, trigger)) continue

    const alvo = automation.action === 'move_stage' ? automation.stage_id : automation.template_id
    if (!alvo) {
      await registrarMalConfigurada(supabase, contexto)
      continue
    }

    let resultado: ResultadoAutomacao
    try {
      resultado = automation.action === 'move_stage'
        ? await handleMoveStage(supabase, unitId, conv?.lead_id ?? null, alvo, trigger)
        : await handleSendTemplate(supabase, unitId, conversationId, conv, alvo)
    } catch (e) {
      resultado = falha('banco', e)
    }

    if (resultado.kind === 'pulado' && isMessageTrigger && PULOS_DE_ROTINA_POR_MENSAGEM.has(resultado.motivo)) continue
    await registrarExecucao(supabase, contexto, resultado)
  }
}

async function registrarMalConfigurada(supabase: SupabaseClient, contexto: ContextoExecucao) {
  const semAlvo = { ...contexto, leadId: null, conversationId: null }
  if (await tentativasSemSucessoRecentes(supabase, contexto.automationId, semAlvo, ['pulado']) > 0) return
  await registrarExecucao(supabase, semAlvo, { kind: 'pulado', motivo: 'mal_configurada' })
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
 * Move o lead da conversa para um estágio do funil (ver `moverLeadDeEtapa`).
 * Pula se o lead já está no destino. Para eventos de mensagem, também pula se o
 * lead está numa etapa que a automação não pode alterar (ver `getMovableStages`);
 * `conversation_resolved` move de qualquer etapa.
 *
 * @param supabase - Cliente Supabase
 * @param unitId - ID da unidade (define as etapas que podem ser alteradas)
 * @param leadId - Lead da conversa
 * @param stageId - ID do estágio destino em `funnel_stages`
 * @param trigger - Evento que disparou a automação
 */
async function handleMoveStage(
  supabase: SupabaseClient,
  unitId: string,
  leadId: string | null,
  stageId: string,
  trigger: string,
): Promise<ResultadoAutomacao> {
  if (!leadId) return { kind: 'pulado', motivo: 'sem_lead' }

  const { data: lead, error } = await supabase
    .from('leads')
    .select('id, stage_id')
    .eq('id', leadId)
    .maybeSingle<{ id: string; stage_id: string | null }>()

  if (error) return falha('banco', error)
  if (!lead) return { kind: 'pulado', motivo: 'sem_lead' }
  if (lead.stage_id === stageId) return { kind: 'pulado', motivo: 'ja_na_etapa' }

  // Resolver a conversa é uma ação explícita do atendente: move de qualquer etapa.
  // Já as mensagens só movem a partir das etapas de atendimento.
  if (lead.stage_id && trigger !== 'conversation_resolved') {
    const movable = await getMovableStages(supabase, unitId, trigger)
    if (!movable.has(lead.stage_id)) return { kind: 'pulado', motivo: 'etapa_nao_movivel' }
  }

  return moverLeadDeEtapa(supabase, lead, stageId)
}

/**
 * Envia um template de WhatsApp automaticamente para o contato da conversa.
 * Resolve variáveis dinâmicas (nome do cliente, atendente, data, horário),
 * monta o payload da Meta Graph API v20.0, envia e registra em `wa_messages`.
 * Um `falhou` de banco aqui significa que a Meta já aceitou a mensagem.
 *
 * @param supabase - Cliente Supabase
 * @param unitId - ID da unidade para buscar credenciais WhatsApp
 * @param conversationId - ID da conversa (destino e registro)
 * @param conv - Telefone e lead da conversa
 * @param templateId - ID do template em `wa_message_templates`
 */
async function handleSendTemplate(
  supabase: SupabaseClient,
  unitId: string,
  conversationId: string,
  conv: ConversaAlvo | null,
  templateId: string,
): Promise<ResultadoAutomacao> {
  if (!conv?.wa_phone) return { kind: 'pulado', motivo: 'sem_telefone' }

  const { data: template, error: templateErr } = await supabase
    .from('wa_message_templates')
    .select('template_name, content, language, variable_order, header_type, header_image_url')
    .eq('id', templateId)
    .maybeSingle()

  if (templateErr) return falha('banco', templateErr)
  if (!template?.template_name) return { kind: 'pulado', motivo: 'modelo_ausente' }

  const creds = await getWaCredentials(unitId)
  if (!creds.phoneNumberId || !creds.accessToken) return { kind: 'pulado', motivo: 'sem_credenciais' }

  const varCount = contarVariaveis(template.content)
  const variableValues = varCount > 0
    ? await resolveVariables(supabase, unitId, conv.lead_id, template.variable_order as string[] | null, varCount)
    : []
  const { components, renderedText } = montarComponentesTemplate(template, variableValues)

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

  let metaRes: Response
  try {
    metaRes = await fetch(`${META_API_URL}/${creds.phoneNumberId}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${creds.accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(metaPayload),
      signal: AbortSignal.timeout(15_000),
    })
  } catch (e) {
    console.error(`[wa-automation] send_template sem resposta da Meta conversa=${conversationId}:`, resumoErro(e))
    return falha('meta', e)
  }

  const metaData = await metaRes.json().catch(() => null) as { messages?: { id: string }[] } | null

  if (!metaRes.ok) {
    console.error(`[wa-automation] send_template failed conversa=${conversationId}:`, resumoErro(metaData))
    return falha('meta', metaData ?? `HTTP ${metaRes.status}`, metaRes.status)
  }

  const waId = metaData?.messages?.[0]?.id ?? null

  const autoImgUrl = (template.header_type === 'IMAGE' && template.header_image_url) ? template.header_image_url as string : null

  const [{ error: msgErr }, { error: convErr }] = await Promise.all([
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

  if (msgErr || convErr) return falha('banco_apos_envio', msgErr ?? convErr)

  return { kind: 'modelo_enviado', templateId, waMessageId: waId }
}
