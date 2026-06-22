import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import AutomacoesClient from './AutomacoesClient'
import type { Profile } from '@/types/database'

export const metadata = { title: 'Automações — VittaDesk' }

export default async function AutomacoesPage() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles').select('*').eq('id', user.id).single()

  if (!profile) redirect('/login')
  if (profile.perfil === 'atendente') redirect('/funil')

  const unitId = profile.unit_id ?? ''

  const [
    { data: stages },
    { data: quoteAutomations },
    { data: waAutomations },
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
    />
  )
}
