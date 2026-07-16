import { NextRequest, NextResponse } from 'next/server'
import { createClient }             from '@supabase/supabase-js'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { getWaCredentials }         from '@/lib/whatsapp/credentials'
import { runWaAutomation }          from '@/lib/whatsapp/automation'

const META_API_URL = 'https://graph.facebook.com/v20.0'

function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('[WA] NEXT_PUBLIC_SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY não configurados')
  return createClient(url, key)
}

// ── POST /api/whatsapp/send ───────────────────────────────────────────────────
//
// Body para mensagem de texto:
//   { conversation_id: string, content: string }
//
// Body para template:
//   { conversation_id: string, type: "template", template_name: string,
//     language?: string, components?: object[] }
//
export async function POST(req: NextRequest) {
  // Valida sessão do usuário
  const supabaseUser = await createServerClient()
  const { data: { user } } = await supabaseUser.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })

  const body = await req.json() as SendBody
  const { conversation_id, type = 'text', content, template_name, language = 'pt_BR', components = [], rendered_text, context_message_id } = body

  if (!conversation_id) {
    return NextResponse.json({ error: 'conversation_id obrigatório' }, { status: 400 })
  }
  if (type === 'text' && !content?.trim()) {
    return NextResponse.json({ error: 'content obrigatório para mensagens de texto' }, { status: 400 })
  }
  if (type === 'template' && !template_name) {
    return NextResponse.json({ error: 'template_name obrigatório' }, { status: 400 })
  }

  const supabase = adminClient()

  // Busca a conversa para obter o número de destino
  const { data: conv, error: convErr } = await supabase
    .from('wa_conversations')
    .select('id, wa_phone, unit_id, assigned_to')
    .eq('id', conversation_id)
    .single()

  if (convErr || !conv) {
    return NextResponse.json({ error: 'Conversa não encontrada' }, { status: 404 })
  }

  // Monta o payload para a API do Meta
  const metaPayload = buildMetaPayload(conv.wa_phone, type, content, template_name, language, components, context_message_id)

  // Chama a API do Meta — lê credenciais do banco ou fallback env vars
  const creds = await getWaCredentials(conv.unit_id)

  if (!creds.phoneNumberId || !creds.accessToken) {
    return NextResponse.json({ error: 'WhatsApp não configurado. Acesse Configurações → WhatsApp API.' }, { status: 500 })
  }

  const metaRes = await fetch(`${META_API_URL}/${creds.phoneNumberId}/messages`, {
    method:  'POST',
    headers: {
      'Authorization': `Bearer ${creds.accessToken}`,
      'Content-Type':  'application/json',
    },
    body: JSON.stringify(metaPayload),
  })

  const metaData = await metaRes.json() as MetaResponse

  if (!metaRes.ok) {
    console.error('[WA send] erro da API do Meta:', metaData)
    return NextResponse.json(
      { error: 'Falha ao enviar mensagem', details: metaData },
      { status: metaRes.status }
    )
  }

  const waMessageId = metaData.messages?.[0]?.id ?? null

  // Salva a mensagem outbound no banco
  const { data: msg, error: msgErr } = await supabase
    .from('wa_messages')
    .insert({
      conversation_id,
      unit_id:       conv.unit_id,
      wa_message_id: waMessageId,
      direction:     'outbound',
      type,
      content:       type === 'text' ? content : (rendered_text ?? null),
      template_name: type === 'template' ? template_name : null,
      status:        'sent',
      sent_by:       user.id,
      reply_to_wa_message_id: context_message_id ?? null,
    })
    .select('id, created_at')
    .single()

  if (msgErr) {
    console.error('[WA send] erro ao salvar mensagem:', msgErr)
    // Não retorna erro — a mensagem já foi enviada ao Meta
  }

  // Atualiza last_message_at, prévia, zera unread e auto-atribui ao atendente se não tiver responsável
  const lastContent = type === 'template' ? (rendered_text ?? `📋 ${template_name}`) : (content?.trim() ?? '')
  const convUpdate: Record<string, unknown> = {
    last_message_at:        new Date().toISOString(),
    last_message_content:   lastContent,
    last_message_direction: 'outbound',
    unread_count:           0,
  }
  if (!conv.assigned_to) convUpdate.assigned_to = user.id
  await supabase
    .from('wa_conversations')
    .update(convUpdate)
    .eq('id', conversation_id)

  // Executa automação de atendimento (ex: mover lead quando atendente responde)
  await runWaAutomation(supabase, 'outbound_message', conv.unit_id, conversation_id)

  return NextResponse.json({ success: true, message_id: waMessageId, db_id: msg?.id ?? null })
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildMetaPayload(
  to: string,
  type: string,
  content?: string,
  templateName?: string,
  language?: string,
  components?: object[],
  contextMessageId?: string,
) {
  if (type === 'template') {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const payload: any = {
      messaging_product: 'whatsapp',
      to,
      type: 'template',
      template: {
        name:     templateName,
        language: { code: language ?? 'pt_BR' },
        components: components ?? [],
      },
    }
    if (contextMessageId) payload.context = { message_id: contextMessageId }
    return payload
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const payload: any = {
    messaging_product: 'whatsapp',
    to,
    type: 'text',
    text: { body: content, preview_url: false },
  }
  if (contextMessageId) payload.context = { message_id: contextMessageId }
  return payload
}

// ── Tipos ─────────────────────────────────────────────────────────────────────

interface SendBody {
  conversation_id: string
  type?:           'text' | 'template'
  content?:        string
  template_name?:  string
  language?:       string
  components?:     object[]
  rendered_text?:  string
  context_message_id?: string
}

interface MetaResponse {
  messaging_product?: string
  contacts?:  { input: string; wa_id: string }[]
  messages?:  { id: string }[]
  error?: {
    message: string
    type:    string
    code:    number
  }
}
