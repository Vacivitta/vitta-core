import { createClient } from './supabase/client'
import type { Funnel, FunnelStage, FunnelWithStages } from '@/types/database'

// ---- Funis ----------------------------------------------------------------

export async function listFunnels(): Promise<FunnelWithStages[]> {
  const supabase = createClient()
  const [{ data: funnels }, { data: stages }] = await Promise.all([
    supabase.from('funnels').select('*').order('ordem'),
    supabase.from('funnel_stages').select('*').order('funnel_id').order('ordem'),
  ])
  return (funnels ?? []).map(f => ({
    ...f,
    stages: (stages ?? []).filter(s => s.funnel_id === f.id),
  })) as FunnelWithStages[]
}

export async function createFunnel(nome: string, descricao?: string): Promise<Funnel> {
  const supabase = createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Usuário não autenticado')
  const { data: profile } = await supabase.from('profiles').select('unit_id').eq('id', user.id).single()
  if (!profile?.unit_id) throw new Error('Usuário sem unidade')

  const { data: existing } = await supabase.from('funnels').select('ordem').order('ordem', { ascending: false }).limit(1)
  const nextOrdem = (existing?.[0]?.ordem ?? -1) + 1
  const { data, error } = await supabase
    .from('funnels')
    .insert({ nome, descricao: descricao ?? null, ativo: true, ordem: nextOrdem, unit_id: profile.unit_id })
    .select()
    .single()
  if (error) throw error
  return data
}

export async function updateFunnel(
  id: string,
  updates: Partial<Pick<Funnel, 'nome' | 'descricao' | 'ativo' | 'ordem'>>,
): Promise<void> {
  const supabase = createClient()
  const { error } = await supabase.from('funnels').update(updates).eq('id', id)
  if (error) throw error
}

// Desativa (soft-delete)
export async function deactivateFunnel(id: string): Promise<void> {
  await updateFunnel(id, { ativo: false })
}

// Exclui permanentemente — só permite se não houver leads em nenhuma etapa
export async function deleteFunnel(id: string): Promise<{ ok: boolean; leadCount: number }> {
  const supabase = createClient()

  // Conta leads ativos vinculados ao funil (via etapas)
  const { data: stages } = await supabase
    .from('funnel_stages').select('id').eq('funnel_id', id)

  const stageIds = (stages ?? []).map(s => s.id)
  let leadCount = 0

  if (stageIds.length > 0) {
    const { count } = await supabase
      .from('leads')
      .select('id', { count: 'exact', head: true })
      .in('stage_id', stageIds)
      .eq('arquivado', false)
    leadCount = count ?? 0
  }

  if (leadCount > 0) return { ok: false, leadCount }

  const { error } = await supabase.from('funnels').delete().eq('id', id)
  if (error) throw error
  return { ok: true, leadCount: 0 }
}

// ---- Etapas ---------------------------------------------------------------

export async function createStage(
  funnel_id: string,
  nome: string,
  cor: string,
  afterOrdem: number, // inserir depois desta posição
): Promise<FunnelStage> {
  const supabase = createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Usuário não autenticado')
  const { data: profile } = await supabase.from('profiles').select('unit_id').eq('id', user.id).single()
  if (!profile?.unit_id) throw new Error('Usuário sem unidade')

  // Busca a maior ordem existente no funil
  const { data: existing } = await supabase
    .from('funnel_stages')
    .select('ordem')
    .eq('funnel_id', funnel_id)
    .order('ordem', { ascending: false })
    .limit(1)

  const nextOrdem = (existing?.[0]?.ordem ?? -1) + 1

  const { data, error } = await supabase
    .from('funnel_stages')
    .insert({ funnel_id, nome, cor, ordem: nextOrdem, unit_id: profile.unit_id })
    .select()
    .single()
  if (error) throw error
  return data as FunnelStage
}

export async function updateStage(
  id: string,
  updates: Partial<Pick<FunnelStage, 'nome' | 'cor' | 'ordem' | 'alerta_horas'>>,
): Promise<void> {
  const supabase = createClient()
  const { error } = await supabase.from('funnel_stages').update(updates).eq('id', id)
  if (error) throw error
}

export async function deleteStage(id: string): Promise<void> {
  const supabase = createClient()

  const { count } = await supabase
    .from('leads')
    .select('id', { count: 'exact', head: true })
    .eq('stage_id', id)
    .eq('arquivado', false)

  if (count && count > 0) {
    throw new Error(`Etapa tem ${count} lead${count !== 1 ? 's' : ''} vinculados. Distribua os leads para outras etapas antes de excluir.`)
  }

  const { error } = await supabase.from('funnel_stages').delete().eq('id', id)
  if (error) throw error
}

// Reordena etapas de um funil. Usa dois passos sequenciais para contornar
// o UNIQUE(funnel_id, ordem) sem precisar de uma transação explícita:
//   Passo 1 — move todas para valores temporários altos (10000+N), garantindo
//             que cada UPDATE seja único naquele instante.
//   Passo 2 — define os valores finais 0, 1, 2... (já sem conflito pois os
//             originais foram sobrescritos no passo 1).
export async function reorderStages(orderedIds: string[]): Promise<void> {
  const supabase = createClient()
  const OFFSET = 10000

  // Passo 1: valores temporários
  for (let i = 0; i < orderedIds.length; i++) {
    const { error } = await supabase
      .from('funnel_stages')
      .update({ ordem: OFFSET + i })
      .eq('id', orderedIds[i])
    if (error) throw error
  }

  // Passo 2: valores finais
  for (let i = 0; i < orderedIds.length; i++) {
    const { error } = await supabase
      .from('funnel_stages')
      .update({ ordem: i })
      .eq('id', orderedIds[i])
    if (error) throw error
  }
}

// Conta leads ativos em uma etapa
export async function getLeadCountByStage(stage_id: string): Promise<number> {
  const supabase = createClient()
  const { count, error } = await supabase
    .from('leads')
    .select('id', { count: 'exact', head: true })
    .eq('stage_id', stage_id)
    .eq('arquivado', false)
  if (error) throw error
  return count ?? 0
}

// Retorna mapa stage_id → count para um funil inteiro (uma só query)
export async function getLeadCountsByFunnel(
  funnel_id: string,
): Promise<Record<string, number>> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('leads')
    .select('stage_id')
    .eq('funnel_id', funnel_id)
    .eq('arquivado', false)
  if (error) throw error
  const counts: Record<string, number> = {}
  for (const row of data ?? []) {
    counts[row.stage_id] = (counts[row.stage_id] ?? 0) + 1
  }
  return counts
}
