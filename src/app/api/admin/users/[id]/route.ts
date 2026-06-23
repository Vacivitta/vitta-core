import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

// PATCH /api/admin/users/[id] — atualiza perfil de qualquer usuário
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

  const { data: caller } = await supabase.from('profiles').select('perfil').eq('id', user.id).single()
  if (!caller || !['admin', 'gestor_vacivitta', 'gestor_unidade'].includes(caller.perfil)) {
    return NextResponse.json({ error: 'Sem permissão' }, { status: 403 })
  }

  const body = await req.json().catch(() => ({}))
  const { unit_ids, ...rest } = body as { unit_ids?: string[]; [k: string]: unknown }

  const allowed = ['full_name', 'apelido', 'perfil', 'unit_id', 'ativo']
  const updates: Record<string, unknown> = {}
  for (const key of allowed) {
    if (key in rest) updates[key] = rest[key]
  }

  // Se unit_ids foi enviado, deriva unit_id principal
  if (Array.isArray(unit_ids)) {
    updates.unit_id = unit_ids[0] ?? null
  }

  if (Object.keys(updates).length === 0 && !Array.isArray(unit_ids)) {
    return NextResponse.json({ error: 'Nenhum campo para atualizar' }, { status: 400 })
  }

  const admin = createAdminClient()

  if (Object.keys(updates).length > 0) {
    const { error } = await admin.from('profiles').update(updates).eq('id', id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Substitui completamente as unidades do usuário
  if (Array.isArray(unit_ids)) {
    await admin.from('user_units').delete().eq('user_id', id)
    if (unit_ids.length > 0) {
      await admin.from('user_units').insert(
        unit_ids.map(uid => ({ user_id: id, unit_id: uid }))
      )
    }
  }

  return NextResponse.json({ ok: true })
}
