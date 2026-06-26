import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import ClientesClient from './ClientesClient'

export default async function ClientesPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const [
    { data: leads, error: leadsError },
    { data: profiles },
    { data: units },
    { data: funnels },
  ] = await Promise.all([
    supabase
      .from('leads')
      .select('*')
      .eq('is_converted', true)
      .eq('arquivado', false)
      .order('created_at', { ascending: false }),
    supabase.from('profiles').select('id, full_name').order('full_name'),
    supabase.from('units').select('id, nome').eq('ativo', true),
    supabase
      .from('funnels')
      .select('id, stages:funnel_stages(id)')
      .eq('ativo', true)
      .order('ordem')
      .limit(1),
  ])

  const defaultFunnelId = (funnels as ({ id: string; stages: { id: string }[] }[] | null))?.[0]?.id ?? null
  const defaultStageId  = (funnels as ({ id: string; stages: { id: string }[] }[] | null))?.[0]?.stages?.[0]?.id ?? null

  return (
    <ClientesClient
      initialClients={leads ?? []}
      initialError={leadsError?.message ?? null}
      profiles={profiles ?? []}
      units={units ?? []}
      defaultFunnelId={defaultFunnelId}
      defaultStageId={defaultStageId}
    />
  )
}
