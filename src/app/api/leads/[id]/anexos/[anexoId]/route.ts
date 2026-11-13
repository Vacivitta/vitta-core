import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getAccessibleLead, isPerfilGestor } from '@/lib/auth/access'
import { ANEXOS_BUCKET } from '@/lib/anexos'
import { resumoErro } from '@/lib/log-seguro'

type Params = { params: Promise<{ id: string; anexoId: string }> }

const VALIDADE_URL_SEGUNDOS = 5 * 60

/**
 * Abre ou baixa um anexo: confere o acesso e redireciona para uma URL assinada
 * de 5 minutos do bucket privado. A URL é gerada a cada clique.
 *
 * GET /api/leads/[id]/anexos/[anexoId]?modo=abrir|baixar (padrão: baixar)
 * Resposta: 302 para a URL assinada | { error: string }
 * Erros: 401, 404 (lead ou anexo fora do alcance do usuário, ou arquivo sumido), 500
 */
export async function GET(req: NextRequest, { params }: Params) {
  const { id, anexoId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

  const lead = await getAccessibleLead(supabase, id)
  if (!lead) return NextResponse.json({ error: 'Lead não encontrado' }, { status: 404 })

  // Leitura pelo RLS do usuário: a policy de lead_anexos também decide
  const { data: anexo } = await supabase
    .from('lead_anexos').select('caminho, nome').eq('id', anexoId).eq('lead_id', lead.id).maybeSingle()
  if (!anexo) return NextResponse.json({ error: 'Anexo não encontrado' }, { status: 404 })

  const baixar = req.nextUrl.searchParams.get('modo') !== 'abrir'
  const admin = createAdminClient()
  const { data, error } = await admin.storage
    .from(ANEXOS_BUCKET)
    .createSignedUrl(anexo.caminho, VALIDADE_URL_SEGUNDOS, baixar ? { download: anexo.nome } : undefined)
  if (error || !data?.signedUrl) {
    console.error('[leads/anexos] URL assinada falhou:', resumoErro(error))
    return NextResponse.json({ error: 'Arquivo indisponível' }, { status: 404 })
  }

  const resposta = NextResponse.redirect(data.signedUrl, 302)
  resposta.headers.set('Cache-Control', 'no-store')
  resposta.headers.set('Referrer-Policy', 'no-referrer')
  return resposta
}

/**
 * Exclui um anexo: apaga o arquivo e depois a linha (repetir após uma falha
 * no meio do caminho é seguro).
 *
 * DELETE /api/leads/[id]/anexos/[anexoId]
 * Resposta: { ok: true } | { error: string }
 * Quem enviou o anexo, ou gestor (admin, gestor_vacivitta, gestor_unidade) que veja o lead.
 * Erros: 401, 403, 404, 500
 */
export async function DELETE(_req: NextRequest, { params }: Params) {
  const { id, anexoId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

  const lead = await getAccessibleLead(supabase, id)
  if (!lead) return NextResponse.json({ error: 'Lead não encontrado' }, { status: 404 })

  const admin = createAdminClient()
  const [{ data: anexo }, { data: profile }] = await Promise.all([
    admin.from('lead_anexos').select('id, caminho, enviado_por').eq('id', anexoId).eq('lead_id', lead.id).maybeSingle(),
    admin.from('profiles').select('perfil').eq('id', user.id).single(),
  ])
  if (!anexo) return NextResponse.json({ error: 'Anexo não encontrado' }, { status: 404 })
  if (anexo.enviado_por !== user.id && !isPerfilGestor(profile?.perfil)) {
    return NextResponse.json({ error: 'Só quem enviou ou um gestor pode excluir este anexo' }, { status: 403 })
  }

  const { error: rmErr } = await admin.storage.from(ANEXOS_BUCKET).remove([anexo.caminho])
  if (rmErr) {
    console.error('[leads/anexos] remover arquivo falhou:', resumoErro(rmErr))
    return NextResponse.json({ error: 'Não foi possível excluir o arquivo. Tente de novo.' }, { status: 500 })
  }
  const { error: delErr } = await admin.from('lead_anexos').delete().eq('id', anexo.id)
  if (delErr) {
    console.error('[leads/anexos] apagar registro falhou:', resumoErro(delErr))
    return NextResponse.json({ error: 'Não foi possível excluir o anexo. Tente de novo.' }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
