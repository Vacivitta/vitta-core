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
  const { email, full_name, apelido, perfil, unit_id, unit_ids, password } = body ?? {}
  if (!full_name || !perfil) {
    return NextResponse.json({ error: 'full_name e perfil são obrigatórios' }, { status: 400 })
  }
  if (!email && !password) {
    return NextResponse.json({ error: 'Informe e-mail (convite) ou senha (criação direta)' }, { status: 400 })
  }

  // unit_ids tem prioridade; unit_id (legado) vira array de 1
  const resolvedUnitIds: string[] = Array.isArray(unit_ids) && unit_ids.length > 0
    ? unit_ids
    : (unit_id ? [unit_id] : [])
  const primaryUnitId = resolvedUnitIds[0] ?? null

  const admin = createAdminClient()

  // ── Modo: criação direta com senha (sem e-mail real) ──────────────────────
  if (password) {
    if (password.length < 6) {
      return NextResponse.json({ error: 'Senha deve ter pelo menos 6 caracteres' }, { status: 400 })
    }
    // Gera e-mail interno único a partir do nome
    const slug = full_name
      .toLowerCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '.')
      .replace(/^\.+|\.+$/g, '')
    const rand = Math.random().toString(36).slice(2, 6)
    const generatedEmail = `${slug}.${rand}@interno.vittadesk`

    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email:         generatedEmail,
      password,
      email_confirm: true,
      user_metadata: { full_name },
    })

    if (createErr || !created?.user) {
      return NextResponse.json({ error: createErr?.message ?? 'Erro ao criar usuário' }, { status: 500 })
    }

    await admin.from('profiles').update({
      full_name, apelido: apelido ?? null, perfil, unit_id: primaryUnitId, email: generatedEmail,
    }).eq('id', created.user.id)

    if (resolvedUnitIds.length > 0) {
      await admin.from('user_units').upsert(
        resolvedUnitIds.map(uid => ({ user_id: created.user.id, unit_id: uid })),
        { onConflict: 'user_id,unit_id' }
      )
    }

    return NextResponse.json({ id: created.user.id, generated_email: generatedEmail })
  }

  // ── Modo: convite por e-mail ──────────────────────────────────────────────
  if (!email) {
    return NextResponse.json({ error: 'E-mail é obrigatório para convite' }, { status: 400 })
  }

  // Verifica se usuário já existe
  const { data: existing } = await admin
    .from('profiles')
    .select('id')
    .eq('email', email)
    .maybeSingle()

  if (existing) {
    return NextResponse.json({ error: 'E-mail já cadastrado' }, { status: 409 })
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://vittadesk.com.br'
  const { data: invited, error: inviteErr } = await admin.auth.admin.inviteUserByEmail(email, {
    data:       { full_name },
    redirectTo: `${appUrl}/auth/callback`,
  })

  if (inviteErr || !invited?.user) {
    return NextResponse.json({ error: inviteErr?.message ?? 'Erro ao convidar' }, { status: 500 })
  }

  await admin.from('profiles').update({
    full_name, apelido: apelido ?? null, perfil, unit_id: primaryUnitId, email,
  }).eq('id', invited.user.id)

  if (resolvedUnitIds.length > 0) {
    await admin.from('user_units').upsert(
      resolvedUnitIds.map(uid => ({ user_id: invited.user.id, unit_id: uid })),
      { onConflict: 'user_id,unit_id' }
    )
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

  const admin = createAdminClient()

  const { data: profiles, error } = await admin
    .from('profiles')
    .select('id, full_name, apelido, email, perfil, unit_id, ativo, created_at, unit:units(id,nome)')
    .order('full_name')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const { data: userUnits } = await admin
    .from('user_units')
    .select('user_id, unit_id')
    .eq('ativo', true)

  const unitsByUser: Record<string, string[]> = {}
  for (const row of userUnits ?? []) {
    if (!unitsByUser[row.user_id]) unitsByUser[row.user_id] = []
    unitsByUser[row.user_id].push(row.unit_id)
  }

  const result = (profiles ?? []).map(p => ({
    ...p,
    unit_ids: unitsByUser[p.id] ?? (p.unit_id ? [p.unit_id] : []),
  }))

  return NextResponse.json(result)
}
