import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

async function getAuth() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const admin = createAdminClient()
  const { data: profile } = await admin
    .from('profiles').select('id, unit_id, perfil, full_name, apelido').eq('id', user.id).single()
  return profile
}

export async function GET(req: NextRequest) {
  const profile = await getAuth()
  if (!profile?.unit_id) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const channelId = searchParams.get('channel_id')

  const admin = createAdminClient()

  if (channelId) {
    const { data: msgs, error } = await admin
      .from('internal_channel_messages')
      .select('id, channel_id, autor_id, conteudo, created_at, media_url, media_type, autor:profiles(id, full_name, apelido)')
      .eq('channel_id', channelId)
      .order('created_at', { ascending: true })
      .limit(200)

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ messages: msgs })
  }

  const { data: channels, error } = await admin
    .from('internal_channels')
    .select('id, unit_a_id, unit_b_id, ativo, criado_em, unit_a:units!unit_a_id(id, nome), unit_b:units!unit_b_id(id, nome)')
    .or(`unit_a_id.eq.${profile.unit_id},unit_b_id.eq.${profile.unit_id}`)
    .eq('ativo', true)
    .order('criado_em')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ channels })
}

export async function POST(req: NextRequest) {
  const profile = await getAuth()
  if (!profile?.unit_id) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })

  const contentType = req.headers.get('content-type') ?? ''
  let channelId: string
  let conteudo: string | null = null
  let mediaUrl: string | null = null
  let mediaType: string | null = null

  const admin = createAdminClient()

  let mencoes: string[] = []

  if (contentType.includes('multipart/form-data')) {
    const form = await req.formData()
    channelId = form.get('channel_id') as string
    conteudo = (form.get('conteudo') as string)?.trim() || null
    const file = form.get('file') as File | null
    const mencoesRaw = form.get('mencoes') as string | null
    if (mencoesRaw) try { mencoes = JSON.parse(mencoesRaw) } catch { /* ignore */ }

    if (!channelId) return NextResponse.json({ error: 'channel_id obrigatório' }, { status: 400 })
    if (!conteudo && !file) return NextResponse.json({ error: 'conteudo ou file obrigatório' }, { status: 400 })

    if (file) {
      const ext = file.name.split('.').pop() ?? 'bin'
      const path = `${profile.unit_id}/${Date.now()}_${crypto.randomUUID().slice(0, 8)}.${ext}`
      const { error: uploadErr } = await admin.storage.from('internal-chat-media').upload(path, file, { contentType: file.type })
      if (uploadErr) return NextResponse.json({ error: uploadErr.message }, { status: 500 })
      const { data: urlData } = admin.storage.from('internal-chat-media').getPublicUrl(path)
      mediaUrl = urlData.publicUrl
      mediaType = file.type
    }
  } else {
    const body = await req.json() as { channel_id: string; conteudo: string; mencoes?: string[] }
    channelId = body.channel_id
    conteudo = body.conteudo?.trim() || null
    if (body.mencoes && body.mencoes.length > 0) mencoes = body.mencoes
    if (!channelId || !conteudo)
      return NextResponse.json({ error: 'channel_id e conteudo obrigatórios' }, { status: 400 })
  }

  const { data: channel } = await admin
    .from('internal_channels')
    .select('id, unit_a_id, unit_b_id')
    .eq('id', channelId)
    .single()

  if (!channel || (channel.unit_a_id !== profile.unit_id && channel.unit_b_id !== profile.unit_id))
    return NextResponse.json({ error: 'Canal não encontrado' }, { status: 404 })

  const insertPayload: Record<string, unknown> = { channel_id: channelId, autor_id: profile.id }
  if (conteudo) insertPayload.conteudo = conteudo
  if (mediaUrl) { insertPayload.media_url = mediaUrl; insertPayload.media_type = mediaType }
  if (mencoes.length > 0) insertPayload.mencoes = mencoes

  const { data, error } = await admin
    .from('internal_channel_messages')
    .insert(insertPayload)
    .select('id, channel_id, autor_id, conteudo, created_at, media_url, media_type, autor:profiles(id, full_name, apelido)')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
