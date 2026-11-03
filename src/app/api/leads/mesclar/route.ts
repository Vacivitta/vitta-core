import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { canAccessUnit, isPerfilGestor } from '@/lib/auth/access'

/**
 * Mescla dois leads da mesma unidade: notas, tarefas, orçamentos, conversas,
 * negociação e históricos de `remover` passam para `manter`, os campos vazios de
 * `manter` são completados e `remover` é apagado (função mesclar_leads, migração 121).
 *
 * POST /api/leads/mesclar
 * Body: { manter, remover }
 * Resposta: { ok: true } | { error: string }
 * Só gestor ou admin, com vínculo à unidade dos leads.
 * Erros: 401 (não autenticado), 400 (campos faltando ou iguais, unidades diferentes), 403, 404, 500
 */
export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

  const { manter, remover } = await req.json().catch(() => ({})) as { manter?: unknown; remover?: unknown }
  if (typeof manter !== 'string' || typeof remover !== 'string' || !manter || !remover) {
    return NextResponse.json({ error: 'manter e remover são obrigatórios' }, { status: 400 })
  }
  if (manter === remover) return NextResponse.json({ error: 'Escolha dois contatos diferentes' }, { status: 400 })

  const admin = createAdminClient()

  const { data: profile } = await admin.from('profiles').select('perfil').eq('id', user.id).single()
  if (!profile || !isPerfilGestor(profile.perfil)) return NextResponse.json({ error: 'Sem permissão' }, { status: 403 })

  const { data: leads } = await admin.from('leads').select('id, unit_id').in('id', [manter, remover])
  const leadManter  = leads?.find(l => l.id === manter)
  const leadRemover = leads?.find(l => l.id === remover)
  if (!leadManter || !leadRemover) return NextResponse.json({ error: 'Contato não encontrado' }, { status: 404 })
  if (!leadManter.unit_id || leadManter.unit_id !== leadRemover.unit_id) {
    return NextResponse.json({ error: 'Só é possível mesclar contatos da mesma unidade' }, { status: 400 })
  }
  if (!(await canAccessUnit(supabase, user.id, leadManter.unit_id))) {
    return NextResponse.json({ error: 'Sem permissão' }, { status: 403 })
  }

  const { error } = await admin.rpc('mesclar_leads', { manter, remover, por: user.id })
  if (error) {
    console.error('[leads/mesclar] mesclar_leads falhou:', error.code, error.message)
    return NextResponse.json({ error: 'Não foi possível mesclar os contatos' }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
