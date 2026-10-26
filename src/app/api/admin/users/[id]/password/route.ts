import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { checkGestorUnidadeScope } from '@/lib/admin-guard'

/**
 * POST /api/admin/users/[id]/password — gestor define uma nova senha para o usuário.
 *
 * Existe para quem foi criado com e-mail interno (`@interno.vittadesk`, ex.: enfermeiras
 * sem e-mail próprio): essas contas não conseguem usar o "esqueci minha senha".
 *
 * Permissões:
 * - admin: qualquer usuário;
 * - gestor_vacivitta: qualquer usuário, exceto admins;
 * - gestor_unidade: só gestores de unidade/atendentes das suas unidades (ver `checkGestorUnidadeScope`).
 *
 * Body: `{ password: string }` (mínimo 6 caracteres).
 * Resposta: `{ ok: true, email }` — o e-mail de login, para o gestor repassar junto com a senha.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

  const { data: caller } = await supabase.from('profiles').select('perfil').eq('id', user.id).single()
  if (!caller || !['admin', 'gestor_vacivitta', 'gestor_unidade'].includes(caller.perfil)) {
    return NextResponse.json({ error: 'Sem permissão' }, { status: 403 })
  }

  const body = await req.json().catch(() => null)
  const password = typeof body?.password === 'string' ? body.password : ''
  if (password.length < 6) {
    return NextResponse.json({ error: 'Senha deve ter pelo menos 6 caracteres' }, { status: 400 })
  }

  const admin = createAdminClient()

  const { data: target } = await admin.from('profiles').select('perfil, email').eq('id', id).maybeSingle()
  if (!target) return NextResponse.json({ error: 'Usuário não encontrado' }, { status: 404 })

  if (target.perfil === 'admin' && caller.perfil !== 'admin') {
    return NextResponse.json({ error: 'Só um admin pode redefinir a senha de outro admin' }, { status: 403 })
  }
  if (caller.perfil === 'gestor_unidade') {
    const denied = await checkGestorUnidadeScope(admin, user.id, { targetId: id })
    if (denied) return NextResponse.json({ error: denied }, { status: 403 })
  }

  const { data: updated, error } = await admin.auth.admin.updateUserById(id, { password })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true, email: updated.user?.email ?? target.email })
}
