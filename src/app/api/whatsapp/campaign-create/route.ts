import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { canAccessUnit, isPerfilGestor } from '@/lib/auth/access'
import { lerPedidoCampanha } from '@/lib/whatsapp/campanha-regras'
import { resumoErro } from '@/lib/log-seguro'
import { buscarPerfil } from '@/lib/supabase/perfil'

/**
 * Cria a campanha e os destinatários numa transação só (criar_campanha,
 * migração 135), com a sessão do usuário: o RLS decide a unidade. O envio
 * continua pelo botão Disparar (campaign-process) e pelo cron.
 */
export async function POST(req: NextRequest) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })

  const { data: profile } = await buscarPerfil(supabase, user.id, 'perfil, unit_id')
  const unitId = profile?.unit_id
  if (!profile || !isPerfilGestor(profile.perfil) || !unitId || !(await canAccessUnit(supabase, user.id, unitId))) {
    return NextResponse.json({ error: 'Sem permissão para criar campanhas' }, { status: 403 })
  }

  const lido = lerPedidoCampanha(await req.json().catch(() => null))
  if (!lido.ok) return NextResponse.json({ error: lido.erro }, { status: 400 })
  const { pedido } = lido

  const { data: campanha, error } = await supabase.rpc('criar_campanha', {
    p_unit:          unitId,
    p_nome:          pedido.nome,
    p_template:      pedido.template_id,
    p_agendada_para: pedido.agendada_para,
    p_limite_diario: pedido.limite_diario,
    p_destinatarios: pedido.destinatarios,
  })
  if (error) {
    // 22023: validação da função (mensagem para a tela); 42501: lead fora da unidade ou RLS
    if (error.code === '22023') return NextResponse.json({ error: error.message }, { status: 400 })
    if (error.code === '42501') return NextResponse.json({ error: 'Destinatário ou template fora da sua unidade' }, { status: 403 })
    console.error('[campaign-create] falha ao criar campanha:', resumoErro(error))
    return NextResponse.json({ error: 'Erro ao criar campanha' }, { status: 500 })
  }
  return NextResponse.json({ campanha })
}
