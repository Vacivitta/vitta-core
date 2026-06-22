import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import FunisConfig from './FunisConfig'
import type { FunnelWithStages } from '@/types/database'

export const metadata = { title: 'Configurar Funis — VittaDesk' }

export default async function ConfigFunisPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const [{ data: funnels }, { data: stages }, { data: leadCounts }] = await Promise.all([
    supabase.from('funnels').select('*').order('ordem'),
    supabase.from('funnel_stages').select('*').order('funnel_id').order('ordem'),
    supabase
      .from('leads')
      .select('stage_id')
      .eq('arquivado', false),
  ])

  const countsByStage: Record<string, number> = {}
  for (const row of leadCounts ?? []) {
    countsByStage[row.stage_id] = (countsByStage[row.stage_id] ?? 0) + 1
  }

  const funnelsWithStages: FunnelWithStages[] = (funnels ?? []).map(f => ({
    ...f,
    stages: (stages ?? []).filter(s => s.funnel_id === f.id),
  }))

  return <FunisConfig initialFunnels={funnelsWithStages} initialLeadCounts={countsByStage} />
}
