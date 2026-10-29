import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { canAccessUnit } from '@/lib/auth/access'
import { getWaCredentials } from '@/lib/whatsapp/credentials'

// GET /api/whatsapp/media?id={media_id}[&unit_id={unit_id}]
// Proxy para buscar mídia do Meta — não expõe o access token ao client.
// Usa o token da unidade informada (ou da unidade ativa do usuário), só se o
// usuário tiver vínculo com ela.
export async function GET(req: NextRequest) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return new NextResponse('Unauthorized', { status: 401 })

  const mediaId = req.nextUrl.searchParams.get('id')
  let unitId = req.nextUrl.searchParams.get('unit_id')
  if (!unitId) {
    const { data: profile } = await supabase.from('profiles').select('unit_id').eq('id', user.id).maybeSingle()
    unitId = profile?.unit_id ?? null
  }
  if (!unitId || !(await canAccessUnit(supabase, user.id, unitId))) {
    return new NextResponse('Forbidden', { status: 403 })
  }

  const { accessToken } = await getWaCredentials(unitId)
  if (!accessToken) {
    console.error('[WA media] unidade sem WhatsApp configurado:', unitId)
    return new NextResponse('Token não configurado', { status: 500 })
  }

  // 1. Busca a URL temporária do arquivo
  const metaRes = await fetch(`https://graph.facebook.com/v20.0/${mediaId}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })

  if (!metaRes.ok) {
    const err = await metaRes.text()
    console.error('[WA media] Meta retornou erro:', metaRes.status, err)
    const expired = metaRes.status === 400
    return NextResponse.json(
      { error: expired ? 'Mídia expirada' : `Media error: ${metaRes.status}`, expired },
      { status: expired ? 410 : 502 }
    )
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
