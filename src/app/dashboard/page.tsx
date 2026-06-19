import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import DashboardClient from './DashboardClient'
import type { Profile } from '@/types/database'

export const metadata = { title: 'Dashboard — Vitta Core' }

export default async function DashboardPage() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles').select('*').eq('id', user.id).single()

  if (!profile) redirect('/login')
  if (profile.perfil === 'atendente') redirect('/funil')

  const [
    { data: leadsRaw },
    { data: quotesRaw },
    { data: stagesRaw },
  ] = await Promise.all([
    supabase
      .from('leads')
      .select('id, stage_id, created_at')
      .eq('arquivado', false),
    supabase
      .from('quotes')
      .select('id, status, total_calculado, criado_em, aceito_em')
      .order('criado_em', { ascending: false }),
    supabase
      .from('funnel_stages')
      .select('id, nome, cor, ordem, funnel_id, funnels(id, nome)')
      .order('funnel_id')
      .order('ordem'),
  ])

  return (
    <DashboardClient
      currentUser={profile as Profile}
      leads={leadsRaw ?? []}
      quotes={quotesRaw ?? []}
      stages={(stagesRaw ?? []).map(s => ({
        ...s,
        funnel: Array.isArray(s.funnels) ? (s.funnels[0] ?? null) : s.funnels,
      }))}
    />
  )
}
