import { NextRequest, NextResponse } from 'next/server'
import { createClient }             from '@supabase/supabase-js'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { getWaCredentials }         from '@/lib/whatsapp/credentials'

const META_API_URL = 'https://graph.facebook.com/v20.0'

function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('NEXT_PUBLIC_SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY não configurados')
  return createClient(url, key)
}

function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D/g, '')

  let n: string
  if (digits.startsWith('55') && digits.length >= 12) n = digits
  else if (digits.startsWith('0'))                    n = '55' + digits.slice(1)
  else                                                n = '55' + digits

  // Brasil: 55 + DDD(2) + 8 dígitos começando com 6-9 = celular sem o 9º dígito obrigatório
  // Ex: 559845351977 → 5598945351977
  if (n.startsWith('55') && n.length === 12) {
    const local8 = n.slice(4)
    if (/^[6-9]/.test(local8)) n = n.slice(0, 4) + '9' + local8
  }

  return n
}

// ── POST /api/whatsapp/start-conversation ────────────────────────────────────
//
// Body: { phone, unit_id, template_name, language?, components? }
//
// Cria (ou recupera) uma conversa e envia o template de abertura.
// Retorna { conversation_id }
//
export async function POST(req: NextRequest) {
  const supabaseUser = await createServerClient()
  const { data: { user } } = await supabaseUser.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })

  const body = await req.json() as {
    phone:           string
    unit_id:         string
    template_name:   string
    language?:       string
    components?:     object[]
    register_optin?: boolean
    body_text?:      string
    contact_name?:   string
  }

  const { unit_id, template_name, language = 'pt_BR', components = [], register_optin = false, body_text = '', contact_name } = body
  const phone = normalizePhone(body.phone ?? '')

  if (!phone || phone.length < 12)
    return NextResponse.json({ error: 'Telefone inválido. Informe DDD + número (ex: 11999998888)' }, { status: 400 })
  if (!unit_id)
    return NextResponse.json({ error: 'unit_id obrigatório' }, { status: 400 })
  if (!template_name)
    return NextResponse.json({ error: 'template_name obrigatório' }, { status: 400 })

  const supabase = adminClient()

  // 1. Upsert da conversa
  const { data: conv, error: convErr } = await supabase
    .from('wa_conversations')
    .upsert(
      { unit_id, wa_phone: phone, wa_contact_name: contact_name || null },
      { onConflict: 'unit_id,wa_phone', ignoreDuplicates: false }
    )
    .select('id, lead_id')
    .maybeSingle()

  if (convErr || !conv)
    return NextResponse.json({ error: 'Erro ao criar conversa', details: convErr?.message }, { status: 500 })

  // 1b. Criar ou vincular lead com o nome fornecido
  if (!conv.lead_id && contact_name) {
    const parts = contact_name.trim().split(/\s+/)
    const nome = parts[0]
    const sobrenome = parts.length > 1 ? parts.slice(1).join(' ') : null

    // Busca lead existente pelo telefone (server-side com ilike)
    const digitsAll = phone.replace(/\D/g, '')
    const digitsShort = digitsAll.length > 11 ? digitsAll.slice(-11) : digitsAll
    const searchSuffix = digitsAll.length >= 8 ? digitsAll.slice(-8) : digitsAll
    const { data: existingLeads } = await supabase
      .from('leads')
      .select('id, telefone')
      .eq('unit_id', unit_id)
      .eq('arquivado', false)
      .not('telefone', 'is', null)
      .ilike('telefone', `%${searchSuffix}%`)
      .limit(10)

    const matched = (existingLeads ?? []).find(l => {
      const d = (l.telefone as string).replace(/\D/g, '')
      return d === digitsAll || d === digitsShort || d.endsWith(digitsShort)
    })

    let leadId: string | null = null

    if (matched) {
      leadId = matched.id
    } else {
      // Busca primeiro stage do primeiro funil ativo
      const { data: funnel } = await supabase
        .from('funnels').select('id').eq('unit_id', unit_id).eq('ativo', true).order('ordem').limit(1).maybeSingle()
      if (funnel) {
        const { data: stage } = await supabase
          .from('funnel_stages').select('id').eq('funnel_id', funnel.id).order('ordem').limit(1).maybeSingle()
        if (stage) {
          const formatted = phone.replace(/^55(\d{2})(\d{4,5})(\d{4})$/, '($1) $2-$3')
          const { data: newLead } = await supabase
            .from('leads')
            .insert({
              unit_id, nome, sobrenome, telefone: formatted,
              origem: 'whatsapp', funnel_id: funnel.id, stage_id: stage.id, arquivado: false,
            })
            .select('id').single()
          if (newLead) leadId = newLead.id
        }
      }
    }

    if (leadId) {
      await supabase.from('wa_conversations').update({ lead_id: leadId }).eq('id', conv.id)
    }
  }

  // 2. Envia o template pelo Meta
  const creds = await getWaCredentials(unit_id)
  if (!creds.phoneNumberId || !creds.accessToken)
    return NextResponse.json({ error: 'WhatsApp não configurado para esta unidade' }, { status: 500 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tpl: any = { name: template_name, language: { code: language } }
  if (components && components.length > 0) tpl.components = components
  const metaPayload = { messaging_product: 'whatsapp', to: phone, type: 'template', template: tpl }

  const metaRes  = await fetch(`${META_API_URL}/${creds.phoneNumberId}/messages`, {
    method:  'POST',
    headers: { Authorization: `Bearer ${creds.accessToken}`, 'Content-Type': 'application/json' },
    body:    JSON.stringify(metaPayload),
  })
  const metaData = await metaRes.json() as { messages?: { id: string }[]; error?: { message: string } }

  if (!metaRes.ok) {
    console.error('[start-conv] Meta erro:', JSON.stringify(metaData))
    return NextResponse.json({ error: metaData.error?.message ?? 'Falha ao enviar template' }, { status: metaRes.status })
  }

  const waMessageId = metaData.messages?.[0]?.id ?? null
  console.log(`[start-conv] enviado para=${phone} template=${template_name} wamid=${waMessageId} phone_number_id=${creds.phoneNumberId}`)
  const preview     = `📋 ${template_name}`

  // 3. Salva mensagem outbound
  await supabase.from('wa_messages').insert({
    conversation_id: conv.id,
    unit_id,
    wa_message_id:   waMessageId,
    direction:       'outbound',
    type:            'template',
    template_name,
    content:         body_text || null,
    status:          'sent',
    sent_by:         user.id,
  })

  // 4. Atualiza last_message e auto-atribui
  await supabase.from('wa_conversations').update({
    last_message_at:        new Date().toISOString(),
    last_message_content:   preview,
    last_message_direction: 'outbound',
    assigned_to:            user.id,
    status:                 'open',
  }).eq('id', conv.id)

  // 5. Registra optin no lead vinculado ao telefone (se solicitado)
  if (register_optin) {
    const now = new Date().toISOString()
    // Tenta todas as variações do telefone que podem estar cadastradas no lead
    const phoneVariants = [phone]
    if (phone.startsWith('55')) {
      const withoutCountry = phone.slice(2)
      phoneVariants.push(withoutCountry, `0${withoutCountry}`)
    }
    const { data: leads } = await supabase
      .from('leads')
      .select('id')
      .eq('unit_id', unit_id)
      .is('wa_optin_at', null)
      .or(phoneVariants.map(p => `telefone.ilike.%${p}`).join(','))
      .limit(5)
    if (leads && leads.length > 0) {
      await supabase.from('leads')
        .update({ wa_optin_at: now })
        .in('id', leads.map(l => l.id))
    }
  }

  return NextResponse.json({ conversation_id: conv.id })
}
