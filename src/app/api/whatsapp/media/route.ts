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

  const mediaId  = req.nextUrl.searchParams.get('id')
  const unitId   = req.nextUrl.searchParams.get('unit_id')
  if (!mediaId) return new NextResponse('Missing id', { status: 400 })

  // Busca token do banco — por unidade específica ou o primeiro ativo disponível
  const query = adminClient().from('wa_config').select('access_token').eq('is_active', true)
  if (unitId) query.eq('unit_id', unitId)
  const { data: config } = await query.limit(1).maybeSingle()

  const accessToken = config?.access_token ?? process.env.WHATSAPP_ACCESS_TOKEN
  if (!accessToken) return new NextResponse('Token não configurado', { status: 500 })

  // 1. Busca a URL temporária do arquivo
  const metaRes = await fetch(`https://graph.facebook.com/v20.0/${mediaId}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!metaRes.ok) return new NextResponse('Media not found', { status: 404 })

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
