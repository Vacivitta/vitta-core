import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { fetchAll } from '@/lib/supabase/fetch-all'
import FunisConfig from './FunisConfig'
import type { CampoLead, FunnelWithStages } from '@/types/database'
import { buscarPerfil } from '@/lib/supabase/perfil'

export const metadata = { title: 'Configurar Funis — VittaDesk' }

export default async function ConfigFunisPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profileData } = await buscarPerfil(supabase, user.id, 'unit_id, perfil')
  if (!profileData) redirect('/login')
  // Funis, etapas e motivos de perda: só gestor e admin (o RLS da 126 também barra)
  if (profileData.perfil === 'atendente') redirect('/funil')

  const unitId = profileData.unit_id

  const [{ data: funnels }, { data: stages }, { data: leadCounts }, { data: campos }] = await Promise.all([
    supabase.from('funnels').select('*').eq('unit_id', unitId).order('ordem'),
    supabase.from('funnel_stages').select('*').eq('unit_id', unitId).order('funnel_id').order('ordem'),
    // Paginado: o Supabase corta em 1000 linhas e a contagem por etapa ficava menor
    fetchAll((from, to) => supabase
      .from('leads')
      .select('stage_id, status, arquivado')
      .eq('unit_id', unitId)
      .order('id')
      .range(from, to)),
    // Inclui os desativados: uma etapa pode ainda exigir um deles e o gestor precisa poder tirar
    supabase.from('campos_lead').select('*').eq('unit_id', unitId),
  ])

  // Exibição: leads não perdidos e não arquivados por etapa. Proteção da exclusão:
  // todos, inclusive arquivados e perdidos da etapa de perda (a FK leads.stage_id
  // é ON DELETE SET NULL).
  const countsByStage: Record<string, number> = {}
  const totalByStage: Record<string, number> = {}
  for (const row of leadCounts ?? []) {
    if (!row.stage_id) continue
    totalByStage[row.stage_id] = (totalByStage[row.stage_id] ?? 0) + 1
    if (row.status !== 'perdido' && !row.arquivado) countsByStage[row.stage_id] = (countsByStage[row.stage_id] ?? 0) + 1
  }

  const funnelsWithStages: FunnelWithStages[] = (funnels ?? []).map(f => ({
    ...f,
    stages: (stages ?? []).filter(s => s.funnel_id === f.id),
  }))

  return (
    <FunisConfig
      initialFunnels={funnelsWithStages}
      initialLeadCounts={countsByStage}
      totalPorEtapa={totalByStage}
      camposLead={(campos ?? []) as CampoLead[]}
    />
  )
}
