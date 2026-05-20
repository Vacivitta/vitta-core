import { createClient } from './supabase/client'
import type { Lead, LeadKanban, Funnel, FunnelStage, FunnelWithStages } from '@/types/database'

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
  lead: Omit<Lead, 'id' | 'created_at' | 'updated_at' | 'arquivado' | 'motivo_perda' | 'ordem' | 'stage_changed_at'>
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

export async function updateLead(id: string, updates: Partial<Lead>): Promise<Lead> {
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

export async function archiveLead(id: string, motivo_perda: string): Promise<void> {
  const supabase = createClient()
  const { error } = await supabase
    .from('leads')
    .update({ arquivado: true, motivo_perda })
    .eq('id', id)
  if (error) throw error
}

export async function moveLeadStage(id: string, stage_id: string, ordem: number): Promise<void> {
  const supabase = createClient()
  const { error } = await supabase
    .from('leads')
    .update({ stage_id, ordem })
    .eq('id', id)
  if (error) throw error
}

export async function reorderLeads(updates: { id: string; ordem: number }[]): Promise<void> {
  const supabase = createClient()
  await Promise.all(
    updates.map(({ id, ordem }) =>
      supabase.from('leads').update({ ordem }).eq('id', id)
    )
  )
}

export async function getArchivedLeads(funnel_id?: string): Promise<LeadKanban[]> {
  const supabase = createClient()
  let query = supabase.from('leads_arquivados').select('*')
  if (funnel_id) query = query.eq('funnel_id', funnel_id)
  const { data, error } = await query
  if (error) throw error
  return data as LeadKanban[]
}

export async function restoreLead(id: string): Promise<void> {
  const supabase = createClient()
  const { error } = await supabase
    .from('leads')
    .update({ arquivado: false, motivo_perda: null })
    .eq('id', id)
  if (error) throw error
}
