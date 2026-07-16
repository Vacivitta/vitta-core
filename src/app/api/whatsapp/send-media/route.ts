import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { createClient } from '@supabase/supabase-js'
import { getWaCredentials } from '@/lib/whatsapp/credentials'
import { runWaAutomation } from '@/lib/whatsapp/automation'

const META_API_URL = 'https://graph.facebook.com/v20.0'

function normalizeMime(raw: string): string {
  return raw.split(';')[0].trim().toLowerCase()
}

function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('[WA] NEXT_PUBLIC_SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY não configurados')
  return createClient(url, key)
}

// POST /api/whatsapp/send-media
// Body: FormData { file: File, conversation_id: string }
export async function POST(req: NextRequest) {
  try {
    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })

    const form = await req.formData()
    const file            = form.get('file') as File | null
    const conversation_id = form.get('conversation_id') as string | null
    const caption         = (form.get('caption') as string | null)?.trim() || null

    if (!file || !conversation_id) {
      return NextResponse.json({ error: 'file e conversation_id obrigatórios' }, { status: 400 })
    }

    const admin = adminClient()
    const { data: conv } = await admin.from('wa_conversations').select('id, wa_phone, unit_id').eq('id', conversation_id).single()
    if (!conv) return NextResponse.json({ error: 'Conversa não encontrada' }, { status: 404 })

    const creds = await getWaCredentials(conv.unit_id)
    const phoneNumberId = creds.phoneNumberId
    const accessToken   = creds.accessToken
    if (!phoneNumberId || !accessToken)
      return NextResponse.json({ error: 'WhatsApp não configurado para esta unidade' }, { status: 500 })

    let mime = normalizeMime(file.type)

    const inputSize = file.size
    console.log(`[send-media] input: mime=${mime} size=${inputSize}B name=${file.name}`)

    let uploadFile: File = file
    if (mime === 'audio/webm') {
      const { convertWebmToOgg } = await import('@/lib/audio/webm-to-ogg')
      const rawBuf = Buffer.from(await file.arrayBuffer())
      console.log(`[send-media] converting WebM→OGG via ffmpeg remux: inputSize=${rawBuf.length}B`)

      const oggBuf = convertWebmToOgg(rawBuf)
      console.log(`[send-media] OGG output: size=${oggBuf.length}B (ratio=${(oggBuf.length / rawBuf.length * 100).toFixed(1)}%)`)

      const oggBlob = new Blob([new Uint8Array(oggBuf)], { type: 'audio/ogg' })
      uploadFile = new File([oggBlob], file.name.replace(/\.webm$/, '.ogg'), { type: 'audio/ogg' })
      mime = 'audio/ogg'
    }

    // 1. Upload do arquivo para a API de mídia do Meta
    const uploadForm = new FormData()
    uploadForm.append('file', uploadFile, uploadFile.name)
    uploadForm.append('messaging_product', 'whatsapp')
    uploadForm.append('type', mime)

    const uploadRes  = await fetch(`${META_API_URL}/${phoneNumberId}/media`, {
      method:  'POST',
      headers: { Authorization: `Bearer ${accessToken}` },
      body:    uploadForm,
    })
    const uploadText = await uploadRes.text()
    let uploadData: { id?: string; error?: unknown }
    try { uploadData = JSON.parse(uploadText) } catch { uploadData = {} }

    console.log(`[send-media] upload status=${uploadRes.status} mime=${mime} name=${uploadFile.name} body=${uploadText.slice(0, 300)}`)

    if (!uploadRes.ok || !uploadData.id) {
      return NextResponse.json({ error: 'Falha no upload da mídia', details: uploadData }, { status: 502 })
    }

    const mediaId = uploadData.id

    // 2. Determina o tipo da mensagem
    let msgType = 'document'
    if (mime.startsWith('image/')) msgType = 'image'
    else if (mime.startsWith('video/')) msgType = 'video'
    else if (mime.startsWith('audio/')) msgType = 'audio'

    // 3. Envia a mensagem via API do Meta
    const metaPayload: Record<string, unknown> = {
      messaging_product: 'whatsapp',
      to:   conv.wa_phone,
      type: msgType,
      [msgType]: msgType === 'audio'
          ? { id: mediaId, voice: true }
          : caption
            ? { id: mediaId, caption }
            : { id: mediaId },
    }

    const sendRes  = await fetch(`${META_API_URL}/${phoneNumberId}/messages`, {
      method:  'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body:    JSON.stringify(metaPayload),
    })
    const sendData = await sendRes.json() as { messages?: { id: string }[]; error?: unknown }

    console.log(`[send-media] send status=${sendRes.status} type=${msgType} payload=${JSON.stringify(metaPayload)} response=${JSON.stringify(sendData).slice(0, 300)}`)

    if (!sendRes.ok) {
      console.error('[send-media] Meta send error:', JSON.stringify(sendData))
      return NextResponse.json({ error: 'Falha ao enviar mídia', details: sendData }, { status: 502 })
    }

    const waMessageId = sendData.messages?.[0]?.id ?? null

    // 4. Salva no banco
    await admin.from('wa_messages').insert({
      conversation_id,
      unit_id:         conv.unit_id,
      wa_message_id:   waMessageId,
      direction:       'outbound',
      type:            msgType,
      content:         caption || file.name,
      media_url:       mediaId,
      media_mime_type: mime,
      status:          'sent',
      sent_by:         user.id,
    })

    await admin.from('wa_conversations').update({
      last_message_at:        new Date().toISOString(),
      last_message_content:   caption || file.name,
      last_message_direction: 'outbound',
      unread_count:           0,
    }).eq('id', conversation_id)

    await runWaAutomation(admin, 'outbound_message', conv.unit_id, conversation_id)

    return NextResponse.json({ success: true, message_id: waMessageId })
  } catch (err) {
    console.error('[send-media] erro inesperado:', err)
    return NextResponse.json({ error: 'Erro interno ao enviar mídia' }, { status: 500 })
  }
}

