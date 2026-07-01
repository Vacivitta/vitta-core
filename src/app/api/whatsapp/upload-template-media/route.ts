/**
 * /api/whatsapp/upload-template-media
 * Faz upload de imagem para o Meta usando a Resumable Upload API,
 * retornando o handle necessário para cabeçalho IMAGE de templates.
 *
 * Requer env: WHATSAPP_APP_ID, WHATSAPP_ACCESS_TOKEN (ou wa_config no banco)
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { createClient } from '@supabase/supabase-js'
import { getWaCredentials } from '@/lib/whatsapp/credentials'

const META = 'https://graph.facebook.com/v20.0'

function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Supabase não configurado')
  return createClient(url, key)
}

export async function POST(req: NextRequest) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })

  const admin = adminClient()
  const { data: profile } = await admin.from('profiles').select('unit_id').eq('id', user.id).single()
  const unitId = profile?.unit_id ?? undefined

  const creds = await getWaCredentials(unitId)
  const accessToken = creds.accessToken || process.env.WHATSAPP_ACCESS_TOKEN || ''
  const appId       = process.env.WHATSAPP_APP_ID || ''

  if (!accessToken) return NextResponse.json({ error: 'Token não configurado' }, { status: 500 })
  if (!appId)       return NextResponse.json({ error: 'WHATSAPP_APP_ID não configurado nas variáveis de ambiente' }, { status: 500 })

  const formData = await req.formData()
  const file = formData.get('file') as File | null
  if (!file) return NextResponse.json({ error: 'Arquivo não enviado' }, { status: 400 })

  const allowedTypes = ['image/jpeg', 'image/png', 'image/webp']
  if (!allowedTypes.includes(file.type)) {
    return NextResponse.json({ error: 'Tipo de arquivo não suportado. Use JPEG, PNG ou WebP.' }, { status: 400 })
  }

  const fileBytes = await file.arrayBuffer()
  const fileSize  = fileBytes.byteLength

  // Passo 1: criar sessão de upload
  const sessionUrl = `${META}/${appId}/uploads?file_type=${encodeURIComponent(file.type)}&file_length=${fileSize}&access_token=${accessToken}`
  const sessionRes = await fetch(sessionUrl, { method: 'POST' })
  const sessionData = await sessionRes.json() as { id?: string; error?: { message: string } }

  if (!sessionRes.ok || !sessionData.id) {
    const msg = sessionData.error?.message ?? 'Erro ao criar sessão de upload no Meta'
    console.error('[upload-template-media] sessão:', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }

  // Passo 2: fazer upload do arquivo para a sessão
  const uploadRes = await fetch(`${META}/${sessionData.id}`, {
    method: 'POST',
    headers: {
      Authorization: `OAuth ${accessToken}`,
      file_offset:   '0',
      'Content-Type': file.type,
    },
    body: fileBytes,
  })
  const uploadData = await uploadRes.json() as { h?: string; error?: { message: string } }

  if (!uploadRes.ok || !uploadData.h) {
    const msg = uploadData.error?.message ?? 'Erro ao fazer upload para o Meta'
    console.error('[upload-template-media] upload:', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }

  return NextResponse.json({ handle: uploadData.h })
}
