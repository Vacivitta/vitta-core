/**
 * POST /api/whatsapp/process-timed-automations
 *
 * Processa automações baseadas em tempo: leads parados, conversas sem resposta, etc.
 * Deve ser chamado a cada hora via pg_cron ou cron externo.
 *
 * Cada execução é gravada em `automation_runs`. `wa_timed_automation_log` continua
 * sendo a trava de "dispara uma vez" por lead/conversa. Um alvo com 3 execuções
 * sem sucesso (falhou ou pulado) nas últimas 24h fica de fora até a janela passar,
 * para a mesma falha não se repetir a cada hora.
 *
 * Authorization: Bearer <CRON_SECRET>
 */
import { NextRequest, NextResponse } from 'next/server'
import { cronAutorizado } from '@/lib/auth/cron'
import { createClient } from '@supabase/supabase-js'
import { getWaCredentials } from '@/lib/whatsapp/credentials'
import { resumoErro } from '@/lib/log-seguro'
import {
  falha,
  registrarExecucao,
  tentativasSemSucessoRecentes,
  type ResultadoAutomacao,
} from '@/lib/automacoes/execucao'
import { moverLeadDeEtapa } from '@/lib/automacoes/mover-etapa'

const META_API_URL = 'https://graph.facebook.com/v20.0'
const MAX_TENTATIVAS_SEM_SUCESSO_24H = 3
export const maxDuration = 60

type Admin = ReturnType<typeof adminClient>

interface TimedAutomation {
  id:               string
  unit_id:          string
  condition:        string
  threshold_hours:  number
  action:           string
  template_id:      string | null
  action_stage_id:  string | null
  filter_stage_id:  string | null
  filter_funnel_id: string | null
}

type Acao =
  | { kind: 'send_template'; templateId: string }
  | { kind: 'move_stage'; stageId: string }

interface Conversa { id: string; wa_phone: string | null; lead_id: string | null; unit_id: string }
interface Alvo { leadId: string | null; conversationId: string | null }

const CONDICOES = new Set(['no_patient_reply', 'lead_stuck_stage', 'no_agent_reply', 'lead_no_task'])

function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Missing Supabase env vars')
  return createClient(url, key)
}

export async function POST(req: NextRequest) {
  if (!cronAutorizado(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const admin = adminClient()

  const { data: automations } = await admin
    .from('wa_timed_automations')
    .select('id, unit_id, condition, threshold_hours, action, template_id, action_stage_id, filter_stage_id, filter_funnel_id')
    .eq('ativo', true)
    .returns<TimedAutomation[]>()

  if (!automations || automations.length === 0) {
    return NextResponse.json({ processed: 0 })
  }

  let totalProcessed = 0

  for (const auto of automations) {
    try {
      const count = await processAutomation(admin, auto)
      totalProcessed += count
    } catch (e) {
      console.error(`[timed-auto] erro automation=${auto.id} condition=${auto.condition}:`, resumoErro(e))
    }
  }

  return NextResponse.json({ processed: totalProcessed })
}

function acaoDa(auto: TimedAutomation): Acao | null {
  if (auto.action === 'send_template' && auto.template_id) return { kind: 'send_template', templateId: auto.template_id }
  if (auto.action === 'move_stage' && auto.action_stage_id) return { kind: 'move_stage', stageId: auto.action_stage_id }
  return null
}

async function processAutomation(admin: Admin, auto: TimedAutomation): Promise<number> {
  const acao = acaoDa(auto)
  if (!acao || !CONDICOES.has(auto.condition)) {
    await registrarMalConfigurada(admin, auto)
    return 0
  }

  const cutoff = new Date(Date.now() - auto.threshold_hours * 3600_000).toISOString()

  switch (auto.condition) {
    case 'no_patient_reply':
      return processNoPatientReply(admin, auto, acao, cutoff)
    case 'lead_stuck_stage':
      return processLeadStuckStage(admin, auto, acao, cutoff)
    case 'no_agent_reply':
      return processNoAgentReply(admin, auto, acao, cutoff)
    case 'lead_no_task':
      return processLeadNoTask(admin, auto, acao)
    default:
      return 0
  }
}

async function registrarMalConfigurada(admin: Admin, auto: TimedAutomation) {
  const semAlvo: Alvo = { leadId: null, conversationId: null }
  if (await tentativasSemSucessoRecentes(admin, auto.id, semAlvo, ['pulado']) > 0) return
  await registrarExecucao(admin, contexto(auto, semAlvo), { kind: 'pulado', motivo: 'mal_configurada' })
}

async function processNoPatientReply(admin: Admin, auto: TimedAutomation, acao: Acao, cutoff: string) {
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

  const { data: convs } = await query.returns<Conversa[]>()
  if (!convs || convs.length === 0) return 0

  return executeForConversations(admin, auto, acao, convs)
}

async function processNoAgentReply(admin: Admin, auto: TimedAutomation, acao: Acao, cutoff: string) {
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

  const { data: convs } = await query.returns<Conversa[]>()
  if (!convs || convs.length === 0) return 0

  return executeForConversations(admin, auto, acao, convs)
}

async function processLeadStuckStage(admin: Admin, auto: TimedAutomation, acao: Acao, cutoff: string) {
  if (!auto.filter_stage_id) return 0

  let query = admin
    .from('leads')
    .select('id, unit_id')
    .eq('unit_id', auto.unit_id)
    .eq('stage_id', auto.filter_stage_id)
    .eq('arquivado', false)
    // stage_changed_at = entrada na etapa; updated_at muda com qualquer edição do lead
    .lt('stage_changed_at', cutoff)
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

  return executeForLeads(admin, auto, acao, leads)
}

async function processLeadNoTask(admin: Admin, auto: TimedAutomation, acao: Acao) {
  const { data: leads } = await admin
    .from('leads')
    .select('id, unit_id')
    .eq('unit_id', auto.unit_id)
    .eq('arquivado', false)
    .limit(200)

  if (!leads || leads.length === 0) return 0

  const leadIds = leads.map(l => l.id)
  const { data: tasksWithLead, error: tasksErr } = await admin
    .from('lead_tasks')
    .select('lead_id')
    .in('lead_id', leadIds)
    .gte('data_limite', new Date().toISOString())
    .eq('concluida', false)

  // Sem essa checagem, uma falha na consulta faria todos os leads parecerem "sem tarefa"
  if (tasksErr) {
    console.error(`[timed-auto] lead_no_task: erro ao buscar tarefas automation=${auto.id}:`, tasksErr.message)
    return 0
  }

  const leadsWithTask = new Set((tasksWithLead ?? []).map(t => t.lead_id))
  const leadsWithout = leads.filter(l => !leadsWithTask.has(l.id))

  if (leadsWithout.length === 0) return 0

  return executeForLeads(admin, auto, acao, leadsWithout)
}

async function getFilteredLeadIds(admin: Admin, auto: TimedAutomation): Promise<string[]> {
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

async function executeForConversations(admin: Admin, auto: TimedAutomation, acao: Acao, convs: Conversa[]) {
  let count = 0
  for (const conv of convs) {
    if (await wasAlreadyTriggered(admin, auto.id, conv.lead_id, conv.id)) continue

    const alvo: Alvo = { leadId: conv.lead_id, conversationId: conv.id }
    if (await excedeuTentativas(admin, auto.id, alvo)) continue

    const resultado = await tentar(() => acao.kind === 'send_template'
      ? sendTemplateToConv(admin, auto.unit_id, conv, acao.templateId)
      : moverPorTempo(admin, conv.lead_id, acao.stageId))

    if (await concluir(admin, auto, alvo, resultado)) count++
  }
  return count
}

async function executeForLeads(admin: Admin, auto: TimedAutomation, acao: Acao, leads: { id: string; unit_id: string }[]) {
  let count = 0
  for (const lead of leads) {
    if (await wasAlreadyTriggered(admin, auto.id, lead.id, null)) continue
    if (await excedeuTentativas(admin, auto.id, { leadId: lead.id, conversationId: null })) continue

    if (acao.kind === 'move_stage') {
      const alvo: Alvo = { leadId: lead.id, conversationId: null }
      const resultado = await tentar(() => moverPorTempo(admin, lead.id, acao.stageId))
      if (await concluir(admin, auto, alvo, resultado)) count++
      continue
    }

    const { data: conv, error: convErr } = await admin
      .from('wa_conversations')
      .select('id, wa_phone, lead_id, unit_id')
      .eq('lead_id', lead.id)
      .eq('unit_id', auto.unit_id)
      .order('last_message_at', { ascending: false })
      .limit(1)
      .maybeSingle<Conversa>()

    const alvo: Alvo = { leadId: lead.id, conversationId: conv?.id ?? null }
    if (convErr) {
      await concluir(admin, auto, alvo, falha('banco', convErr))
      continue
    }
    const resultado: ResultadoAutomacao = conv
      ? await tentar(() => sendTemplateToConv(admin, auto.unit_id, conv, acao.templateId))
      : { kind: 'pulado', motivo: 'sem_conversa' }

    if (await concluir(admin, auto, alvo, resultado)) count++
  }
  return count
}

async function tentar(executar: () => Promise<ResultadoAutomacao>): Promise<ResultadoAutomacao> {
  try {
    return await executar()
  } catch (e) {
    return falha('banco', e)
  }
}

async function excedeuTentativas(admin: Admin, automationId: string, alvo: Alvo): Promise<boolean> {
  return await tentativasSemSucessoRecentes(admin, automationId, alvo) >= MAX_TENTATIVAS_SEM_SUCESSO_24H
}

function contexto(auto: TimedAutomation, alvo: Alvo) {
  return {
    unitId:         auto.unit_id,
    origem:         'tempo' as const,
    automationId:   auto.id,
    gatilho:        auto.condition,
    acao:           auto.action,
    leadId:         alvo.leadId,
    conversationId: alvo.conversationId,
  }
}

function disparoConsumado(resultado: ResultadoAutomacao): boolean {
  switch (resultado.kind) {
    case 'etapa_movida':
    case 'modelo_enviado':
      return true
    case 'pulado':
      return resultado.motivo === 'ja_na_etapa'
    case 'falhou':
      return resultado.etapa === 'banco_apos_envio'
  }
}

async function concluir(
  admin: Admin, auto: TimedAutomation, alvo: Alvo, resultado: ResultadoAutomacao,
): Promise<boolean> {
  await registrarExecucao(admin, contexto(auto, alvo), resultado)
  if (!disparoConsumado(resultado)) return false
  await logTrigger(admin, auto.id, alvo.leadId, alvo.conversationId)
  return resultado.kind === 'etapa_movida' || resultado.kind === 'modelo_enviado'
}

async function moverPorTempo(admin: Admin, leadId: string | null, stageId: string): Promise<ResultadoAutomacao> {
  if (!leadId) return { kind: 'pulado', motivo: 'sem_lead' }

  const { data: lead, error } = await admin
    .from('leads')
    .select('id, stage_id')
    .eq('id', leadId)
    .maybeSingle<{ id: string; stage_id: string | null }>()

  if (error) return falha('banco', error)
  if (!lead) return { kind: 'pulado', motivo: 'sem_lead' }

  return moverLeadDeEtapa(admin, lead, stageId)
}

async function sendTemplateToConv(
  admin: Admin,
  unitId: string,
  conv: { id: string; wa_phone: string | null },
  templateId: string,
): Promise<ResultadoAutomacao> {
  if (!conv.wa_phone) return { kind: 'pulado', motivo: 'sem_telefone' }

  const { data: template } = await admin
    .from('wa_message_templates')
    .select('template_name, content, language, variable_order')
    .eq('id', templateId)
    .maybeSingle()

  if (!template?.template_name) return { kind: 'pulado', motivo: 'modelo_ausente' }

  const creds = await getWaCredentials(unitId)
  if (!creds.phoneNumberId || !creds.accessToken) return { kind: 'pulado', motivo: 'sem_credenciais' }

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

  let metaRes: Response
  try {
    metaRes = await fetch(`${META_API_URL}/${creds.phoneNumberId}/messages`, {
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
  } catch (e) {
    console.error(`[timed-auto] Meta sem resposta conv=${conv.id}:`, resumoErro(e))
    return falha('meta', e)
  }

  const metaData = await metaRes.json().catch(() => null) as { messages?: { id: string }[] } | null

  if (!metaRes.ok) {
    console.error(`[timed-auto] Meta send failed conv=${conv.id}:`, resumoErro(metaData))
    return falha('meta', metaData ?? `HTTP ${metaRes.status}`, metaRes.status)
  }

  const waId = metaData?.messages?.[0]?.id ?? null

  const [{ error: msgErr }, { error: convErr }] = await Promise.all([
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

  if (msgErr || convErr) return falha('banco_apos_envio', msgErr ?? convErr)

  return { kind: 'modelo_enviado', templateId, waMessageId: waId }
}

async function wasAlreadyTriggered(
  admin: Admin,
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
  admin: Admin,
  automationId: string,
  leadId: string | null,
  conversationId: string | null,
) {
  const { error } = await admin.from('wa_timed_automation_log').insert({
    automation_id: automationId,
    lead_id: leadId,
    conversation_id: conversationId,
  })
  if (error) console.error(`[timed-auto] logTrigger falhou automation=${automationId}:`, resumoErro(error))
}
