import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import AutomacoesClient from './AutomacoesClient'
import type { AutomationRun, AutomationRunComLead, Profile } from '@/types/database'
import { buscarPerfil } from '@/lib/supabase/perfil'

const COLUNAS_EXECUCAO = 'id, unit_id, origem, automation_id, gatilho, acao, lead_id, conversation_id, resultado, motivo, detalhe, criado_em, leads(nome, sobrenome)'

type LinhaExecucao = AutomationRun & {
  leads: { nome: string | null; sobrenome: string | null } | { nome: string | null; sobrenome: string | null }[] | null
}

function paraExecucao({ leads, ...run }: LinhaExecucao): AutomationRunComLead {
  const lead = Array.isArray(leads) ? (leads[0] ?? null) : leads
  const nome = lead ? [lead.nome, lead.sobrenome].filter(Boolean).join(' ') : ''
  return { ...run, lead_nome: nome || null }
}

export const metadata = { title: 'Automações — VittaDesk' }

export default async function AutomacoesPage() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await buscarPerfil(supabase, user.id, '*')

  if (!profile) redirect('/login')
  if (profile.perfil === 'atendente') redirect('/funil')

  const unitId = profile.unit_id ?? ''

  const [
    { data: stages },
    { data: quoteAutomations },
    { data: waAutomations },
    { data: templates },
    { data: timedAutomations },
    { data: funnels },
    { data: execucoes },
    { data: falhas },
  ] = await Promise.all([
    supabase
      .from('funnel_stages')
      .select('id, nome, cor, funnel_id, funnels(nome)')
      .order('ordem'),
    supabase
      .from('quote_automations')
      .select('*')
      .eq('unit_id', unitId),
    supabase
      .from('wa_automations')
      .select('*')
      .eq('unit_id', unitId),
    supabase
      .from('wa_message_templates')
      .select('id, name, template_name, content, category')
      .eq('unit_id', unitId)
      .eq('ativo', true)
      .order('name'),
    supabase
      .from('wa_timed_automations')
      .select('*')
      .eq('unit_id', unitId)
      .order('created_at'),
    supabase
      .from('funnels')
      .select('id, nome')
      .eq('objeto', 'negocio')
      .order('nome'),
    supabase
      .from('automation_runs')
      .select(COLUNAS_EXECUCAO)
      .eq('unit_id', unitId)
      .order('criado_em', { ascending: false })
      .limit(100)
      .returns<LinhaExecucao[]>(),
    supabase
      .from('automation_runs')
      .select(COLUNAS_EXECUCAO)
      .eq('unit_id', unitId)
      .eq('resultado', 'falhou')
      .order('criado_em', { ascending: false })
      .limit(100)
      .returns<LinhaExecucao[]>(),
  ])

  const normalizedStages = (stages ?? []).map(s => ({
    ...s,
    funnels: Array.isArray(s.funnels) ? (s.funnels[0] ?? null) : s.funnels,
  }))

  return (
    <AutomacoesClient
      currentUser={profile as Profile}
      stages={normalizedStages}
      initialQuoteAutomations={quoteAutomations ?? []}
      initialWaAutomations={waAutomations ?? []}
      templates={templates ?? []}
      initialTimedAutomations={timedAutomations ?? []}
      funnels={(funnels ?? []) as { id: string; nome: string }[]}
      execucoes={(execucoes ?? []).map(paraExecucao)}
      falhas={(falhas ?? []).map(paraExecucao)}
    />
  )
}
