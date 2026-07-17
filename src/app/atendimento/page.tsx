import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import AtendimentoClient from './AtendimentoClient'
import type { Profile, FunnelWithStages } from '@/types/database'

export const metadata = { title: 'Atendimento — VittaDesk' }

export default async function AtendimentoPage({
  searchParams,
}: {
  searchParams: Promise<{ numero?: string }>
}) {
  const supabase = await createClient()
  const { numero } = await searchParams

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profileData } = await supabase
    .from('profiles').select('*').eq('id', user.id).single()

  const unitId = (profileData as Profile)?.unit_id

  const [
    { data: profilesData },
    { data: funnelsData },
    { data: stagesData },
  ] = await Promise.all([
    supabase.from('profiles').select('*').eq('unit_id', unitId).order('full_name'),
    supabase.from('funnels').select('*').eq('ativo', true).eq('unit_id', unitId).order('ordem'),
    supabase.from('funnel_stages').select('*').eq('unit_id', unitId).order('funnel_id').order('ordem'),
  ])

  const funnelsWithStages: FunnelWithStages[] = (funnelsData ?? []).map(f => ({
    ...f,
    stages: (stagesData ?? []).filter(s => s.funnel_id === f.id),
  }))

  return (
    <AtendimentoClient
      funnels={funnelsWithStages}
      profiles={(profilesData ?? []) as Profile[]}
      currentUser={profileData as Profile}
      initialNumero={numero ?? null}
    />
  )
}
