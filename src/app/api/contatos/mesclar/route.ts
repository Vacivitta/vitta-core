import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { canAccessUnit, isPerfilGestor } from '@/lib/auth/access'

/**
 * Mescla duas pessoas da mesma unidade (função mesclar_contatos, migração 153):
 * os negócios, dependentes, conversas e campos da pessoa de `remover` passam para
 * `manter`, que completa o que não tinha; `remover` é apagado.
 *
 * POST /api/contatos/mesclar
 * Body: { manter, remover }
 * Resposta: { ok: true } | { error: string }
 * Só gestor ou admin, com vínculo à unidade dos contatos.
 * Erros: 401, 400 (faltando, iguais, unidades diferentes, dependente), 403, 404, 500
 */
export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

  const { manter, remover } = await req.json().catch(() => ({})) as { manter?: unknown; remover?: unknown }
  if (typeof manter !== 'string' || typeof remover !== 'string' || !manter || !remover) {
    return NextResponse.json({ error: 'manter e remover são obrigatórios' }, { status: 400 })
  }
  if (manter === remover) return NextResponse.json({ error: 'Escolha duas pessoas diferentes' }, { status: 400 })

  const admin = createAdminClient()

  const { data: profile } = await admin.from('profiles').select('perfil').eq('id', user.id).single()
  if (!profile || !isPerfilGestor(profile.perfil)) return NextResponse.json({ error: 'Sem permissão' }, { status: 403 })

  const { data: contatos } = await admin.from('contatos').select('id, unit_id, responsavel_id').in('id', [manter, remover])
  const cm = contatos?.find(c => c.id === manter)
  const cr = contatos?.find(c => c.id === remover)
  if (!cm || !cr) return NextResponse.json({ error: 'Contato não encontrado' }, { status: 404 })
  if (cm.responsavel_id || cr.responsavel_id) {
    return NextResponse.json({ error: 'Dependente não é mesclado: mescle a pessoa responsável' }, { status: 400 })
  }
  if (cm.unit_id !== cr.unit_id) {
    return NextResponse.json({ error: 'Só é possível mesclar pessoas da mesma unidade' }, { status: 400 })
  }
  if (!(await canAccessUnit(supabase, user.id, cm.unit_id))) {
    return NextResponse.json({ error: 'Sem permissão' }, { status: 403 })
  }

  const { error } = await admin.rpc('mesclar_contatos', { manter, remover, por: user.id })
  if (error) {
    console.error('[contatos/mesclar] mesclar_contatos falhou:', error.code, error.message)
    return NextResponse.json({ error: 'Não foi possível mesclar as pessoas' }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}
