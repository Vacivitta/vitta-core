import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// GET  /api/whatsapp/tags              — lista todas as tags da unidade
// POST /api/whatsapp/tags              — cria nova tag { name, color }
// PUT  /api/whatsapp/tags?id=          — edita tag { name, color }
// DELETE /api/whatsapp/tags?id=        — remove tag

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })

  const { data, error } = await supabase
    .from('wa_tags')
    .select('*')
    .order('name')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data ?? [])
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })

  const { data: profile } = await supabase.from('profiles').select('unit_id').eq('id', user.id).single()
  if (!profile?.unit_id) return NextResponse.json({ error: 'Usuário sem unidade' }, { status: 400 })

  const body = await req.json() as { name: string; color?: string }
  if (!body.name?.trim()) return NextResponse.json({ error: 'name obrigatório' }, { status: 400 })

  const { data, error } = await supabase
    .from('wa_tags')
    .insert({ unit_id: profile.unit_id, name: body.name.trim(), color: body.color ?? '#6B7280' })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data, { status: 201 })
}

export async function PUT(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })

  const id = req.nextUrl.searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id obrigatório' }, { status: 400 })

  const body = await req.json() as { name?: string; color?: string }

  const { data, error } = await supabase
    .from('wa_tags')
    .update({ ...(body.name && { name: body.name.trim() }), ...(body.color && { color: body.color }) })
    .eq('id', id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function DELETE(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })

  const id = req.nextUrl.searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id obrigatório' }, { status: 400 })

  const { error } = await supabase.from('wa_tags').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
