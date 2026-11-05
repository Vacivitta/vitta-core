import { createClient } from './supabase/client'
import { etapaAoReabrir } from './status-lead'
import type { Lead, LeadKanban, FunnelStage, FunnelWithStages, MotivoPerda } from '@/types/database'

// ---- Funis ----------------------------------------------------------------

export async function getFunnelsWithStages(): Promise<FunnelWithStages[]> {
  const supabase = createClient()
  const [{ data: funnels }, { data: stages }] = await Promise.all([
    supabase.from('funnels').select('*').eq('ativo', true).order('ordem'),
    supabase.from('funnel_stages').select('*').order('funnel_id').order('ordem'),
  ])
  return (funnels ?? []).map(f => ({
    ...f,
    stages: (stages ?? []).filter(s => s.funnel_id === f.id),
  })) as FunnelWithStages[]
}

// ---- Leads ----------------------------------------------------------------

export async function getLeadsKanban(filters?: {
  funnel_id?: string
  responsavel_id?: string
  cidade?: string
  profissao?: string
  stage_id?: string
}): Promise<LeadKanban[]> {
  const supabase = createClient()
  let query = supabase.from('leads_kanban').select('*')

  if (filters?.funnel_id)      query = query.eq('funnel_id', filters.funnel_id)
  if (filters?.responsavel_id) query = query.eq('responsavel_id', filters.responsavel_id)
  if (filters?.cidade)         query = query.ilike('cidade', `%${filters.cidade}%`)
  if (filters?.profissao)      query = query.ilike('profissao', `%${filters.profissao}%`)
  if (filters?.stage_id)       query = query.eq('stage_id', filters.stage_id)

  const { data, error } = await query.order('stage_ordem').order('ordem').order('created_at')
  if (error) throw error
  return data as LeadKanban[]
}

export async function createLead(
  lead: Omit<Lead, 'id' | 'created_at' | 'updated_at' | 'arquivado' | 'status' | 'ganho_em' | 'perdido_em'
    | 'motivo_perda_id' | 'motivo_perda' | 'ordem' | 'stage_changed_at' | 'telefone_norm' | 'campos'>
    & Partial<Pick<Lead, 'campos'>>
): Promise<Lead> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('leads')
    .insert(lead)
    .select()
    .single()
  if (error) throw error
  return data
}

// Status e datas do negócio mudam só por marcarGanho/marcarPerdido/reabrir
export async function updateLead(
  id: string,
  updates: Partial<Omit<Lead, 'telefone_norm' | 'arquivado' | 'status' | 'ganho_em' | 'perdido_em' | 'motivo_perda_id'>>,
): Promise<Lead> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('leads')
    .update(updates)
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  return data
}

// O trigger fn_lead_status (migração 126) preenche ganho_em/perdido_em, marca
// is_converted no ganho e limpa o motivo ao sair de perdido.

export async function marcarGanho(id: string): Promise<void> {
  const supabase = createClient()
  const { error } = await supabase.from('leads').update({ status: 'ganho' }).eq('id', id)
  if (error) throw error
}

/** @param detalhe - Texto livre (obrigatório no motivo "Outro"; valide com gravacaoPerda) */
export async function marcarPerdido(id: string, motivoId: string, detalhe?: string | null): Promise<void> {
  const supabase = createClient()
  const { error } = await supabase
    .from('leads')
    .update({ status: 'perdido', motivo_perda_id: motivoId, motivo_perda: detalhe?.trim() || null })
    .eq('id', id)
  if (error) throw error
}

/**
 * Reabre o negócio. Se o lead está numa etapa com resultado (ex.: "Perdido"),
 * volta para a primeira etapa sem resultado do funil e grava o histórico.
 */
export async function reabrir(id: string): Promise<void> {
  const supabase = createClient()
  const { data: lead, error: leadErr } = await supabase
    .from('leads').select('stage_id, funnel_id').eq('id', id).single()
  if (leadErr) throw leadErr

  const { data: etapas, error: etapasErr } = await supabase
    .from('funnel_stages').select('id, ordem, resultado').eq('funnel_id', lead.funnel_id)
  if (etapasErr) throw etapasErr
  const lista = (etapas ?? []) as Pick<FunnelStage, 'id' | 'ordem' | 'resultado'>[]
  const destino = etapaAoReabrir(lista.find(s => s.id === lead.stage_id) ?? null, lista)

  const { error } = await supabase
    .from('leads')
    .update(destino ? { status: 'aberto', stage_id: destino } : { status: 'aberto' })
    .eq('id', id)
  if (error) throw error

  if (!destino) return
  const { data: { user } } = await supabase.auth.getUser()
  const { error: rpcErr } = await supabase.rpc('record_stage_history', {
    p_lead_id:    id,
    p_de_stage:   lead.stage_id,
    p_para_stage: destino,
    p_movido_por: user?.id ?? null,
    p_movido_via: 'reabertura',
  })
  if (rpcErr) console.error('[reabrir] record_stage_history falhou:', rpcErr)
}

/** Motivos de perda do funil, na ordem configurada. */
export async function getMotivosPerda(funnelId: string, apenasAtivos = true): Promise<MotivoPerda[]> {
  const supabase = createClient()
  let query = supabase.from('motivos_perda').select('*').eq('funnel_id', funnelId)
  if (apenasAtivos) query = query.eq('ativo', true)
  const { data, error } = await query.order('ordem').order('nome')
  if (error) throw error
  return (data ?? []) as MotivoPerda[]
}

export async function moveLeadStage(
  id: string, stage_id: string, ordem: number, de_stage_id?: string, movido_via?: string
): Promise<void> {
  const supabase = createClient()

  // Busca estágio atual ANTES do update para garantir histórico correto
  let fromStageId = de_stage_id
  if (!fromStageId) {
    const { data: cur } = await supabase.from('leads').select('stage_id').eq('id', id).single()
    fromStageId = cur?.stage_id ?? undefined
  }

  const { error } = await supabase
    .from('leads')
    .update({ stage_id, ordem })
    .eq('id', id)
  if (error) throw error

  if (!fromStageId || fromStageId === stage_id) return

  const { data: { user } } = await supabase.auth.getUser()
  const { error: rpcErr } = await supabase.rpc('record_stage_history', {
    p_lead_id:    id,
    p_de_stage:   fromStageId,
    p_para_stage: stage_id,
    p_movido_por: user?.id ?? null,
    p_movido_via: movido_via ?? 'manual',
  })
  if (rpcErr) console.error('[moveLeadStage] record_stage_history falhou:', rpcErr)
}

export async function reorderLeads(updates: { id: string; ordem: number }[]): Promise<void> {
  const supabase = createClient()
  await Promise.all(
    updates.map(({ id, ordem }) =>
      supabase.from('leads').update({ ordem }).eq('id', id)
    )
  )
}

// A view mantém o nome antigo (leads_arquivados); desde a 126 lista status = 'perdido'
export async function getLeadsPerdidos(funnel_id?: string): Promise<LeadKanban[]> {
  const supabase = createClient()
  let query = supabase.from('leads_arquivados').select('*')
  if (funnel_id) query = query.eq('funnel_id', funnel_id)
  const { data, error } = await query
  if (error) throw error
  return data as LeadKanban[]
}
