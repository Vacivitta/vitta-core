import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { fetchAll } from '@/lib/supabase/fetch-all'
import { cookies } from 'next/headers'
import FunilClient from './FunilClient'
import {
  montarResumoConversas, montarTagsDosLeads, SELECT_CONVERSAS_FUNIL, SELECT_TAGS_DOS_LEADS,
  type ConversaFunil, type TagDoLeadFunil,
} from '@/lib/funil/resumo-conversas'
import { KANBAN_SORT_OPTIONS, COOKIE_ORDENACAO_FUNIL, type KanbanSortMode } from '@/components/kanban/sort'
import { linkDoLead } from '@/lib/funil/link-lead'
import type { CampoLead, Profile, FunnelWithStages, LeadKanban } from '@/types/database'

export default async function FunilPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const supabase = await createClient()
  const link = linkDoLead(await searchParams)

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
    { data: tagsDosLeads },
    { count: totalArquivados },
    { data: camposLead },
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
    fetchAll((from, to) => supabase.from('lead_tags').select(SELECT_TAGS_DOS_LEADS)
      .eq('unit_id', unitId).order('lead_id').order('tag_id').range(from, to)),
    // Contador do botão Arquivados (o painel carrega a lista quando abre)
    supabase.from('leads').select('id', { count: 'exact', head: true }).eq('unit_id', unitId).eq('arquivado', true),
    // Filtro do funil por campo personalizado
    supabase.from('campos_lead').select('*').eq('unit_id', unitId).eq('ativo', true).order('ordem').order('rotulo'),
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

  // Link /funil?lead=<id> (notificações): o lead está no quadro ou, se arquivado,
  // em leads_arquivados. De outra unidade ou inexistente: abre o funil sem ficha.
  let leadDoLink: LeadKanban | null = null
  if (link) {
    leadDoLink = (leadsData ?? []).find(l => l.id === link.leadId) as LeadKanban | undefined ?? null
    if (!leadDoLink) {
      const { data } = await supabase.from('leads_arquivados').select('*')
        .eq('id', link.leadId).eq('unit_id', unitId).maybeSingle()
      leadDoLink = (data as LeadKanban | null) ?? null
    }
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
      tagsDosLeadsIniciais={montarTagsDosLeads((tagsDosLeads ?? []) as TagDoLeadFunil[])}
      ordenacaoInicial={ordenacaoInicial}
      totalArquivadosInicial={totalArquivados ?? 0}
      camposLead={(camposLead ?? []) as CampoLead[]}
      leadDoLink={leadDoLink ? { lead: leadDoLink, aba: link?.aba ?? null } : null}
      // Instante desta requisição: servidor e navegador partem do mesmo "agora"
      // eslint-disable-next-line react-hooks/purity -- server component roda uma vez por requisição
      agoraServidor={Date.now()}
    />
  )
}
