import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

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
 * Erros: 401 (não autenticado), 400 (campos faltando), 404 (lead/funil não encontrado), 403 (mesma unidade), 500
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

  const admin = createAdminClient()

  const { data: profile } = await admin
    .from('profiles').select('id, unit_id, full_name').eq('id', user.id).single()
  if (!profile) return NextResponse.json({ error: 'Perfil não encontrado' }, { status: 401 })

  const { data: lead } = await admin
    .from('leads').select('id, nome, sobrenome, telefone, unit_id').eq('id', leadId).single()
  if (!lead) return NextResponse.json({ error: 'Lead não encontrado' }, { status: 404 })

  if (lead.unit_id === targetUnitId) {
    return NextResponse.json({ error: 'Lead já pertence a esta unidade' }, { status: 403 })
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
