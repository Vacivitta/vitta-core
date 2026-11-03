import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { canAccessUnit, isPerfilGestor } from '@/lib/auth/access'
import { PRAZO_LOTE_MS, processarLoteCampanha } from '@/lib/whatsapp/campanha'
import { lerEstadoCampanha, podeDisparar } from '@/lib/whatsapp/campanha-regras'
import { resumoErro } from '@/lib/log-seguro'

export const maxDuration = 60

async function autorizar(campaignId: string) {
  const supabaseUser = await createServerClient()
  const { data: { user } } = await supabaseUser.auth.getUser()
  if (!user) return { erro: NextResponse.json({ error: 'Não autorizado' }, { status: 401 }) } as const

  const supabase = createAdminClient()
  const { data: campaign } = await supabase
    .from('wa_campaigns')
    .select('id, unit_id, status, scheduled_at, started_at, motivo_pausa, retomar_em')
    .eq('id', campaignId)
    .maybeSingle()
  if (!campaign) return { erro: NextResponse.json({ error: 'Campanha não encontrada' }, { status: 404 }) } as const

  const { data: profile } = await supabase.from('profiles').select('perfil').eq('id', user.id).single()
  if (!profile || !(await canAccessUnit(supabaseUser, user.id, campaign.unit_id))) {
    return { erro: NextResponse.json({ error: 'Acesso negado' }, { status: 403 }) } as const
  }
  if (!isPerfilGestor(profile.perfil)) {
    return { erro: NextResponse.json({ error: 'Sem permissão para alterar campanhas' }, { status: 403 }) } as const
  }
  return { supabase, campaign } as const
}

export async function POST(req: NextRequest) {
  const { campaign_id } = await req.json() as { campaign_id?: string }
  if (!campaign_id) return NextResponse.json({ error: 'campaign_id obrigatório' }, { status: 400 })

  const auth = await autorizar(campaign_id)
  if ('erro' in auth) return auth.erro
  const { supabase, campaign } = auth

  const estado = lerEstadoCampanha(campaign)
  if (!estado) return NextResponse.json({ error: `Status desconhecido: ${campaign.status}` }, { status: 422 })
  const disparo = podeDisparar(estado, new Date())
  if (!disparo.ok) return NextResponse.json({ error: disparo.motivo }, { status: 422 })

  const { data: marcada, error } = await supabase
    .from('wa_campaigns')
    .update({
      status: 'enviando', motivo_pausa: null, retomar_em: null,
      started_at: campaign.started_at ?? new Date().toISOString(),
    })
    .eq('id', campaign_id)
    .eq('status', campaign.status)
    .select('id')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!marcada?.length) return NextResponse.json({ error: 'A campanha mudou de status; atualize a página' }, { status: 409 })

  try {
    const resultado = await processarLoteCampanha(supabase, campaign_id, Date.now() + PRAZO_LOTE_MS)
    return NextResponse.json({ ok: true, resultado })
  } catch (e) {
    console.error('[campaign-process] primeiro lote falhou:', resumoErro(e))
    return NextResponse.json({ ok: true, resultado: null })
  }
}

export async function PATCH(req: NextRequest) {
  const { campaign_id, action } = await req.json() as { campaign_id?: string; action?: 'pause' | 'cancel' }
  if (!campaign_id || (action !== 'pause' && action !== 'cancel')) {
    return NextResponse.json({ error: 'campaign_id e action obrigatórios' }, { status: 400 })
  }

  const auth = await autorizar(campaign_id)
  if ('erro' in auth) return auth.erro
  const { supabase } = auth

  const atualizacao = action === 'cancel'
    ? { status: 'cancelada', motivo_pausa: null, retomar_em: null }
    : { status: 'pausada', motivo_pausa: 'manual', retomar_em: null }
  const { data, error } = await supabase
    .from('wa_campaigns')
    .update(atualizacao)
    .eq('id', campaign_id)
    .in('status', action === 'cancel' ? ['rascunho', 'agendada', 'pausada', 'enviando'] : ['enviando', 'pausada'])
    .select('id, status, motivo_pausa, retomar_em')
    .maybeSingle()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ error: 'A campanha não pode mais ser alterada' }, { status: 409 })
  return NextResponse.json({ ok: true, ...data })
}
