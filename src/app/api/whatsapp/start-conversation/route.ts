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
    phone:          string
    unit_id:        string
    template_name:  string
    language?:      string
    components?:    object[]
  }

  const { unit_id, template_name, language = 'pt_BR', components = [] } = body
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
      { unit_id, wa_phone: phone },
      { onConflict: 'unit_id,wa_phone', ignoreDuplicates: false }
    )
    .select('id')
    .maybeSingle()

  if (convErr || !conv)
    return NextResponse.json({ error: 'Erro ao criar conversa', details: convErr?.message }, { status: 500 })

  // 2. Envia o template pelo Meta
  const creds = await getWaCredentials(unit_id)
  if (!creds.phoneNumberId || !creds.accessToken)
    return NextResponse.json({ error: 'WhatsApp não configurado para esta unidade' }, { status: 500 })

  const metaPayload = {
    messaging_product: 'whatsapp',
    to:     phone,
    type:   'template',
    template: {
      name:     template_name,
      language: { code: language },
      components,
    },
  }

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

  return NextResponse.json({ conversation_id: conv.id })
}
