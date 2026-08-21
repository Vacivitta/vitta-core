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
import { getWaCredentials } from '@/lib/whatsapp/credentials'

const META_API_URL = 'https://graph.facebook.com/v20.0'

// Garante que o Vercel não mate a função antes de processar toda a fila
export const maxDuration = 60

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

  // Fetch due messages
  const { data: msgs, error } = await admin
    .from('wa_scheduled_messages')
    .select('id, conversation_id, unit_id, content, type, template_name, language, components')
    .eq('status', 'pending')
    .lte('scheduled_for', new Date().toISOString())
    .limit(50)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!msgs || msgs.length === 0) return NextResponse.json({ processed: 0 })

  // Batch: buscar todas as conversas de uma vez em vez de N+1 SELECTs no loop
  const convIds = [...new Set(msgs.map(m => m.conversation_id))]
  const { data: convRows } = await admin
    .from('wa_conversations')
    .select('id, wa_phone')
    .in('id', convIds)
  const convMap = new Map((convRows ?? []).map(c => [c.id, c.wa_phone as string]))

  // Cache de credenciais por unidade — várias mensagens podem ser da mesma unidade
  const credsCache = new Map<string, Awaited<ReturnType<typeof getWaCredentials>>>()
  async function credsFor(unitId: string) {
    if (!credsCache.has(unitId)) credsCache.set(unitId, await getWaCredentials(unitId))
    return credsCache.get(unitId)!
  }

  let processed = 0
  for (const msg of msgs) {
    try {
      const waPhone = convMap.get(msg.conversation_id)
      const creds   = await credsFor(msg.unit_id)
      if (!waPhone || !creds.phoneNumberId || !creds.accessToken) {
        await admin.from('wa_scheduled_messages').update({ status: 'failed' }).eq('id', msg.id)
        continue
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let metaPayload: any
      if (msg.type === 'template') {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const tpl: any = { name: msg.template_name, language: { code: msg.language ?? 'pt_BR' } }
        const comps = msg.components as object[] | null
        if (comps && comps.length > 0) tpl.components = comps
        metaPayload = { messaging_product: 'whatsapp', to: waPhone, type: 'template', template: tpl }
      } else {
        metaPayload = {
            messaging_product: 'whatsapp',
            to:   waPhone,
            type: 'text',
            text: { body: msg.content, preview_url: false },
          }
      }

      // AbortSignal evita que um hang na Meta deixe a função pendurada e re-envie na próxima execução do cron
      const metaRes = await fetch(`${META_API_URL}/${creds.phoneNumberId}/messages`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${creds.accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(metaPayload),
        signal: AbortSignal.timeout(15_000),
      })
      const metaData = await metaRes.json() as { messages?: { id: string }[]; error?: { message: string } }

      if (!metaRes.ok) {
        console.error(`[process-scheduled] erro Meta id=${msg.id} type=${msg.type} response=${JSON.stringify(metaData)}`)
        await admin.from('wa_scheduled_messages').update({ status: 'failed' }).eq('id', msg.id)
        continue
      }

      const waId = metaData.messages?.[0]?.id ?? null

      // Extrai image URL do header component (se houver)
      const comps = msg.components as { type?: string; parameters?: { type?: string; image?: { link?: string } }[] }[] | null
      const hdrImg = comps?.find(c => c.type === 'header' && c.parameters?.[0]?.type === 'image')
      const hdrUrl = hdrImg?.parameters?.[0]?.image?.link ?? null

      // As duas escritas são independentes — paralelizar
      await Promise.all([
        admin.from('wa_messages').insert({
          conversation_id: msg.conversation_id,
          unit_id:         msg.unit_id,
          wa_message_id:   waId,
          direction:       'outbound',
          type:            msg.type,
          content:         msg.content,
          template_name:   msg.type === 'template' ? msg.template_name : null,
          media_url:       hdrUrl,
          media_mime_type: hdrUrl ? 'image/jpeg' : null,
          status:          'sent',
        }),
        admin.from('wa_conversations').update({ last_message_at: new Date().toISOString() }).eq('id', msg.conversation_id),
        admin.from('wa_scheduled_messages').update({ status: 'sent', sent_at: new Date().toISOString() }).eq('id', msg.id),
      ])
      processed++
    } catch {
      await admin.from('wa_scheduled_messages').update({ status: 'failed' }).eq('id', msg.id)
    }
  }

  return NextResponse.json({ processed })
}
