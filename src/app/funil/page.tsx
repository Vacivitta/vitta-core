import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { fetchAll } from '@/lib/supabase/fetch-all'
import { cookies } from 'next/headers'
import FunilClient from './FunilClient'
import { montarResumoConversas, SELECT_CONVERSAS_FUNIL, type ConversaFunil } from '@/lib/funil/resumo-conversas'
import { KANBAN_SORT_OPTIONS, COOKIE_ORDENACAO_FUNIL, type KanbanSortMode } from '@/components/kanban/sort'
import type { Profile, FunnelWithStages } from '@/types/database'

export default async function FunilPage() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profileData } = await supabase
    .from('profiles').select('*').eq('id', user.id).single()

  const unitId = (profileData as Profile)?.unit_id

  const [
    { data: profilesData },
    { data: funnelsData },
    { data: stagesData },
    { data: leadsData },
    { data: userUnits },
    { data: automacoes },
    { data: conversas },
    cookieStore,
  ] = await Promise.all([
    supabase.from('profiles').select('*').eq('unit_id', unitId).order('full_name'),
    supabase.from('funnels').select('*').eq('ativo', true).eq('unit_id', unitId).order('ordem'),
    supabase.from('funnel_stages').select('*').eq('unit_id', unitId).order('funnel_id').order('ordem'),
    fetchAll((from, to) => supabase.from('leads_kanban').select('*').eq('unit_id', unitId)
      .order('stage_ordem').order('ordem').order('created_at').order('id').range(from, to)),
    supabase.from('user_units').select('user_id').eq('unit_id', unitId).eq('ativo', true),
    supabase.from('wa_automations').select('trigger, stage_id')
      .eq('unit_id', unitId).eq('action', 'move_stage').eq('ativo', true),
    fetchAll((from, to) => supabase.from('wa_conversations').select(SELECT_CONVERSAS_FUNIL)
      .eq('unit_id', unitId).not('lead_id', 'is', null).order('id').range(from, to)),
    cookies(),
  ])

  // Primeira tela já com os dados das conversas e a ordenação escolhida pelo usuário
  const resumoInicial = montarResumoConversas((conversas ?? []) as ConversaFunil[])
  const ordemSalva = cookieStore.get(COOKIE_ORDENACAO_FUNIL)?.value
  const ordenacaoInicial = KANBAN_SORT_OPTIONS.some(o => o.value === ordemSalva) ? ordemSalva as KanbanSortMode : null

  // Etapas de atendimento (destinos das automações de mensagem): nelas o alerta do
  // card conta o tempo do cliente sem resposta, e não o tempo parado na etapa
  const etapasAtendimento = (automacoes ?? [])
    .filter(a => a.stage_id && (a.trigger === 'inbound_message' || a.trigger === 'outbound_message'))
    .map(a => a.stage_id as string)

  const extraUserIds = (userUnits ?? [])
    .map(r => r.user_id as string)
    .filter(id => !(profilesData ?? []).some(p => p.id === id))

  let allProfiles = profilesData ?? []
  if (extraUserIds.length > 0) {
    const { data: extra } = await supabase
      .from('profiles').select('*').in('id', extraUserIds).order('full_name')
    if (extra) allProfiles = [...allProfiles, ...extra]
  }

  const funnelsWithStages: FunnelWithStages[] = (funnelsData ?? []).map(f => ({
    ...f,
    stages: (stagesData ?? []).filter(s => s.funnel_id === f.id),
  }))

  return (
    <FunilClient
      initialLeads={leadsData ?? []}
      funnels={funnelsWithStages}
      profiles={allProfiles as Profile[]}
      currentUser={profileData as Profile}
      etapasAtendimento={etapasAtendimento}
      resumoInicial={resumoInicial}
      ordenacaoInicial={ordenacaoInicial}
      // Instante desta requisição: servidor e navegador partem do mesmo "agora"
      // eslint-disable-next-line react-hooks/purity -- server component roda uma vez por requisição
      agoraServidor={Date.now()}
    />
  )
}
