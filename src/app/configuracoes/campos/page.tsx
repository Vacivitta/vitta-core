import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import CamposClient from './CamposClient'
import type { CampoLead, Funnel } from '@/types/database'

export const metadata = { title: 'Campos do lead — VittaDesk' }

export default async function ConfigCamposPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profileData } = await supabase
    .from('profiles').select('unit_id, perfil').eq('id', user.id).single()
  if (!profileData) redirect('/login')
  // Configurar campos: só gestor e admin (o RLS da 129 também barra)
  if (profileData.perfil === 'atendente') redirect('/funil')

  const unitId = profileData.unit_id as string | null
  if (!unitId) redirect('/funil')

  const [{ data: campos }, { data: funis }] = await Promise.all([
    supabase.from('campos_lead').select('*').eq('unit_id', unitId).order('ordem').order('rotulo'),
    supabase.from('funnels').select('id, nome').eq('unit_id', unitId).order('ordem'),
  ])

  return (
    <CamposClient
      unitId={unitId}
      initialCampos={(campos ?? []) as CampoLead[]}
      funis={(funis ?? []) as Pick<Funnel, 'id' | 'nome'>[]}
    />
  )
}
