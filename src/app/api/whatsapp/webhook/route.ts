import { NextRequest, NextResponse } from 'next/server'
import { createClient }             from '@supabase/supabase-js'
import { runAutoAssign }            from '../auto-assign/route'
import { isValidVerifyToken }       from '@/lib/whatsapp/credentials'
import { runWaAutomation }          from '@/lib/whatsapp/automation'

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

interface WaConfig { unit_id: string; access_token: string; phone_number_id: string }

async function resolveConfig(supabase: ReturnType<typeof adminClient>, phoneNumberId: string): Promise<WaConfig | null> {
  const { data } = await supabase
    .from('wa_config')
    .select('unit_id, access_token, phone_number_id')
    .eq('phone_number_id', phoneNumberId)
    .maybeSingle()
  if (!data?.unit_id || !data?.access_token) return null
  return { unit_id: data.unit_id, access_token: data.access_token, phone_number_id: data.phone_number_id }
}

async function fetchAndStoreProfilePicture(
  supabase: ReturnType<typeof adminClient>,
  conversationId: string,
  waPhone:        string,
  phoneNumberId:  string,
  accessToken:    string,
): Promise<void> {
  try {
    const waId = waPhone.replace(/\D/g, '')
    const metaRes = await fetch(
      `https://graph.facebook.com/v20.0/${phoneNumberId}/contacts/${waId}?fields=profile_picture_url`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    )
    if (!metaRes.ok) return

    const metaData = await metaRes.json() as { profile_picture_url?: string }
    const picUrl = metaData.profile_picture_url
    if (!picUrl) return

    // Baixa a imagem e faz upload para o Supabase Storage
    const imgRes = await fetch(picUrl, { headers: { Authorization: `Bearer ${accessToken}` } })
    if (!imgRes.ok) return

    const imgBuffer = await imgRes.arrayBuffer()
    const contentType = imgRes.headers.get('content-type') ?? 'image/jpeg'
    const ext = contentType.includes('png') ? 'png' : contentType.includes('webp') ? 'webp' : 'jpg'
    const path = `${waPhone}.${ext}`

    const { error: uploadErr } = await supabase.storage
      .from('wa-avatars')
      .upload(path, imgBuffer, { contentType, upsert: true })

    if (uploadErr) {
      console.error('[WA avatar] upload falhou:', uploadErr.message)
      return
    }

    const { data: { publicUrl } } = supabase.storage.from('wa-avatars').getPublicUrl(path)

    await supabase
      .from('wa_conversations')
      .update({ profile_picture_url: publicUrl })
      .eq('id', conversationId)
  } catch (e) {
    console.error('[WA avatar] erro ao buscar foto de perfil:', e)
  }
}

// ── Handlers ──────────────────────────────────────────────────────────────────

async function handleInboundMessage(value: WAValue, msg: WAMessage) {
  const supabase    = adminClient()
  const config      = await resolveConfig(supabase, value.metadata.phone_number_id)
  const waPhone     = msg.from
  const contactName = value.contacts?.[0]?.profile?.name ?? null

  if (!config) {
    console.error('[WA webhook] phone_number_id não mapeado para nenhuma unidade:', value.metadata.phone_number_id)
    return
  }

  const { unit_id: unitId, access_token: accessToken, phone_number_id: phoneNumberId } = config

  // 1. Upsert da conversa
  const { data: conv, error: convErr } = await supabase
    .from('wa_conversations')
    .upsert(
      { unit_id: unitId, wa_phone: waPhone, wa_contact_name: contactName },
      { onConflict: 'unit_id,wa_phone', ignoreDuplicates: false }
    )
    .select('id, lead_id, profile_picture_url')
    .maybeSingle()

  if (convErr || !conv) {
    console.error('[WA webhook] erro ao upsert conversa de', waPhone, contactName ?? '', convErr)
    return
  }

  // 1b. Busca foto de perfil do contato se ainda não tiver (fire-and-forget)
  if (!conv.profile_picture_url) {
    void fetchAndStoreProfilePicture(supabase, conv.id, waPhone, phoneNumberId, accessToken)
  }

  // 2. Inserir mensagem — retorna id somente se for nova (duplicatas ignoradas)
  const content = extractContent(msg)

  // 2b. Download de mídia para Supabase Storage (URLs do Meta expiram em ~30 dias)
  let persistedMediaUrl = content.mediaId
  if (content.mediaId) {
    const storageUrl = await downloadAndStoreMedia(supabase, content.mediaId, content.mimeType, accessToken, unitId)
    if (storageUrl) persistedMediaUrl = storageUrl
  }

  const { data: newMsg, error: msgErr } = await supabase
    .from('wa_messages')
    .upsert(
      {
        conversation_id: conv.id,
        unit_id:         unitId,
        wa_message_id:   msg.id,
        direction:       'inbound',
        type:            normalizeType(msg.type),
        content:         content.text,
        media_url:       persistedMediaUrl,
        media_mime_type: content.mimeType,
        status:          'delivered',
        reply_to_wa_message_id: msg.type === 'reaction' ? (msg.reaction?.message_id ?? null) : (msg.context?.id ?? null),
      },
      { onConflict: 'wa_message_id', ignoreDuplicates: true }
    )
    .select('id')
    .maybeSingle()

  if (msgErr) {
    console.error('[WA webhook] erro ao inserir mensagem:', msgErr)
    return
  }

  // Mensagem duplicada: Meta reenviou o mesmo webhook. Pula apenas o incremento de
  // unread e a atualização da última mensagem (não-idempotentes); os passos seguintes
  // (opt-out, vínculo de lead, campanha, auto-assign) são idempotentes e devem rodar
  // mesmo em retries, caso a primeira tentativa tenha falhado no meio.
  const isDuplicate = !newMsg
  if (isDuplicate) console.log('[WA webhook] mensagem duplicada — pulando increment de unread:', msg.id)

  if (!isDuplicate && msg.type !== 'reaction') {
    // 3. Atualiza last_message_at, prévia da última mensagem e unread (reações não contam)
    const lastContent = content.text
      ?? (msg.type === 'image' ? '📷 Imagem' : msg.type === 'audio' ? '🎤 Áudio' : msg.type === 'video' ? '🎬 Vídeo' : msg.type === 'document' ? '📎 Documento' : '📎 Anexo')
    const { error: updErr } = await supabase
      .from('wa_conversations')
      .update({ last_message_at: new Date().toISOString(), status: 'open', last_message_content: lastContent, last_message_direction: 'inbound' })
      .eq('id', conv.id)
    if (updErr) console.error('[WA webhook] update last_message_at:', updErr.message)

    const { error: unreadErr } = await supabase.rpc('increment_wa_unread', { p_conversation_id: conv.id })
    if (unreadErr) console.error('[WA webhook] increment_wa_unread:', unreadErr.message)
  }

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
  } else {
    // Reativar lead arquivado que mandou mensagem
    const { data: linkedLead } = await supabase
      .from('leads')
      .select('id, arquivado')
      .eq('id', conv.lead_id)
      .single()

    if (linkedLead?.arquivado) {
      const defaultStage = await getDefaultStage(supabase, unitId)
      await supabase.from('leads').update({
        arquivado: false,
        motivo_perda: null,
        ...(defaultStage ? { funnel_id: defaultStage.funnel_id, stage_id: defaultStage.stage_id, stage_changed_at: new Date().toISOString() } : {}),
      }).eq('id', linkedLead.id)
      console.log(`[WA webhook] lead arquivado reativado (conversa existente): ${linkedLead.id}`)
    }
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

  // 4c. Automação inbound — dispara ação configurada para mensagens recebidas
  try {
    await runWaAutomation(supabase, 'inbound_message', unitId, conv.id)
  } catch (e) {
    console.error('[WA webhook] runWaAutomation inbound falhou:', e)
  }

  // 5. Tenta auto-distribuir — re-fetch para ter queue_id e assigned_to atualizados
  const { data: fresh } = await supabase
    .from('wa_conversations')
    .select('queue_id, assigned_to')
    .eq('id', conv.id)
    .single()

  let queueId = fresh?.queue_id as string | null

  // Se a conversa não tem fila, atribui a primeira fila ativa da unidade
  if (!queueId) {
    const { data: defaultQueue } = await supabase
      .from('wa_queues')
      .select('id')
      .eq('unit_id', unitId)
      .eq('ativo', true)
      .order('created_at')
      .limit(1)
      .maybeSingle()

    if (defaultQueue) {
      queueId = defaultQueue.id
      await supabase
        .from('wa_conversations')
        .update({ queue_id: queueId })
        .eq('id', conv.id)
    }
  }

  if (queueId && !fresh?.assigned_to) {
    try {
      await runAutoAssign(supabase, conv.id, queueId)
    } catch (e) {
      console.error('[WA webhook] runAutoAssign falhou:', e)
    }
  }

  // 6. Fallback: se após tudo o lead ainda não tem responsável, atribui via round-robin simples
  const { data: convAfter } = await supabase
    .from('wa_conversations')
    .select('lead_id, assigned_to')
    .eq('id', conv.id)
    .single()

  if (convAfter?.lead_id) {
    const { data: leadCheck } = await supabase
      .from('leads')
      .select('responsavel_id')
      .eq('id', convAfter.lead_id)
      .single()

    if (!leadCheck?.responsavel_id) {
      await fallbackAssignResponsavel(supabase, convAfter.lead_id, conv.id, unitId, convAfter.assigned_to)
    }
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

  // Busca server-side usando ilike com os últimos 8+ dígitos (evita limit arbitrário)
  const searchSuffix = digitsAll.length >= 8 ? digitsAll.slice(-8) : digitsAll
  const { data: leads } = await supabase
    .from('leads')
    .select('id, telefone')
    .eq('unit_id', unitId)
    .eq('arquivado', false)
    .not('telefone', 'is', null)
    .ilike('telefone', `%${searchSuffix}%`)
    .limit(10)

  const matchedLead = (leads ?? []).find(l => {
    const d = (l.telefone as string).replace(/\D/g, '')
    return d === digitsAll || d === digitsShort || d.endsWith(digitsShort)
  })

  let leadId: string

  if (matchedLead) {
    leadId = matchedLead.id
    console.log(`[WA webhook] lead existente encontrado: ${leadId}`)
  } else {
    // Busca entre leads arquivados antes de criar um novo
    const { data: archivedLeads } = await supabase
      .from('leads')
      .select('id, telefone')
      .eq('unit_id', unitId)
      .eq('arquivado', true)
      .not('telefone', 'is', null)
      .ilike('telefone', `%${searchSuffix}%`)
      .limit(10)

    const matchedArchived = (archivedLeads ?? []).find(l => {
      const d = (l.telefone as string).replace(/\D/g, '')
      return d === digitsAll || d === digitsShort || d.endsWith(digitsShort)
    })

    if (matchedArchived) {
      leadId = matchedArchived.id
      const defaultStage = await getDefaultStage(supabase, unitId)
      await supabase.from('leads').update({
        arquivado: false,
        motivo_perda: null,
        ...(defaultStage ? { funnel_id: defaultStage.funnel_id, stage_id: defaultStage.stage_id, stage_changed_at: new Date().toISOString() } : {}),
      }).eq('id', leadId)
      console.log(`[WA webhook] lead arquivado reativado: ${leadId}`)

      await supabase.from('wa_conversations').update({ lead_id: leadId }).eq('id', convId)
      return leadId
    }
    // 2. Cria novo lead com os dados do WhatsApp
    const { nome, sobrenome } = splitName(contactName)

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
      })
      .select('id')
      .single()

    if (leadErr || !newLead) {
      console.error('[WA webhook] erro ao criar lead:', leadErr)
      return null
    }

    leadId = newLead.id
    console.log(`[WA webhook] novo lead criado: ${leadId} (${nome})`)
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
  console.log(`[webhook status] id=${status.id} status=${newStatus}${status.errors?.length ? ` error=${JSON.stringify(status.errors[0])}` : ''}`)
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
    const cfg = await resolveConfig(supabase, phoneNumberId)
    if (!cfg) return
    const unitId = cfg.unit_id
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

function extractContent(msg: WAMessage): { text: string | null; mediaId: string | null; mimeType: string | null } {
  switch (msg.type) {
    case 'text':     return { text: msg.text?.body ?? null, mediaId: null, mimeType: null }
    case 'image':    return { text: msg.image?.caption ?? null, mediaId: msg.image?.id ?? null, mimeType: msg.image?.mime_type ?? null }
    case 'audio':    return { text: null, mediaId: msg.audio?.id ?? null, mimeType: msg.audio?.mime_type ?? null }
    case 'video':    return { text: msg.video?.caption ?? null, mediaId: msg.video?.id ?? null, mimeType: msg.video?.mime_type ?? null }
    case 'document': return { text: msg.document?.filename ?? null, mediaId: msg.document?.id ?? null, mimeType: msg.document?.mime_type ?? null }
    case 'sticker':  return { text: null, mediaId: msg.sticker?.id ?? null, mimeType: 'image/webp' }
    case 'reaction': return { text: msg.reaction?.emoji ?? null, mediaId: null, mimeType: null }
    default:         return { text: null, mediaId: null, mimeType: null }
  }
}

const MIME_TO_EXT: Record<string, string> = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp',
  'audio/ogg; codecs=opus': 'ogg', 'audio/ogg': 'ogg', 'audio/mpeg': 'mp3', 'audio/mp4': 'm4a', 'audio/aac': 'aac',
  'video/mp4': 'mp4', 'video/3gpp': '3gp',
  'application/pdf': 'pdf',
}

async function downloadAndStoreMedia(
  supabase: ReturnType<typeof adminClient>,
  mediaId: string,
  mimeType: string | null,
  accessToken: string,
  unitId: string,
): Promise<string | null> {
  try {
    const metaRes = await fetch(`https://graph.facebook.com/v20.0/${mediaId}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    if (!metaRes.ok) {
      console.error('[WA media download] Meta URL fetch failed:', metaRes.status)
      return null
    }
    const { url } = await metaRes.json() as { url: string }

    const fileRes = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    if (!fileRes.ok) {
      console.error('[WA media download] file download failed:', fileRes.status)
      return null
    }

    const buffer = await fileRes.arrayBuffer()
    const rawMime = mimeType ?? fileRes.headers.get('content-type') ?? 'application/octet-stream'
    const ext = MIME_TO_EXT[rawMime] ?? rawMime.split('/')[1]?.split(';')[0]?.replace(/[^a-z0-9]/g, '') ?? 'bin'
    const resolvedMime = rawMime.split(';')[0].trim()
    const path = `${unitId}/${mediaId}.${ext}`

    const { error: uploadErr } = await supabase.storage
      .from('wa-media')
      .upload(path, buffer, { contentType: resolvedMime, upsert: true })

    if (uploadErr) {
      console.error('[WA media download] upload failed:', uploadErr.message)
      return null
    }

    const { data: { publicUrl } } = supabase.storage.from('wa-media').getPublicUrl(path)
    return publicUrl
  } catch (e) {
    console.error('[WA media download] unexpected error:', e)
    return null
  }
}

function normalizeType(type: string): string {
  const valid = ['text','image','audio','video','document','template','sticker','reaction']
  return valid.includes(type) ? type : 'unsupported'
}

// ── Fallback: atribui responsável ao lead quando auto-assign não cobriu ───────

async function fallbackAssignResponsavel(
  supabase: ReturnType<typeof adminClient>,
  leadId: string,
  convId: string,
  unitId: string,
  assignedTo: string | null,
) {
  // Se a conversa já tem assigned_to, usa esse agente como responsável do lead
  if (assignedTo) {
    await supabase.from('leads').update({ responsavel_id: assignedTo }).eq('id', leadId)
    return
  }

  // Busca atendentes da unidade para round-robin simples
  const { data: members } = await supabase
    .from('user_units')
    .select('user_id, profile:profiles!inner(id, perfil)')
    .eq('unit_id', unitId)

  type MemberRow = { user_id: string; profile: { id: string; perfil: string } }
  const atendentes = ((members ?? []) as unknown as MemberRow[])
    .filter(m => m.profile.perfil === 'atendente')
    .map(m => m.profile.id)

  if (atendentes.length === 0) return

  // Round-robin: conta leads por atendente e atribui ao que tem menos
  const loads = await Promise.all(
    atendentes.map(async agentId => {
      const { count } = await supabase
        .from('leads')
        .select('id', { count: 'exact', head: true })
        .eq('responsavel_id', agentId)
        .eq('arquivado', false)
      return { agentId, count: count ?? 0 }
    })
  )
  loads.sort((a, b) => a.count - b.count)
  const chosen = loads[0].agentId

  await Promise.all([
    supabase.from('leads').update({ responsavel_id: chosen }).eq('id', leadId),
    supabase.from('wa_conversations').update({ assigned_to: chosen }).eq('id', convId),
  ])
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
  reaction?: { message_id: string; emoji: string }
  context?:  { id?: string; from?: string }
}
interface WAStatus {
  id: string; status: string; timestamp: string
  errors?:       { code: number; title: string }[]
  conversation?: { id: string; origin?: { type: string } }
  pricing?:      { billable: boolean; pricing_model: string; category: string }
}
