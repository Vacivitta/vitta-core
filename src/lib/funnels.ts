import { createClient } from './supabase/client'
import type { Funnel, FunnelStage, FunnelWithStages, MotivoPerda } from '@/types/database'
import { mensagemRecusaPorReferencia, mensagemUsadaPorAutomacao } from './funil/exclusao'

// Automações por tempo que usam o funil ou alguma das etapas como filtro (o banco
// recusa a exclusão: FKs ON DELETE RESTRICT, migração 135)
async function automacoesQueFiltram(funnelId: string | null, stageIds: string[]): Promise<string[]> {
  const condicoes = [
    ...(funnelId ? [`filter_funnel_id.eq.${funnelId}`] : []),
    ...(stageIds.length > 0 ? [`filter_stage_id.in.(${stageIds.join(',')})`] : []),
  ]
  if (condicoes.length === 0) return []
  const { data, error } = await createClient()
    .from('wa_timed_automations').select('nome').or(condicoes.join(','))
  if (error) throw error
  return (data ?? []).map(a => String(a.nome ?? ''))
}

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

// Exclui permanentemente — só se o funil não tem nenhum lead, nem perdido ou
// arquivado, e se nenhuma automação por tempo o usa como filtro. O banco também
// recusa (FKs ON DELETE RESTRICT, migração 135); conferir antes dá a mensagem certa. As etapas vão em cascata e os campos
// personalizados do funil ficam na unidade, desativados.
export async function deleteFunnel(id: string): Promise<{ ok: boolean; leadCount: number }> {
  const supabase = createClient()

  const { data: stages, error: stagesErr } = await supabase
    .from('funnel_stages').select('id').eq('funnel_id', id)
  if (stagesErr) throw stagesErr

  const stageIds = (stages ?? []).map(s => s.id)
  const { count, error: countErr } = await supabase
    .from('leads')
    .select('id', { count: 'exact', head: true })
    .or(stageIds.length > 0 ? `funnel_id.eq.${id},stage_id.in.(${stageIds.join(',')})` : `funnel_id.eq.${id}`)
  if (countErr) throw countErr
  const leadCount = count ?? 0

  if (leadCount > 0) return { ok: false, leadCount }

  const usada = mensagemUsadaPorAutomacao('funil', await automacoesQueFiltram(id, stageIds))
  if (usada) throw new Error(usada)

  const { error } = await supabase.from('funnels').delete().eq('id', id)
  if (error) throw new Error(mensagemRecusaPorReferencia('funil', error) ?? error.message)
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
  updates: Partial<Pick<FunnelStage, 'nome' | 'cor' | 'ordem' | 'alerta_horas' | 'sla_mensal' | 'resultado' | 'campos_obrigatorios'>>,
): Promise<void> {
  const supabase = createClient()
  const { error } = await supabase.from('funnel_stages').update(updates).eq('id', id)
  if (error) throw error
}

// Só exclui etapa sem nenhum lead, inclusive perdido (a coluna de perda guarda os
// perdidos) e que nenhuma automação por tempo usa como filtro. O banco também recusa (leads.stage_id ON DELETE RESTRICT, migração
// 135); o histórico de quem passou pela etapa fica, sem o destino.
export async function deleteStage(id: string): Promise<void> {
  const supabase = createClient()

  const count = await getLeadCountByStage(id)
  if (count > 0) {
    throw new Error(`Etapa tem ${count} lead${count !== 1 ? 's' : ''} (inclusive perdidos). Distribua os leads para outras etapas antes de excluir.`)
  }

  const usada = mensagemUsadaPorAutomacao('etapa', await automacoesQueFiltram(null, [id]))
  if (usada) throw new Error(usada)

  const { error } = await supabase.from('funnel_stages').delete().eq('id', id)
  if (error) throw new Error(mensagemRecusaPorReferencia('etapa', error) ?? error.message)
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

// Conta todos os leads de uma etapa, inclusive perdidos (protege a exclusão)
export async function getLeadCountByStage(stage_id: string): Promise<number> {
  const supabase = createClient()
  const { count, error } = await supabase
    .from('leads')
    .select('id', { count: 'exact', head: true })
    .eq('stage_id', stage_id)
  if (error) throw error
  return count ?? 0
}

// Retorna mapa stage_id → count (todos os leads, inclusive perdidos) para um funil inteiro
export async function getLeadCountsByFunnel(
  funnel_id: string,
): Promise<Record<string, number>> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('leads')
    .select('stage_id')
    .eq('funnel_id', funnel_id)
  if (error) throw error
  const counts: Record<string, number> = {}
  for (const row of data ?? []) {
    counts[row.stage_id] = (counts[row.stage_id] ?? 0) + 1
  }
  return counts
}

// Sem exclusão pela tela: desativar tira o motivo da lista sem mexer nos leads que o usam.

export async function createMotivoPerda(funnel_id: string, nome: string, ordem: number): Promise<MotivoPerda> {
  const supabase = createClient()
  // unit_id vem do funil (trigger fn_motivo_perda_unidade)
  const { data, error } = await supabase
    .from('motivos_perda')
    .insert({ funnel_id, nome, ordem })
    .select()
    .single()
  if (error) throw error
  return data as MotivoPerda
}

export async function updateMotivoPerda(
  id: string,
  updates: Partial<Pick<MotivoPerda, 'nome' | 'ativo' | 'ordem'>>,
): Promise<void> {
  const supabase = createClient()
  const { error } = await supabase.from('motivos_perda').update(updates).eq('id', id)
  if (error) throw error
}

export async function reorderMotivosPerda(orderedIds: string[]): Promise<void> {
  const supabase = createClient()
  for (let i = 0; i < orderedIds.length; i++) {
    const { error } = await supabase.from('motivos_perda').update({ ordem: i + 1 }).eq('id', orderedIds[i])
    if (error) throw error
  }
}
