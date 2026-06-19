import { NextRequest, NextResponse } from 'next/server'
import { createClient }             from '@supabase/supabase-js'
import { createClient as createServerClient } from '@/lib/supabase/server'

const META_API_URL  = 'https://graph.facebook.com/v20.0'
const BATCH_SIZE    = 10     // mensagens por lote (conservador — evita timeout Vercel)
const BATCH_DELAY   = 2000   // ms entre mensagens (≈0,5 msg/s)
const MAX_ERR_RATE  = 0.20   // pausa automática se erro > 20%
const RETRY_429_MS  = 8000   // backoff após rate-limit da Meta

// Next.js route segment config — aumenta o timeout máximo de 10 s para 60 s
export const maxDuration = 60

function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('[WA] NEXT_PUBLIC_SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY não configurados')
  return createClient(url, key)
}

// ── POST /api/whatsapp/campaign-process ──────────────────────────────────────
//
// Body: { campaign_id: string }
//
// Inicia o processamento de uma campanha. Envia até BATCH_SIZE mensagens,
// atualiza contadores em tempo real e pausa automaticamente se a taxa de
// erro superar MAX_ERR_RATE.
//
// Pode ser chamado repetidamente para retomar campanhas pausadas/em andamento.
//
export async function POST(req: NextRequest) {
  const supabaseUser = await createServerClient()
  const { data: { user } } = await supabaseUser.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })

  const { campaign_id } = await req.json() as { campaign_id?: string }
  if (!campaign_id) return NextResponse.json({ error: 'campaign_id obrigatório' }, { status: 400 })

  const supabase = adminClient()

  // ── Carrega campanha ────────────────────────────────────────────────────────
  const { data: campaign, error: campErr } = await supabase
    .from('wa_campaigns')
    .select('*')
    .eq('id', campaign_id)
    .single()

  if (campErr || !campaign) return NextResponse.json({ error: 'Campanha não encontrada' }, { status: 404 })

  // Apenas rascunho, agendada ou pausada podem ser iniciadas/retomadas
  if (!['rascunho', 'agendada', 'pausada'].includes(campaign.status)) {
    return NextResponse.json({ error: `Campanha no status "${campaign.status}" não pode ser disparada` }, { status: 422 })
  }

  // Verifica que o usuário pertence à mesma unidade
  const { data: profile } = await supabase.from('profiles').select('unit_id, perfil').eq('id', user.id).single()
  if (!profile || profile.unit_id !== campaign.unit_id) {
    return NextResponse.json({ error: 'Acesso negado' }, { status: 403 })
  }
  if (profile.perfil === 'atendente') {
    return NextResponse.json({ error: 'Sem permissão para disparar campanhas' }, { status: 403 })
  }

  // ── Busca o template ────────────────────────────────────────────────────────
  const { data: template } = await supabase
    .from('wa_message_templates')
    .select('*')
    .eq('id', campaign.template_id)
    .single()

  if (!template) return NextResponse.json({ error: 'Template não encontrado' }, { status: 404 })

  // ── Configs WhatsApp ────────────────────────────────────────────────────────
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID
  const accessToken   = process.env.WHATSAPP_ACCESS_TOKEN
  if (!phoneNumberId || !accessToken) {
    return NextResponse.json({ error: 'Variáveis de WhatsApp não configuradas' }, { status: 500 })
  }

  // ── Marca campanha como "enviando" ──────────────────────────────────────────
  await supabase.from('wa_campaigns').update({
    status:     'enviando',
    started_at: campaign.started_at ?? new Date().toISOString(),
  }).eq('id', campaign_id)

  // ── Busca destinatários pendentes ───────────────────────────────────────────
  const { data: pending } = await supabase
    .from('wa_campaign_recipients')
    .select('id, phone, lead_id, has_optin, nome')
    .eq('campaign_id', campaign_id)
    .eq('status', 'pending')
    .order('created_at')
    .limit(BATCH_SIZE)

  if (!pending || pending.length === 0) {
    // Nenhum pendente — marca como concluída
    await supabase.from('wa_campaigns').update({
      status:       'concluida',
      completed_at: new Date().toISOString(),
    }).eq('id', campaign_id)
    return NextResponse.json({ status: 'concluida', sent: 0 })
  }

  // ── Processa lote ────────────────────────────────────────────────────────────
  let sentCount   = 0
  let failedCount = 0
  const results: { id: string; ok: boolean }[] = []

  for (const recipient of pending) {
    // Re-verifica opt-out antes de cada envio
    if (recipient.lead_id) {
      const { data: lead } = await supabase
        .from('leads')
        .select('wa_optout_at')
        .eq('id', recipient.lead_id)
        .single()

      if (lead?.wa_optout_at) {
        await supabase.from('wa_campaign_recipients')
          .update({ status: 'skipped', error_msg: 'opt-out detectado antes do envio' })
          .eq('id', recipient.id)
        results.push({ id: recipient.id, ok: false })
        failedCount++
        continue
      }
    }

    // Monta payload Meta
    const metaPayload = {
      messaging_product: 'whatsapp',
      to:   recipient.phone,
      type: 'template',
      template: {
        name:     template.template_name ?? template.name,
        language: { code: template.language ?? 'pt_BR' },
        components: [],
      },
    }

    let ok = false
    let waId: string | null = null
    let errMsg: string | null = null
    let stopCampaign = false // 401 = token inválido, para tudo

    try {
      let res = await fetch(`${META_API_URL}/${phoneNumberId}/messages`, {
        method:  'POST',
        headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body:    JSON.stringify(metaPayload),
        signal:  AbortSignal.timeout(15_000),
      })

      // 429: rate limit — aguarda e tenta uma vez
      if (res.status === 429) {
        await new Promise(r => setTimeout(r, RETRY_429_MS))
        res = await fetch(`${META_API_URL}/${phoneNumberId}/messages`, {
          method:  'POST',
          headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
          body:    JSON.stringify(metaPayload),
          signal:  AbortSignal.timeout(15_000),
        })
        if (res.status === 429) {
          // Ainda 429 — pausa a campanha para tentar mais tarde
          await supabase.from('wa_campaigns').update({ status: 'pausada' }).eq('id', campaign_id)
          return NextResponse.json({ status: 'pausada', reason: 'Rate limit da Meta (429) — retome em alguns minutos', sent: sentCount, failed: failedCount })
        }
      }

      // 401: token inválido — para a campanha definitivamente
      if (res.status === 401) {
        errMsg = 'Token de acesso inválido (401) — verifique WHATSAPP_ACCESS_TOKEN'
        stopCampaign = true
      } else {
        const data = await res.json() as { messages?: { id: string }[]; error?: { message: string } }
        if (res.ok && data.messages?.[0]?.id) {
          ok   = true
          waId = data.messages[0].id
        } else {
          errMsg = data.error?.message ?? `HTTP ${res.status}`
        }
      }
    } catch (e) {
      // Timeout ou erro de rede — marca como falha mas não para a campanha
      errMsg = e instanceof Error ? e.message : 'Erro de rede/timeout'
    }

    // Atualiza destinatário
    await supabase.from('wa_campaign_recipients').update({
      status:    ok ? 'sent' : 'failed',
      wa_msg_id: waId,
      sent_at:   ok ? new Date().toISOString() : null,
      error_msg: errMsg,
    }).eq('id', recipient.id)

    if (stopCampaign) {
      await supabase.from('wa_campaigns').update({ status: 'pausada' }).eq('id', campaign_id)
      return NextResponse.json({ status: 'pausada', reason: errMsg, sent: sentCount, failed: failedCount })
    }

    if (ok) sentCount++
    else     failedCount++
    results.push({ id: recipient.id, ok })

    // Verifica taxa de erro acima do limiar (mínimo 5 tentativas para evitar falso positivo)
    if (results.length >= 5) {
      const errRate = failedCount / results.length
      if (errRate > MAX_ERR_RATE) {
        // Pausa a campanha
        await supabase.from('wa_campaigns').update({
          status:       'pausada',
          sent_count:   campaign.sent_count + sentCount,
          failed_count: campaign.failed_count + failedCount,
        }).eq('id', campaign_id)
        return NextResponse.json({
          status:  'pausada',
          reason:  `Taxa de erro ${(errRate * 100).toFixed(0)}% — campanha pausada automaticamente`,
          sent:    sentCount,
          failed:  failedCount,
        })
      }
    }

    // Delay entre envios (respeita rate limit da Meta)
    if (pending.indexOf(recipient) < pending.length - 1) {
      await new Promise(r => setTimeout(r, BATCH_DELAY))
    }
  }

  // ── Atualiza contadores na campanha ──────────────────────────────────────────
  const { data: freshCounts } = await supabase
    .from('wa_campaign_recipients')
    .select('status')
    .eq('campaign_id', campaign_id)

  const counts = (freshCounts ?? []).reduce(
    (acc, r) => { acc[r.status] = (acc[r.status] ?? 0) + 1; return acc },
    {} as Record<string, number>
  )

  const totalProcessed = (counts.sent ?? 0) + (counts.failed ?? 0) + (counts.skipped ?? 0)
  const totalPending   = counts.pending ?? 0
  const isComplete     = totalPending === 0

  await supabase.from('wa_campaigns').update({
    status:       isComplete ? 'concluida' : 'pausada',
    sent_count:   counts.sent    ?? 0,
    failed_count: (counts.failed ?? 0) + (counts.skipped ?? 0),
    completed_at: isComplete ? new Date().toISOString() : null,
  }).eq('id', campaign_id)

  return NextResponse.json({
    status:   isComplete ? 'concluida' : 'parcial',
    sent:     sentCount,
    failed:   failedCount,
    pending:  totalPending,
    total:    totalProcessed,
  })
}

// ── PATCH /api/whatsapp/campaign-process ─────────────────────────────────────
//
// Body: { campaign_id: string, action: 'pause' | 'cancel' }
//
export async function PATCH(req: NextRequest) {
  const supabaseUser = await createServerClient()
  const { data: { user } } = await supabaseUser.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })

  const { campaign_id, action } = await req.json() as { campaign_id?: string; action?: 'pause' | 'cancel' }
  if (!campaign_id || !action) return NextResponse.json({ error: 'campaign_id e action obrigatórios' }, { status: 400 })

  const supabase = adminClient()

  const newStatus = action === 'cancel' ? 'cancelada' : 'pausada'
  const { error } = await supabase
    .from('wa_campaigns')
    .update({ status: newStatus })
    .eq('id', campaign_id)
    .in('status', action === 'cancel' ? ['rascunho', 'agendada', 'pausada', 'enviando'] : ['enviando'])

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, status: newStatus })
}
