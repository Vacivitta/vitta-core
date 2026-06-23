import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { createClient } from '@supabase/supabase-js'

function adminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
}

// GET /api/whatsapp/media?id={media_id}[&unit_id={unit_id}]
// Proxy para buscar mídia do Meta — não expõe o access token ao client
export async function GET(req: NextRequest) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return new NextResponse('Unauthorized', { status: 401 })

  const mediaId = req.nextUrl.searchParams.get('id')
  const unitId  = req.nextUrl.searchParams.get('unit_id')
  if (!mediaId) return new NextResponse('Missing id', { status: 400 })

  // Busca token e phone_number_id do banco
  const admin = adminClient()
  const baseQuery = admin.from('wa_config').select('access_token, phone_number_id').eq('is_active', true)
  const { data: config } = await (unitId
    ? baseQuery.eq('unit_id', unitId)
    : baseQuery
  ).limit(1).maybeSingle()

  const accessToken   = config?.access_token   ?? process.env.WHATSAPP_ACCESS_TOKEN
  const phoneNumberId = config?.phone_number_id ?? null

  if (!accessToken) return new NextResponse('Token não configurado', { status: 500 })

  // 1. Busca a URL temporária do arquivo (phone_number_id melhora o roteamento na Meta)
  const metaUrl = phoneNumberId
    ? `https://graph.facebook.com/v20.0/${mediaId}?phone_number_id=${phoneNumberId}`
    : `https://graph.facebook.com/v20.0/${mediaId}`

  const metaRes = await fetch(metaUrl, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })

  if (!metaRes.ok) {
    const err = await metaRes.text()
    console.error('[WA media] Meta retornou erro:', metaRes.status, err)
    return new NextResponse(`Media error: ${metaRes.status}`, { status: 404 })
  }

  const { url, mime_type } = await metaRes.json() as { url: string; mime_type: string }

  // 2. Faz streaming do arquivo de volta ao cliente
  const fileRes = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!fileRes.ok) return new NextResponse('Failed to fetch media', { status: 502 })

  const blob = await fileRes.arrayBuffer()
  return new NextResponse(blob, {
    status: 200,
    headers: {
      'Content-Type': mime_type ?? 'application/octet-stream',
      'Cache-Control': 'private, max-age=3600',
    },
  })
}
