import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { fetchAll } from '@/lib/supabase/fetch-all'
import { motivoParaAgrupar } from '@/lib/status-lead'
import { contatosNoPeriodo, montarPainelNegocios, type LeadNegocio } from '@/lib/dashboard/negocios'
import { janelaDoPeriodo, lerFiltros } from '@/lib/dashboard/filtros'
import DashboardClient from './DashboardClient'
import type { Profile, ResultadoEtapa, SalesGoal, StatusLead } from '@/types/database'
import { buscarPerfil } from '@/lib/supabase/perfil'

export const metadata = { title: 'Dashboard — VittaDesk' }

// Visibilidade: qualquer perfil vê a unidade inteira, como antes (o RLS de leads é
// por unidade, sem recorte por responsável). O filtro de responsável começa em
// "Todos" para todos os perfis.
export default async function DashboardPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = await searchParams
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await buscarPerfil(supabase, user.id, '*')

  if (!profile) redirect('/login')

  const unitId    = (profile as Profile).unit_id
  const monthYear = new Date().toISOString().slice(0, 7)
  const todayISO  = new Date().toISOString().slice(0, 10)

  await supabase
    .from('quotes')
    .update({ status: 'expirado' })
    .eq('unit_id', unitId)
    .in('status', ['rascunho', 'enviado', 'visualizado', 'em_negociacao'])
    .not('validade_ate', 'is', null)
    .lt('validade_ate', todayISO)

  const [
    { data: leadsRaw },
    { data: quotesRaw },
    { data: stagesRaw },
    { data: tasksRaw },
    { data: convsRaw },
    { data: msgsRaw },
    { data: profilesRaw },
    { data: billingRaw },
    { data: queuesRaw },
    { data: agentStatsRaw },
    { data: salesGoalsRaw },
    { data: stageHistoryRaw },
    { data: aceitosRaw },
  ] = await Promise.all([
    // Consultas que passam de 1000 linhas por unidade usam fetchAll (o Supabase corta em 1000)
    fetchAll((from, to) => supabase
      .from('leads')
      .select('id, funnel_id, stage_id, responsavel_id, status, created_at, ganho_em, perdido_em, origem, motivo_perda, motivo:motivos_perda(nome)')
      // Arquivados (spam, engano, fornecedor...; migração 132) não são negócio: fora de todos os indicadores de leads
      .eq('arquivado', false)
      .eq('unit_id', unitId)
      .order('id')
      .range(from, to)),
    supabase
      .from('quotes')
      .select('id, status, total_calculado, criado_em, aceito_em, responsavel_id, motivo_recusa, validade_ate')
      .eq('unit_id', unitId)
      .order('criado_em', { ascending: false }),
    supabase
      .from('funnel_stages')
      .select('id, nome, cor, ordem, funnel_id, resultado, funnels(id, nome)')
      .eq('unit_id', unitId)
      .order('funnel_id')
      .order('ordem'),
    // As colunas são concluida/data_limite (concluida_em/data_vencimento não existem:
    // a consulta falhava e "Tarefas pendentes" ficava sempre zerado)
    supabase
      .from('lead_tasks')
      .select('id, concluida, data_limite, responsavel_id')
      .eq('unit_id', unitId)
      .eq('concluida', false),
    fetchAll((from, to) => supabase
      .from('wa_conversations')
      .select('id, lead_id, unread_count, last_message_at, last_message_direction, status, assigned_to, queue_id, resolved_at')
      .eq('unit_id', unitId)
      .order('last_message_at', { ascending: false })
      .order('id')
      .range(from, to)),
    fetchAll((from, to) => supabase
      .from('wa_messages')
      .select('id, conversation_id, direction, created_at, sent_by')
      .eq('unit_id', unitId)
      .order('created_at', { ascending: false })
      .order('id')
      .range(from, to), 2000),
    supabase
      .from('profiles')
      .select('id, full_name, apelido, perfil')
      .eq('unit_id', unitId),
    fetchAll((from, to) => supabase
      .from('wa_message_costs')
      .select('category, cost_usd, billable')
      .eq('unit_id', unitId)
      .eq('month_year', monthYear)
      .order('id')
      .range(from, to)),
    supabase
      .from('wa_queues')
      .select('id, nome, cor')
      .eq('unit_id', unitId)
      .eq('ativo', true)
      .order('nome'),
    supabase.rpc('get_agent_stats', { p_unit_id: unitId }),
    supabase
      .from('sales_goals')
      .select('id, unit_id, user_id, month, target, created_at')
      .eq('unit_id', unitId)
      .is('user_id', null)
      .order('month', { ascending: false }),
    fetchAll((from, to) => supabase
      .from('lead_stage_history')
      .select('id, lead_id, de_stage_id, para_stage_id, criado_em, movido_via, lead:leads!inner(unit_id)')
      .eq('lead.unit_id', unitId)
      .order('criado_em')
      .order('id')
      .range(from, to)),
    // Todos os aceitos (a consulta de quotes acima corta em 1000) para o valor ganho
    fetchAll((from, to) => supabase
      .from('quotes')
      .select('id, lead_id, status, total_calculado, criado_em, aceito_em')
      .eq('unit_id', unitId)
      .eq('status', 'aceito')
      .order('id')
      .range(from, to)),
  ])

  const stages = (stagesRaw ?? []).map(s => ({
    id: s.id as string,
    nome: s.nome as string,
    cor: s.cor as string,
    ordem: s.ordem as number,
    funnel_id: s.funnel_id as string,
    resultado: (s.resultado ?? null) as ResultadoEtapa | null,
    funnel: (Array.isArray(s.funnels) ? (s.funnels[0] ?? null) : s.funnels) as { id: string; nome: string } | null,
  }))
  const funis = [...new Map(stages.filter(s => s.funnel).map(s => [s.funnel!.id, s.funnel!])).values()]
  const profiles = profilesRaw ?? []

  const filtros = lerFiltros(params, { funis: funis.map(f => f.id), responsaveis: profiles.map(p => p.id as string) })
  const janela = janelaDoPeriodo(filtros.periodo, new Date())

  const leads = (leadsRaw ?? []).map(l => {
    const motivo = Array.isArray(l.motivo) ? (l.motivo[0] ?? null) : l.motivo
    return {
      id:             l.id as string,
      funnel_id:      l.funnel_id as string | null,
      stage_id:       l.stage_id as string | null,
      responsavel_id: l.responsavel_id as string | null,
      status:         l.status as StatusLead,
      created_at:     l.created_at as string,
      ganho_em:       l.ganho_em as string | null,
      perdido_em:     l.perdido_em as string | null,
      origem:         l.origem as string | null,
      motivo:         l.status === 'perdido'
        ? motivoParaAgrupar((motivo?.nome ?? null) as string | null, l.motivo_perda as string | null)
        : null,
    }
  })
  const leadsFiltrados: LeadNegocio[] = leads.filter(l =>
    (!filtros.funilId || l.funnel_id === filtros.funilId) &&
    (!filtros.responsavelId || l.responsavel_id === filtros.responsavelId))

  const negocios = montarPainelNegocios({
    leads:      leadsFiltrados,
    movimentos: (stageHistoryRaw ?? []).map(h => ({
      lead_id:       h.lead_id as string,
      de_stage_id:   h.de_stage_id as string | null,
      para_stage_id: h.para_stage_id as string | null,
      criado_em:     h.criado_em as string,
      movido_via:    h.movido_via as string | null,
    })),
    etapas:     stages,
    funis:      filtros.funilId ? funis.filter(f => f.id === filtros.funilId) : funis,
    orcamentos: (aceitosRaw ?? []).map(q => ({
      lead_id:         q.lead_id as string | null,
      status:          q.status as string,
      total_calculado: q.total_calculado as number | null,
      criado_em:       q.criado_em as string,
      aceito_em:       q.aceito_em as string | null,
    })),
    janela,
  })

  return (
    <DashboardClient
      currentUser={profile as Profile}
      filtros={filtros}
      desdeISO={janela.desde?.toISOString() ?? null}
      funis={funis}
      negocios={negocios}
      contatos={contatosNoPeriodo(leads, janela)}
      quotes={quotesRaw ?? []}
      tasks={tasksRaw ?? []}
      conversations={convsRaw ?? []}
      messages={msgsRaw ?? []}
      profiles={profiles}
      billing={billingRaw ?? []}
      queues={queuesRaw ?? []}
      agentStats={agentStatsRaw ?? []}
      todayISO={todayISO}
      salesGoals={(salesGoalsRaw ?? []) as SalesGoal[]}
    />
  )
}
