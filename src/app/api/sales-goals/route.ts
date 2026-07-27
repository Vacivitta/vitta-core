import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export async function GET() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })

  const admin = createAdminClient()
  const { data: profile } = await admin
    .from('profiles').select('unit_id, perfil').eq('id', user.id).single()

  if (!profile?.unit_id || profile.perfil === 'atendente')
    return NextResponse.json({ error: 'Sem permissão' }, { status: 403 })

  const { data, error } = await admin
    .from('sales_goals')
    .select('id, unit_id, user_id, month, target, created_at')
    .eq('unit_id', profile.unit_id)
    .is('user_id', null)
    .order('month', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function POST(req: NextRequest) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })

  const admin = createAdminClient()
  const { data: profile } = await admin
    .from('profiles').select('unit_id, perfil').eq('id', user.id).single()

  if (!profile?.unit_id || profile.perfil === 'atendente')
    return NextResponse.json({ error: 'Sem permissão' }, { status: 403 })

  const body = await req.json() as { month: string; target: number }
  if (!body.month || typeof body.target !== 'number' || body.target < 0)
    return NextResponse.json({ error: 'month e target obrigatórios' }, { status: 400 })

  const { data, error } = await admin
    .from('sales_goals')
    .upsert({
      unit_id: profile.unit_id,
      user_id: null,
      month: body.month,
      target: body.target,
    }, { onConflict: 'unit_id,user_id,month' })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function DELETE(req: NextRequest) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })

  const admin = createAdminClient()
  const { data: profile } = await admin
    .from('profiles').select('unit_id, perfil').eq('id', user.id).single()

  if (!profile?.unit_id || profile.perfil === 'atendente')
    return NextResponse.json({ error: 'Sem permissão' }, { status: 403 })

  const { searchParams } = new URL(req.url)
  const id = searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id obrigatório' }, { status: 400 })

  const { error } = await admin
    .from('sales_goals')
    .delete()
    .eq('id', id)
    .eq('unit_id', profile.unit_id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
