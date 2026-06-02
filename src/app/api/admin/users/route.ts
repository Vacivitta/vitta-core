import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

// POST /api/admin/users — convida novo usuário
export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

  const { data: caller } = await supabase.from('profiles').select('perfil').eq('id', user.id).single()
  if (!caller || !['admin', 'gestor_vacivitta', 'gestor_unidade'].includes(caller.perfil)) {
    return NextResponse.json({ error: 'Sem permissão' }, { status: 403 })
  }

  const body = await req.json().catch(() => null)
  const { email, full_name, perfil, unit_id } = body ?? {}
  if (!email || !full_name || !perfil) {
    return NextResponse.json({ error: 'email, full_name e perfil são obrigatórios' }, { status: 400 })
  }

  const admin = createAdminClient()

  // Verifica se usuário já existe
  const { data: existing } = await admin
    .from('profiles')
    .select('id')
    .eq('email', email)
    .maybeSingle()

  if (existing) {
    return NextResponse.json({ error: 'E-mail já cadastrado' }, { status: 409 })
  }

  // Convida o usuário (envia e-mail de convite)
  const { data: invited, error: inviteErr } = await admin.auth.admin.inviteUserByEmail(email, {
    data: { full_name },
  })

  if (inviteErr || !invited?.user) {
    return NextResponse.json({ error: inviteErr?.message ?? 'Erro ao convidar' }, { status: 500 })
  }

  // Atualiza o perfil criado pelo trigger com os campos extras
  await admin.from('profiles').update({ full_name, perfil, unit_id: unit_id ?? null, email }).eq('id', invited.user.id)

  // Vínculo user_units se unit_id informado
  if (unit_id) {
    await admin.from('user_units').upsert({ user_id: invited.user.id, unit_id }, { onConflict: 'user_id,unit_id' })
  }

  return NextResponse.json({ id: invited.user.id })
}

// GET /api/admin/users — lista todos os usuários
export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

  const { data: caller } = await supabase.from('profiles').select('perfil').eq('id', user.id).single()
  if (!caller || !['admin', 'gestor_vacivitta', 'gestor_unidade'].includes(caller.perfil)) {
    return NextResponse.json({ error: 'Sem permissão' }, { status: 403 })
  }

  const { data, error } = await supabase
    .from('profiles')
    .select('id, full_name, email, perfil, unit_id, ativo, created_at, unit:units(id,nome)')
    .order('full_name')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
