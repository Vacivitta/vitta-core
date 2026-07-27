import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

async function getProfile() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const admin = createAdminClient()
  const { data: profile } = await admin
    .from('profiles').select('unit_id, perfil').eq('id', user.id).single()
  return profile
}

export async function GET() {
  const profile = await getProfile()
  if (!profile?.unit_id) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('wa_template_folders')
    .select('id, unit_id, nome, ordem, criado_em')
    .eq('unit_id', profile.unit_id)
    .order('ordem')
    .order('nome')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function POST(req: NextRequest) {
  const profile = await getProfile()
  if (!profile?.unit_id || profile.perfil === 'atendente')
    return NextResponse.json({ error: 'Sem permissão' }, { status: 403 })

  const { nome } = await req.json() as { nome: string }
  if (!nome?.trim()) return NextResponse.json({ error: 'Nome obrigatório' }, { status: 400 })

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('wa_template_folders')
    .insert({ unit_id: profile.unit_id, nome: nome.trim() })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function PUT(req: NextRequest) {
  const profile = await getProfile()
  if (!profile?.unit_id || profile.perfil === 'atendente')
    return NextResponse.json({ error: 'Sem permissão' }, { status: 403 })

  const { id, nome, ordem } = await req.json() as { id: string; nome?: string; ordem?: number }
  if (!id) return NextResponse.json({ error: 'ID obrigatório' }, { status: 400 })

  const admin = createAdminClient()
  const updates: Record<string, unknown> = {}
  if (nome?.trim()) updates.nome = nome.trim()
  if (typeof ordem === 'number') updates.ordem = ordem

  const { data, error } = await admin
    .from('wa_template_folders')
    .update(updates)
    .eq('id', id)
    .eq('unit_id', profile.unit_id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function PATCH(req: NextRequest) {
  const profile = await getProfile()
  if (!profile?.unit_id || profile.perfil === 'atendente')
    return NextResponse.json({ error: 'Sem permissão' }, { status: 403 })

  const { template_name, folder_id } = await req.json() as { template_name: string; folder_id: string | null }
  if (!template_name) return NextResponse.json({ error: 'template_name obrigatório' }, { status: 400 })

  const admin = createAdminClient()
  const { error } = await admin
    .from('wa_message_templates')
    .update({ folder_id: folder_id || null })
    .eq('unit_id', profile.unit_id)
    .eq('template_name', template_name)
    .eq('category', 'meta_api')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

export async function DELETE(req: NextRequest) {
  const profile = await getProfile()
  if (!profile?.unit_id || profile.perfil === 'atendente')
    return NextResponse.json({ error: 'Sem permissão' }, { status: 403 })

  const { searchParams } = new URL(req.url)
  const id = searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'ID obrigatório' }, { status: 400 })

  const admin = createAdminClient()
  const { error } = await admin
    .from('wa_template_folders')
    .delete()
    .eq('id', id)
    .eq('unit_id', profile.unit_id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
