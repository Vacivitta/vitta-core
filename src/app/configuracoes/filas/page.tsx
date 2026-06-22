import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import type { Profile } from '@/types/database'
import FilasConfig from './FilasConfig'

export const metadata = { title: 'Filas de Atendimento — VittaDesk' }

export default async function FilasPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase.from('profiles').select('*').eq('id', user.id).single()
  if (!profile) redirect('/login')
  if (profile.perfil === 'atendente') redirect('/funil')

  const unitId = profile.unit_id ?? ''

  const [{ data: filas }, { data: agentRows }] = await Promise.all([
    supabase
      .from('wa_queues')
      .select('id,nome,cor,ativo,created_at,auto_assign,distribution_method,max_per_agent')
      .eq('unit_id', unitId)
      .order('nome'),
    supabase
      .from('profiles')
      .select('id, full_name, apelido')
      .eq('unit_id', unitId)
      .eq('perfil', 'atendente')
      .order('full_name'),
  ])

  const filaIds = (filas ?? []).map(f => f.id)
  const { data: queueAgentRows } = filaIds.length
    ? await supabase.from('wa_queue_agents').select('queue_id, agent_id').in('queue_id', filaIds)
    : { data: [] }

  const queueAgents: Record<string, string[]> = {}
  for (const row of queueAgentRows ?? []) {
    if (!queueAgents[row.queue_id]) queueAgents[row.queue_id] = []
    queueAgents[row.queue_id].push(row.agent_id)
  }

  return (
    <FilasConfig
      currentUser={profile as Profile}
      initialFilas={filas ?? []}
      initialAgents={(agentRows ?? []) as { id: string; full_name: string; apelido: string | null }[]}
      initialQueueAgents={queueAgents}
    />
  )
}
