import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { lerTipoTag } from '@/lib/tags'
import { buscarPerfil } from '@/lib/supabase/perfil'

// GET  /api/whatsapp/tags?tipo=lead|conversa — tags da unidade ativa (do tipo, se informado)
// POST /api/whatsapp/tags              — cria nova tag { name, color, tipo }
// PUT  /api/whatsapp/tags?id=          — edita tag { name, color, tipo }
// DELETE /api/whatsapp/tags?id=        — remove tag
// tipo (migração 133): 'lead' = tag de cliente, 'conversa' = tag de conversa.

const ERRO_TROCA_TIPO = 'Esta tag já está aplicada. Para mudar o tipo, remova-a dos clientes e conversas ou crie outra tag.'

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })

  const tipoParam = req.nextUrl.searchParams.get('tipo')
  const tipo = lerTipoTag(tipoParam)
  if (tipoParam !== null && !tipo) return NextResponse.json({ error: 'tipo inválido' }, { status: 400 })

  // Sem o filtro de unidade o admin global (RLS libera tudo) recebia as tags de todas
  const { data: profile } = await buscarPerfil(supabase, user.id, 'unit_id')
  if (!profile?.unit_id) return NextResponse.json([])

  let q = supabase.from('wa_tags').select('*').eq('unit_id', profile.unit_id)
  if (tipo) q = q.eq('tipo', tipo)
  const { data, error } = await q.order('name')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data ?? [])
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })

  const { data: profile } = await buscarPerfil(supabase, user.id, 'unit_id')
  if (!profile?.unit_id) return NextResponse.json({ error: 'Usuário sem unidade' }, { status: 400 })

  const body = await req.json().catch(() => null) as { name?: unknown; color?: unknown; tipo?: unknown } | null
  const name = typeof body?.name === 'string' ? body.name.trim() : ''
  if (!name) return NextResponse.json({ error: 'name obrigatório' }, { status: 400 })
  const tipo = lerTipoTag(body?.tipo)
  if (!tipo) return NextResponse.json({ error: 'Escolha o tipo da tag: cliente ou conversa' }, { status: 400 })
  const color = typeof body?.color === 'string' && body.color ? body.color : '#6B7280'

  const { data, error } = await supabase
    .from('wa_tags')
    .insert({ unit_id: profile.unit_id, name, color, tipo })
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

  const body = await req.json().catch(() => null) as { name?: unknown; color?: unknown; tipo?: unknown } | null
  const name  = typeof body?.name === 'string' ? body.name.trim() : ''
  const color = typeof body?.color === 'string' ? body.color : ''
  const tipo  = lerTipoTag(body?.tipo)
  if (body?.tipo !== undefined && !tipo) return NextResponse.json({ error: 'tipo inválido' }, { status: 400 })

  const { data, error } = await supabase
    .from('wa_tags')
    .update({ ...(name && { name }), ...(color && { color }), ...(tipo && { tipo }) })
    .eq('id', id)
    .select()
    .single()

  if (error) {
    // 23514: trocar o tipo de tag já aplicada (trigger da 133)
    if (error.code === '23514') return NextResponse.json({ error: ERRO_TROCA_TIPO }, { status: 409 })
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
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
