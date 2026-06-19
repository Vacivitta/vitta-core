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
  const allowed = ['full_name', 'apelido', 'perfil', 'unit_id', 'ativo']
  const updates: Record<string, unknown> = {}
  for (const key of allowed) {
    if (key in body) updates[key] = body[key]
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'Nenhum campo para atualizar' }, { status: 400 })
  }

  const admin = createAdminClient()
  const { error } = await admin.from('profiles').update(updates).eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Atualiza user_units se unit_id foi alterado
  if ('unit_id' in updates && updates.unit_id) {
    await admin.from('user_units').upsert(
      { user_id: id, unit_id: updates.unit_id },
      { onConflict: 'user_id,unit_id' }
    )
  }

  return NextResponse.json({ ok: true })
}
