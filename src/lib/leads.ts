import { createClient } from './supabase/client'
import type { Lead, LeadKanban, LeadStage } from '@/types/database'

export async function getLeadsKanban(filters?: {
  responsavel_id?: string
  cidade?: string
  profissao?: string
  stage?: LeadStage
}): Promise<LeadKanban[]> {
  const supabase = createClient()
  let query = supabase.from('leads_kanban').select('*')

  if (filters?.responsavel_id) query = query.eq('responsavel_id', filters.responsavel_id)
  if (filters?.cidade) query = query.ilike('cidade', `%${filters.cidade}%`)
  if (filters?.profissao) query = query.ilike('profissao', `%${filters.profissao}%`)
  if (filters?.stage) query = query.eq('stage', filters.stage)

  const { data, error } = await query.order('ordem').order('created_at')
  if (error) throw error
  return data as LeadKanban[]
}

export async function createLead(lead: Omit<Lead, 'id' | 'created_at' | 'updated_at' | 'arquivado' | 'motivo_perda' | 'ordem'>): Promise<Lead> {
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
    .update({ arquivado: true, motivo_perda, stage: 'perdido' })
    .eq('id', id)
  if (error) throw error
}

export async function moveLeadStage(id: string, stage: LeadStage, ordem: number): Promise<void> {
  const supabase = createClient()
  const { error } = await supabase
    .from('leads')
    .update({ stage, ordem })
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
