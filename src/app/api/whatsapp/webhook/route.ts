import { NextRequest, NextResponse } from 'next/server'
import { createClient }             from '@supabase/supabase-js'
import { runAutoAssign }            from '../auto-assign/route'
import { isValidVerifyToken }       from '@/lib/whatsapp/credentials'

function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('[WA] NEXT_PUBLIC_SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY não configurados')
  return createClient(url, key)
}

// ── GET: verificação do webhook pelo Meta ─────────────────────────────────────
export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const mode      = searchParams.get('hub.mode')
  const token     = searchParams.get('hub.verify_token')
  const challenge = searchParams.get('hub.challenge')

  if (mode === 'subscribe' && token && await isValidVerifyToken(token)) {
    console.log('[WA webhook] verificado com sucesso')
    return new NextResponse(challenge, { status: 200 })
  }

  console.warn('[WA webhook] falha na verificação — token inválido')
  return new NextResponse('Forbidden', { status: 403 })
}

// ── POST: receber eventos do Meta ─────────────────────────────────────────────
export async function POST(req: NextRequest) {
  let body: WAPayload
  try {
    body = await req.json()
  } catch {
    return new NextResponse('Bad Request', { status: 400 })
  }

  for (const entry of body.entry ?? []) {
    for (const change of entry.changes ?? []) {
      if (change.field !== 'messages') continue
      const value = change.value

      for (const msg of value.messages ?? []) {
        await handleInboundMessage(value, msg)
      }

      for (const status of value.statuses ?? []) {
        await handleStatusUpdate(status, value.metadata.phone_number_id)
      }
    }
  }

  return new NextResponse('OK', { status: 200 })
}

// ── Helpers ──────────────────────────────────────────────────────────────────

async function resolveUnitId(supabase: ReturnType<typeof adminClient>, phoneNumberId: string): Promise<string | null> {
  const { data } = await supabase
    .from('wa_config')
    .select('unit_id')
    .eq('phone_number_id', phoneNumberId)
    .maybeSingle()
  return data?.unit_id ?? null
}

// ── Handlers ──────────────────────────────────────────────────────────────────

async function handleInboundMessage(value: WAValue, msg: WAMessage) {
  const supabase    = adminClient()
  const unitId      = await resolveUnitId(supabase, value.metadata.phone_number_id)
  const waPhone     = msg.from
  const contactName = value.contacts?.[0]?.profile?.name ?? null

  if (!unitId) {
    console.error('[WA webhook] phone_number_id não mapeado para nenhuma unidade:', value.metadata.phone_number_id)
    return
  }

  // 1. Upsert da conversa
  const { data: conv, error: convErr } = await supabase
    .from('wa_conversations')
    .upsert(
      { unit_id: unitId, wa_phone: waPhone, wa_contact_name: contactName },
      { onConflict: 'unit_id,wa_phone', ignoreDuplicates: false }
    )
    .select('id, lead_id')
    .maybeSingle()

  if (convErr || !conv) {
    console.error('[WA webhook] erro ao upsert conversa:', convErr)
    return
  }

  // 2. Inserir mensagem (ignora duplicatas)
  const content = extractContent(msg)
  const { error: msgErr } = await supabase
    .from('wa_messages')
    .upsert(
      {
        conversation_id: conv.id,
        unit_id:         unitId,
        wa_message_id:   msg.id,
        direction:       'inbound',
        type:            normalizeType(msg.type),
        content:         content.text,
        media_url:       content.mediaUrl,
        media_mime_type: content.mimeType,
        status:          'delivered',
      },
      { onConflict: 'wa_message_id', ignoreDuplicates: true }
    )

  if (msgErr) {
    console.error('[WA webhook] erro ao inserir mensagem:', msgErr)
    return
  }

  // 3. Atualiza last_message_at + unread
  const { error: updErr } = await supabase
    .from('wa_conversations')
    .update({ last_message_at: new Date().toISOString(), status: 'open' })
    .eq('id', conv.id)
  if (updErr) console.error('[WA webhook] update last_message_at:', updErr.message)

  const { error: unreadErr } = await supabase.rpc('increment_wa_unread', { p_conversation_id: conv.id })
  if (unreadErr) console.error('[WA webhook] increment_wa_unread:', unreadErr.message)

  // 3b. Detecta opt-out ANTES de criar/vincular lead — aplica para contatos novos e existentes
  const textNorm = (content.text ?? '').trim().toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  const OPTOUT_WORDS = ['PARAR', 'STOP', 'CANCELAR', 'SAIR', 'NAO QUERO', 'DESCADASTRAR']
  const isOptOut = OPTOUT_WORDS.includes(textNorm)

  if (isOptOut && conv.lead_id) {
    // Lead já existia — marcar opt-out agora
    const { data: leadBefore } = await supabase
      .from('leads')
      .select('wa_optout_at, campanha_id')
      .eq('id', conv.lead_id)
      .single()

    if (!leadBefore?.wa_optout_at) {
      await supabase
        .from('leads')
        .update({ wa_optout_at: new Date().toISOString() })
        .eq('id', conv.lead_id)

      if (leadBefore?.campanha_id) {
        await supabase
          .from('wa_campaign_recipients')
          .update({ status: 'skipped', error_msg: 'opt-out recebido' })
          .eq('campaign_id', leadBefore.campanha_id)
          .eq('lead_id', conv.lead_id)
          .in('status', ['sent', 'delivered', 'read'])

        await refreshCampaignCounters(supabase, leadBefore.campanha_id)
      }
    }
  }

  // 3c. Auto-autorização WA: só registra optin se não for opt-out
  if (conv.lead_id && !isOptOut) {
    await supabase
      .from('leads')
      .update({ wa_optin_at: new Date().toISOString() })
      .eq('id', conv.lead_id)
      .is('wa_optin_at', null)
  }

  // 4. Auto-vincular / criar lead — captura o ID resolvido para uso nos blocos seguintes
  // isOptOut é passado para que leads novos que mandaram STOP sejam criados com wa_optout_at
  let resolvedLeadId = conv.lead_id
  if (!conv.lead_id) {
    resolvedLeadId = await autoLinkOrCreateLead(supabase, conv.id, unitId, waPhone, contactName, isOptOut)
  }

  // 4b. Verifica campanha — lead existente ou contato XLS sem lead
  // Caso 1: lead vinculado (pré-existente ou recém-criado) — verifica reply de campanha
  if (resolvedLeadId) {
    const { data: recip } = await supabase
      .from('wa_campaign_recipients')
      .select('id, campaign_id')
      .eq('lead_id', resolvedLeadId)
      .in('status', ['sent', 'delivered', 'read'])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (recip) {
      await supabase.from('wa_campaign_recipients').update({
        status: 'replied', replied_at: new Date().toISOString(),
      }).eq('id', recip.id)
      await supabase.from('leads')
        .update({ campanha_id: recip.campaign_id })
        .eq('id', resolvedLeadId)
        .is('campanha_id', null)
      await refreshCampaignCounters(supabase, recip.campaign_id)
    }
  } else {
    // Caso 2: sem lead — verifica se número é destinatário XLS (lead_id IS NULL)
    const { data: xlsRecip } = await supabase
      .from('wa_campaign_recipients')
      .select('id, campaign_id, nome')
      .eq('phone', waPhone)
      .is('lead_id', null)
      .in('status', ['sent', 'delivered', 'read', 'pending'])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (xlsRecip) {
      // Cria lead agora que a pessoa respondeu
      const defaultStage = await getDefaultStage(supabase, unitId)
      if (defaultStage) {
        const { nome: nomeCompleto, sobrenome } = splitName(xlsRecip.nome ?? contactName)
        const { data: newLead } = await supabase.from('leads').insert({
          unit_id:     unitId,
          nome:        nomeCompleto,
          sobrenome,
          telefone:    formatPhone(waPhone),
          origem:      'campanha_whatsapp',
          funnel_id:   defaultStage.funnel_id,
          stage_id:    defaultStage.stage_id,
          arquivado:   false,
          wa_optin_at: new Date().toISOString(),
          campanha_id: xlsRecip.campaign_id,
        }).select('id').single()

        if (newLead) {
          // Vincula lead ao destinatário e à conversa
          await supabase.from('wa_campaign_recipients').update({
            lead_id:    newLead.id,
            status:     'replied',
            replied_at: new Date().toISOString(),
          }).eq('id', xlsRecip.id)

          await supabase.from('wa_conversations').update({ lead_id: newLead.id }).eq('id', conv.id)
          await refreshCampaignCounters(supabase, xlsRecip.campaign_id)
        }
      }
    }
  }

  // 4c. Auto-cria cliente se o lead ainda não tem um
  if (resolvedLeadId) await autoCreateClient(supabase, resolvedLeadId, unitId)

  // 5. Tenta auto-distribuir — re-fetch para ter queue_id e assigned_to atualizados
  const { data: fresh } = await supabase
    .from('wa_conversations')
    .select('queue_id, assigned_to')
    .eq('id', conv.id)
    .single()
  if (fresh?.queue_id && !fresh?.assigned_to) {
    try {
      await runAutoAssign(supabase, conv.id, fresh.queue_id as string)
    } catch (e) {
      console.error('[WA webhook] runAutoAssign falhou:', e)
    }
  }
}

// ── Auto-criar cliente quando lead faz contato pela primeira vez ──────────────

async function autoCreateClient(
  supabase: ReturnType<typeof adminClient>,
  leadId:   string,
  unitId:   string,
) {
  const { data: lead } = await supabase
    .from('leads')
    .select('client_id, nome, sobrenome, telefone')
    .eq('id', leadId)
    .single()

  if (!lead || lead.client_id) return // já tem cliente

  // Garante que não existe cliente órfão com este lead_id
  const { data: existing } = await supabase
    .from('clients')
    .select('id')
    .eq('lead_id', leadId)
    .maybeSingle()

  if (existing) {
    await supabase.from('leads').update({ client_id: existing.id }).eq('id', leadId)
    return
  }

  const { data: client } = await supabase
    .from('clients')
    .insert({ unit_id: unitId, lead_id: leadId, nome: lead.nome, sobrenome: lead.sobrenome, telefone: lead.telefone })
    .select('id')
    .single()

  if (client) {
    await supabase.from('leads').update({ client_id: client.id }).eq('id', leadId)
    console.log(`[WA webhook] cliente criado automaticamente: ${client.id} → lead ${leadId}`)
  }
}

// ── Auto-link: busca lead existente pelo telefone ou cria novo ────────────────

async function autoLinkOrCreateLead(
  supabase:    ReturnType<typeof adminClient>,
  convId:      string,
  unitId:      string,
  waPhone:     string,   // E.164 sem '+', ex: "5511984535197"
  contactName: string | null,
  isOptOut     = false,
): Promise<string | null> {
  // Normaliza: só dígitos do waPhone, e versão sem DDI (últimos 11 dígitos)
  const digitsAll   = waPhone.replace(/\D/g, '')
  const digitsShort = digitsAll.length > 11 ? digitsAll.slice(-11) : digitsAll

  function phoneMatches(stored: string): boolean {
    const d = stored.replace(/\D/g, '')
    return d === digitsAll || d === digitsShort ||
      digitsAll.endsWith(d) || d.endsWith(digitsShort)
  }

  // 1. Busca lead existente com telefone compatível
  const { data: leads } = await supabase
    .from('leads')
    .select('id, telefone')
    .eq('unit_id', unitId)
    .eq('arquivado', false)
    .not('telefone', 'is', null)
    .limit(50)

  const matchedLead = (leads ?? []).find(l => phoneMatches(l.telefone as string))

  let leadId: string

  if (matchedLead) {
    leadId = matchedLead.id
    console.log(`[WA webhook] lead existente encontrado: ${leadId}`)
  } else {
    // 2. Busca cliente manual com mesmo telefone (criado em /clientes sem lead vinculado)
    const { data: clients } = await supabase
      .from('clients')
      .select('id, telefone, nome, sobrenome, lead_id')
      .eq('unit_id', unitId)
      .not('telefone', 'is', null)
      .limit(50)

    const matchedClient = (clients ?? []).find(c => phoneMatches(c.telefone as string))

    if (matchedClient?.lead_id) {
      // Cliente já tem lead — só vincula a conversa
      leadId = matchedClient.lead_id
      console.log(`[WA webhook] cliente já vinculado ao lead: ${leadId}`)
    } else {
      // 3. Cria lead (com base no cliente existente ou nos dados do WhatsApp)
      const { nome, sobrenome } = matchedClient
        ? { nome: matchedClient.nome as string, sobrenome: matchedClient.sobrenome as string | null }
        : splitName(contactName)

      const defaultStage = await getDefaultStage(supabase, unitId)
      if (!defaultStage) {
        console.error('[WA webhook] nenhum funil/estágio encontrado para criar lead')
        return null
      }

      const { data: newLead, error: leadErr } = await supabase
        .from('leads')
        .insert({
          unit_id:   unitId,
          nome,
          sobrenome,
          telefone:  formatPhone(waPhone),
          origem:    'whatsapp',
          funnel_id: defaultStage.funnel_id,
          stage_id:  defaultStage.stage_id,
          arquivado: false,
          ...(matchedClient ? { client_id: matchedClient.id } : {}),
        })
        .select('id')
        .single()

      if (leadErr || !newLead) {
        console.error('[WA webhook] erro ao criar lead:', leadErr)
        return null
      }

      leadId = newLead.id
      console.log(`[WA webhook] novo lead criado: ${leadId} (${nome})`)

      // Se veio de cliente existente, fecha o ciclo: client.lead_id → novo lead
      if (matchedClient) {
        await supabase
          .from('clients')
          .update({ lead_id: leadId })
          .eq('id', matchedClient.id)
        console.log(`[WA webhook] cliente ${matchedClient.id} vinculado ao lead ${leadId}`)
      }
    }
  }

  // Vincula a conversa ao lead
  await supabase.from('wa_conversations').update({ lead_id: leadId }).eq('id', convId)

  // Registra optin ou optout dependendo da mensagem que disparou o vínculo
  if (isOptOut) {
    await supabase.from('leads')
      .update({ wa_optout_at: new Date().toISOString() })
      .eq('id', leadId)
      .is('wa_optout_at', null)
  } else {
    await supabase.from('leads')
      .update({ wa_optin_at: new Date().toISOString() })
      .eq('id', leadId)
      .is('wa_optin_at', null)
  }

  return leadId
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function getDefaultStage(supabase: ReturnType<typeof adminClient>, unitId: string): Promise<{ funnel_id: string; stage_id: string } | null> {
  const { data: funnels } = await supabase
    .from('funnels')
    .select('id')
    .eq('unit_id', unitId)
    .eq('ativo', true)
    .order('ordem', { ascending: true })
    .limit(1)

  const funnelId = funnels?.[0]?.id
  if (!funnelId) return null

  const { data: stage } = await supabase
    .from('funnel_stages')
    .select('id')
    .eq('funnel_id', funnelId)
    .order('ordem', { ascending: true })
    .limit(1)
    .maybeSingle()

  if (!stage?.id) return null
  return { funnel_id: funnelId, stage_id: stage.id }
}

function splitName(fullName: string | null): { nome: string; sobrenome: string | null } {
  if (!fullName?.trim()) return { nome: 'Contato WhatsApp', sobrenome: null }
  const parts = fullName.trim().split(/\s+/)
  const nome     = parts[0]
  const sobrenome = parts.length > 1 ? parts.slice(1).join(' ') : null
  return { nome, sobrenome }
}

function formatPhone(waPhone: string): string {
  // Converte E.164 sem '+' para formato brasileiro legível: (11) 98453-5197
  const d = waPhone.replace(/\D/g, '')
  const local = d.startsWith('55') ? d.slice(2) : d
  if (local.length === 11) {
    return `(${local.slice(0, 2)}) ${local.slice(2, 7)}-${local.slice(7)}`
  }
  if (local.length === 10) {
    return `(${local.slice(0, 2)}) ${local.slice(2, 6)}-${local.slice(6)}`
  }
  return waPhone
}

async function handleStatusUpdate(status: WAStatus, phoneNumberId: string) {
  const supabase = adminClient()
  const mapped: Record<string, string> = {
    sent: 'sent', delivered: 'delivered', read: 'read', failed: 'failed',
  }
  const newStatus = mapped[status.status]
  if (!newStatus) return
  const update: Record<string, unknown> = { status: newStatus }
  if (status.errors?.length) update.error_data = status.errors[0]
  await supabase.from('wa_messages').update(update).eq('wa_message_id', status.id)

  // ── Atualiza destinatário de campanha se aplicável ──────────────────────────
  const now = new Date().toISOString()
  const recipUpdate: Record<string, unknown> = { status: newStatus }
  if (newStatus === 'delivered') recipUpdate.delivered_at = now
  else if (newStatus === 'read')    recipUpdate.read_at    = now
  else if (newStatus === 'failed')  recipUpdate.error_msg  = status.errors?.[0]?.title ?? 'Falha na entrega'

  const { data: recipient } = await supabase
    .from('wa_campaign_recipients')
    .update(recipUpdate)
    .eq('wa_msg_id', status.id)
    .select('campaign_id')
    .maybeSingle()

  if (recipient?.campaign_id) {
    await refreshCampaignCounters(supabase, recipient.campaign_id)
  }

  // Registra custo por mensagem (modelo Meta pós-julho 2025: per-message pricing)
  if (status.status === 'sent' && status.pricing) {
    const unitId = await resolveUnitId(supabase, phoneNumberId)
    if (!unitId) return
    const monthYear = new Date().toISOString().slice(0, 7)

    // Custo unitário por categoria (USD). Service é sempre 0.
    const costUsd = calcCostUsd(status.pricing.category, status.pricing.billable)

    await supabase.from('wa_message_costs').upsert(
      {
        unit_id:    unitId,
        wa_msg_id:  status.id,
        category:   status.pricing.category,
        billable:   status.pricing.billable,
        cost_usd:   costUsd,
        month_year: monthYear,
      },
      { onConflict: 'unit_id,wa_msg_id', ignoreDuplicates: true }
    )

    // Mantém wa_billing_conversations para histórico legado
    if (status.conversation?.id) {
      await supabase.from('wa_billing_conversations').upsert(
        {
          unit_id:      unitId,
          meta_conv_id: status.conversation.id,
          category:     status.pricing.category,
          billable:     status.pricing.billable,
          origin_type:  status.conversation.origin?.type ?? null,
          month_year:   monthYear,
        },
        { onConflict: 'unit_id,meta_conv_id', ignoreDuplicates: true }
      )
    }
  }
}

// ── Contadores de campanha ────────────────────────────────────────────────────
//
// Recalcula delivered_count, read_count, replied_count, optout_count,
// failed_count a partir dos destinatários. Pausa automaticamente se
// opt-out > 5% ou alerta (notificação) se > 3%.

async function refreshCampaignCounters(
  supabase: ReturnType<typeof adminClient>,
  campaignId: string,
) {
  const { data: rows } = await supabase
    .from('wa_campaign_recipients')
    .select('status')
    .eq('campaign_id', campaignId)

  if (!rows) return

  const counts = rows.reduce((acc, r) => {
    acc[r.status] = (acc[r.status] ?? 0) + 1; return acc
  }, {} as Record<string, number>)

  const sent      = counts.sent      ?? 0
  const delivered = counts.delivered ?? 0
  const read      = counts.read      ?? 0
  const replied   = counts.replied   ?? 0
  const failed    = counts.failed    ?? 0
  const skipped   = counts.skipped   ?? 0
  const pending   = counts.pending   ?? 0

  // opt-outs = destinatários marcados como skipped após o envio
  const sentTotal     = sent + delivered + read + replied + failed + skipped
  const optoutCount   = skipped
  const optoutRate    = sentTotal > 0 ? optoutCount / sentTotal : 0

  // Decide novo status
  const { data: campaign } = await supabase
    .from('wa_campaigns')
    .select('status')
    .eq('id', campaignId)
    .single()

  let newStatus = campaign?.status ?? 'enviando'
  if (pending === 0 && newStatus !== 'cancelada') newStatus = 'concluida'
  else if (optoutRate > 0.05 && !['pausada', 'cancelada', 'concluida'].includes(newStatus)) newStatus = 'pausada'

  await supabase.from('wa_campaigns').update({
    delivered_count: delivered + read + replied, // entregues inclui read e replied
    read_count:      read + replied,
    replied_count:   replied,
    failed_count:    failed,
    optout_count:    optoutCount,
    status:          newStatus,
    completed_at:    newStatus === 'concluida' ? new Date().toISOString() : undefined,
  }).eq('id', campaignId)
}

function calcCostUsd(category: string, billable: boolean): number {
  if (!billable) return 0
  if (category === 'marketing')       return 0.062500 // $0,0625 sem desconto por volume
  if (category === 'utility')         return 0.006800 // $0,0068 tier 1 (até 250k msgs/mês)
  if (category === 'authentication')  return 0.006800
  return 0 // service — gratuito e ilimitado
}

function extractContent(msg: WAMessage): { text: string | null; mediaUrl: string | null; mimeType: string | null } {
  switch (msg.type) {
    case 'text':     return { text: msg.text?.body ?? null, mediaUrl: null, mimeType: null }
    case 'image':    return { text: msg.image?.caption ?? null, mediaUrl: msg.image?.id ?? null, mimeType: msg.image?.mime_type ?? null }
    case 'audio':    return { text: null, mediaUrl: msg.audio?.id ?? null, mimeType: msg.audio?.mime_type ?? null }
    case 'video':    return { text: msg.video?.caption ?? null, mediaUrl: msg.video?.id ?? null, mimeType: msg.video?.mime_type ?? null }
    case 'document': return { text: msg.document?.filename ?? null, mediaUrl: msg.document?.id ?? null, mimeType: msg.document?.mime_type ?? null }
    case 'sticker':  return { text: null, mediaUrl: msg.sticker?.id ?? null, mimeType: 'image/webp' }
    default:         return { text: null, mediaUrl: null, mimeType: null }
  }
}

function normalizeType(type: string): string {
  const valid = ['text','image','audio','video','document','template','sticker','reaction']
  return valid.includes(type) ? type : 'unsupported'
}

// ── Tipos do payload do Meta ──────────────────────────────────────────────────

interface WAPayload { object: string; entry: WAEntry[] }
interface WAEntry   { id: string; changes: WAChange[] }
interface WAChange  { field: string; value: WAValue }
interface WAValue {
  messaging_product: string
  metadata:  { display_phone_number: string; phone_number_id: string }
  contacts?: { profile: { name: string }; wa_id: string }[]
  messages?: WAMessage[]
  statuses?: WAStatus[]
}
interface WAMessage {
  from: string; id: string; type: string; timestamp: string
  text?:     { body: string }
  image?:    { id: string; caption?: string; mime_type: string }
  audio?:    { id: string; mime_type: string }
  video?:    { id: string; caption?: string; mime_type: string }
  document?: { id: string; filename: string; mime_type: string }
  sticker?:  { id: string; mime_type: string }
}
interface WAStatus {
  id: string; status: string; timestamp: string
  errors?:       { code: number; title: string }[]
  conversation?: { id: string; origin?: { type: string } }
  pricing?:      { billable: boolean; pricing_model: string; category: string }
}
