import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { canAccessUnit, isPerfilGestor } from '@/lib/auth/access'

interface TransferPayload {
  leadId:      string
  targetUnitId: string
  targetFunnelId: string
  observacao:  string
}

/**
 * Transfere um lead de uma unidade para outra.
 * Atualiza unit_id, funnel_id, stage_id (primeiro estágio do funil destino),
 * limpa responsavel_id, e propaga unit_id para tabelas filhas.
 * Desvincula wa_conversations e cria notificações em ambas as unidades.
 *
 * POST /api/leads/transfer
 * Body: { leadId, targetUnitId, targetFunnelId, observacao }
 * Resposta: { ok: true } | { error: string }
 * Só gestor ou admin, e só para uma unidade à qual o usuário tem acesso (admin global ou user_units).
 * Entre unidades de tipos diferentes (clínica x comercial), só admin global.
 * Erros: 401 (não autenticado), 400 (campos faltando), 404 (lead/funil não encontrado), 403 (sem permissão, sem acesso ao destino ou mesma unidade), 500
 */
export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

  const body = await req.json() as Partial<TransferPayload>
  const { leadId, targetUnitId, targetFunnelId, observacao } = body

  if (!leadId || !targetUnitId || !targetFunnelId) {
    return NextResponse.json({ error: 'leadId, targetUnitId e targetFunnelId são obrigatórios' }, { status: 400 })
  }

  // Autorização: o lead de origem precisa ser visível ao usuário (RLS de leads)
  const { data: ownLead } = await supabase.from('leads').select('id').eq('id', leadId).maybeSingle()
  if (!ownLead) return NextResponse.json({ error: 'Lead não encontrado' }, { status: 404 })

  const admin = createAdminClient()

  // Perfil e acesso à unidade destino (a tela só lista unidades vinculadas, pelo RLS de units)
  const { data: perfilRow } = await admin.from('profiles').select('perfil').eq('id', user.id).single()
  if (!perfilRow || !isPerfilGestor(perfilRow.perfil)) {
    return NextResponse.json({ error: 'Sem permissão para transferir leads' }, { status: 403 })
  }
  if (!(await canAccessUnit(supabase, user.id, targetUnitId))) {
    return NextResponse.json({ error: 'Sem acesso à unidade destino' }, { status: 403 })
  }

  // O funil destino precisa ser da unidade destino — senão o lead some do kanban
  const { data: targetFunnel } = await admin
    .from('funnels').select('id').eq('id', targetFunnelId).eq('unit_id', targetUnitId).maybeSingle()
  if (!targetFunnel) return NextResponse.json({ error: 'Funil não pertence à unidade destino' }, { status: 400 })

  const { data: profile } = await admin
    .from('profiles').select('id, unit_id, full_name').eq('id', user.id).single()
  if (!profile) return NextResponse.json({ error: 'Perfil não encontrado' }, { status: 401 })

  const { data: lead } = await admin
    .from('leads').select('id, nome, sobrenome, telefone, unit_id').eq('id', leadId).single()
  if (!lead) return NextResponse.json({ error: 'Lead não encontrado' }, { status: 404 })

  if (lead.unit_id === targetUnitId) {
    return NextResponse.json({ error: 'Lead já pertence a esta unidade' }, { status: 403 })
  }

  // Clínica x comercial: transferência entre tipos diferentes só por admin global
  const tipos = await conferirTipos(admin, supabase, lead.unit_id, targetUnitId)
  if (tipos === 'erro') {
    return NextResponse.json({ error: 'Não foi possível conferir o tipo das unidades. Tente de novo.' }, { status: 503 })
  }
  if (tipos === 'bloqueado') {
    return NextResponse.json({ error: 'Transferência entre clínica e comercial só por um administrador' }, { status: 403 })
  }

  // Verifica se já existe lead com mesmo telefone na unidade destino
  if (lead.telefone) {
    const phoneRaw = lead.telefone.replace(/\D/g, '')
    const { data: existing } = await admin
      .from('leads')
      .select('id, nome, sobrenome, telefone')
      .eq('unit_id', targetUnitId)
      .eq('arquivado', false)

    const duplicate = (existing ?? []).find(e => {
      const ePhone = (e as { telefone: string | null }).telefone
      return ePhone && ePhone.replace(/\D/g, '') === phoneRaw
    })

    if (duplicate) {
      const dupName = [duplicate.nome, duplicate.sobrenome].filter(Boolean).join(' ')
      return NextResponse.json(
        { error: `Já existe um contato com este telefone na unidade destino: ${dupName}` },
        { status: 409 },
      )
    }
  }

  const { data: targetStages } = await admin
    .from('funnel_stages')
    .select('id')
    .eq('funnel_id', targetFunnelId)
    .order('ordem', { ascending: true })
    .limit(1)

  if (!targetStages || targetStages.length === 0) {
    return NextResponse.json({ error: 'Funil destino não possui estágios' }, { status: 404 })
  }

  const targetStageId = targetStages[0].id
  const sourceUnitId = lead.unit_id
  const leadName = [lead.nome, lead.sobrenome].filter(Boolean).join(' ')

  const [{ data: sourceUnit }, { data: targetUnit }] = await Promise.all([
    admin.from('units').select('nome').eq('id', sourceUnitId).single(),
    admin.from('units').select('nome').eq('id', targetUnitId).single(),
  ])

  // Atualiza o lead
  const { error: leadErr } = await admin
    .from('leads')
    .update({
      unit_id: targetUnitId,
      funnel_id: targetFunnelId,
      stage_id: targetStageId,
      responsavel_id: null,
      stage_changed_at: new Date().toISOString(),
    })
    .eq('id', leadId)

  if (leadErr) return NextResponse.json({ error: leadErr.message }, { status: 500 })

  // Propaga unit_id nas tabelas filhas
  await Promise.all([
    admin.from('lead_contacts').update({ unit_id: targetUnitId }).eq('lead_id', leadId),
    admin.from('lead_notes').update({ unit_id: targetUnitId }).eq('lead_id', leadId),
    admin.from('lead_tasks').update({ unit_id: targetUnitId, responsavel_id: null }).eq('lead_id', leadId),
    admin.from('lead_responsible_history').update({ unit_id: targetUnitId }).eq('lead_id', leadId),
  ])

  // Desvincula conversas WhatsApp da unidade origem
  await admin
    .from('wa_conversations')
    .update({ lead_id: null })
    .eq('lead_id', leadId)

  // Registra no histórico de estágios
  await admin.from('lead_stage_history').insert({
    lead_id: leadId,
    de_stage_id: null,
    para_stage_id: targetStageId,
    movido_por: user.id,
    movido_via: 'transferencia',
  })

  // Cria nota com a observação da transferência
  if (observacao?.trim()) {
    await admin.from('lead_notes').insert({
      lead_id: leadId,
      unit_id: targetUnitId,
      autor_id: user.id,
      conteudo: `[Transferência de ${sourceUnit?.nome ?? 'outra unidade'}] ${observacao.trim()}`,
    })
  }

  // Notifica a unidade destino
  await admin.from('notifications').insert({
    unit_id: targetUnitId,
    user_id: null,
    type: 'lead_transfer',
    title: '🔄 Lead transferido para sua unidade',
    body: `${leadName} foi transferido de ${sourceUnit?.nome ?? 'outra unidade'} por ${profile.full_name ?? 'um usuário'}`,
    lead_id: leadId,
  })

  // Notifica a unidade origem
  await admin.from('notifications').insert({
    unit_id: sourceUnitId,
    user_id: null,
    type: 'lead_transfer',
    title: '🔄 Lead transferido para outra unidade',
    body: `${leadName} foi transferido para ${targetUnit?.nome ?? 'outra unidade'} por ${profile.full_name ?? 'um usuário'}`,
    lead_id: leadId,
  })

  return NextResponse.json({ ok: true })
}

/**
 * Confere se as duas unidades têm o mesmo tipo (clínica/comercial) ou se o
 * usuário é admin global: 'ok' libera, 'bloqueado' é tipo diferente sem ser
 * admin (403) e 'erro' é falha na consulta (503, sem dizer que é clínica x comercial). Antes da migração 093 a coluna `tipo` não existe e todas
 * as unidades são clínica: nesse caso (erro 42703) o tipo vale 'clinica' para as
 * duas (mesmo comportamento de hoje). Qualquer outro erro de consulta bloqueia.
 *
 * @param admin - Client service-role
 * @param userClient - Client com a sessão do usuário (para `is_global_admin`)
 * @param origemId - Unidade atual do lead
 * @param destinoId - Unidade destino
 */
async function conferirTipos(
  admin: ReturnType<typeof createAdminClient>,
  userClient: Awaited<ReturnType<typeof createClient>>,
  origemId: string | null,
  destinoId: string,
): Promise<'ok' | 'bloqueado' | 'erro'> {
  const ids = [origemId, destinoId].filter((x): x is string => !!x)
  const { data, error } = await admin.from('units').select('id, tipo').in('id', ids)
  // 42703 = coluna inexistente (093 ainda não aplicada). Qualquer outro erro bloqueia.
  if (error && error.code !== '42703') return 'erro'
  const tipoDe = (id: string | null) =>
    error ? 'clinica' : ((data ?? []).find(u => u.id === id)?.tipo ?? 'clinica')
  if (tipoDe(origemId) === tipoDe(destinoId)) return 'ok'
  const { data: isAdmin, error: adminErr } = await userClient.rpc('is_global_admin')
  if (adminErr) return 'erro'
  return isAdmin === true ? 'ok' : 'bloqueado'
}
