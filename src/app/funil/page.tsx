import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import FunilClient from './FunilClient'
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
  ] = await Promise.all([
    supabase.from('profiles').select('*').order('full_name'),
    supabase.from('funnels').select('*').eq('ativo', true).eq('unit_id', unitId).order('ordem'),
    supabase.from('funnel_stages').select('*').eq('unit_id', unitId).order('funnel_id').order('ordem'),
    supabase.from('leads_kanban').select('*').eq('unit_id', unitId).order('stage_ordem').order('ordem').order('created_at'),
  ])

  const funnelsWithStages: FunnelWithStages[] = (funnelsData ?? []).map(f => ({
    ...f,
    stages: (stagesData ?? []).filter(s => s.funnel_id === f.id),
  }))

  return (
    <FunilClient
      initialLeads={leadsData ?? []}
      funnels={funnelsWithStages}
      profiles={(profilesData ?? []) as Profile[]}
      currentUser={profileData as Profile}
    />
  )
}
