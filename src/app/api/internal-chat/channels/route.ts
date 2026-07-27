import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export async function GET() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })

  const admin = createAdminClient()
  const { data: profile } = await admin
    .from('profiles').select('perfil').eq('id', user.id).single()

  if (!profile || !['admin', 'gestor_vacivitta'].includes(profile.perfil))
    return NextResponse.json({ error: 'Acesso restrito' }, { status: 403 })

  const { data: units } = await admin
    .from('units').select('id, nome').eq('ativo', true).order('nome')

  const { data: channels } = await admin
    .from('internal_channels')
    .select('id, unit_a_id, unit_b_id, ativo, criado_em, unit_a:units!unit_a_id(id, nome), unit_b:units!unit_b_id(id, nome)')
    .order('criado_em')

  return NextResponse.json({ units, channels })
}

export async function POST(req: NextRequest) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })

  const admin = createAdminClient()
  const { data: profile } = await admin
    .from('profiles').select('perfil').eq('id', user.id).single()

  if (!profile || !['admin', 'gestor_vacivitta'].includes(profile.perfil))
    return NextResponse.json({ error: 'Acesso restrito' }, { status: 403 })

  const body = await req.json() as { unit_a_id: string; unit_b_id: string }
  if (!body.unit_a_id || !body.unit_b_id || body.unit_a_id === body.unit_b_id)
    return NextResponse.json({ error: 'Selecione duas unidades diferentes' }, { status: 400 })

  const [a, b] = [body.unit_a_id, body.unit_b_id].sort()

  const { data, error } = await admin
    .from('internal_channels')
    .upsert({ unit_a_id: a, unit_b_id: b, ativo: true }, { onConflict: 'unit_a_id,unit_b_id' })
    .select('id, unit_a_id, unit_b_id, ativo, criado_em')
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
    .from('profiles').select('perfil').eq('id', user.id).single()

  if (!profile || !['admin', 'gestor_vacivitta'].includes(profile.perfil))
    return NextResponse.json({ error: 'Acesso restrito' }, { status: 403 })

  const { searchParams } = new URL(req.url)
  const id = searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id obrigatório' }, { status: 400 })

  await admin.from('internal_channels').update({ ativo: false }).eq('id', id)
  return NextResponse.json({ ok: true })
}
