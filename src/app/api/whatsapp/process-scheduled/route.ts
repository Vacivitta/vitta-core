/**
 * GET/POST /api/whatsapp/process-scheduled
 *
 * Processa mensagens agendadas com scheduled_for <= now() e status = 'pending'.
 * Deve ser chamado periodicamente por um cron (Vercel Cron, pg_cron, etc.).
 *
 * Proteja com CRON_SECRET:
 *   Authorization: Bearer <CRON_SECRET>
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const META_API_URL = 'https://graph.facebook.com/v20.0'

function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('[WA] NEXT_PUBLIC_SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY não configurados')
  return createClient(url, key)
}

export async function GET(req: NextRequest) { return handler(req) }
export async function POST(req: NextRequest) { return handler(req) }

async function handler(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (secret) {
    const auth = req.headers.get('authorization') ?? ''
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

  const admin = adminClient()
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID
  const accessToken   = process.env.WHATSAPP_ACCESS_TOKEN

  if (!phoneNumberId || !accessToken) {
    return NextResponse.json({ error: 'WhatsApp env vars missing' }, { status: 500 })
  }

  // Fetch due messages
  const { data: msgs, error } = await admin
    .from('wa_scheduled_messages')
    .select('id, conversation_id, unit_id, content, type')
    .eq('status', 'pending')
    .lte('scheduled_for', new Date().toISOString())
    .limit(50)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!msgs || msgs.length === 0) return NextResponse.json({ processed: 0 })

  let processed = 0
  for (const msg of msgs) {
    try {
      // Get conversation phone
      const { data: conv } = await admin
        .from('wa_conversations').select('wa_phone').eq('id', msg.conversation_id).single()
      if (!conv) {
        await admin.from('wa_scheduled_messages').update({ status: 'failed' }).eq('id', msg.id)
        continue
      }

      const metaRes = await fetch(`${META_API_URL}/${phoneNumberId}/messages`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to:   conv.wa_phone,
          type: 'text',
          text: { body: msg.content, preview_url: false },
        }),
      })
      const metaData = await metaRes.json() as { messages?: { id: string }[] }
      const waId = metaData.messages?.[0]?.id ?? null

      await admin.from('wa_messages').insert({
        conversation_id: msg.conversation_id,
        unit_id:         msg.unit_id,
        wa_message_id:   waId,
        direction:       'outbound',
        type:            'text',
        content:         msg.content,
        status:          'sent',
      })
      await admin.from('wa_conversations').update({ last_message_at: new Date().toISOString() }).eq('id', msg.conversation_id)
      await admin.from('wa_scheduled_messages').update({ status: 'sent', sent_at: new Date().toISOString() }).eq('id', msg.id)
      processed++
    } catch {
      await admin.from('wa_scheduled_messages').update({ status: 'failed' }).eq('id', msg.id)
    }
  }

  return NextResponse.json({ processed })
}
