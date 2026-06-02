import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import ClientesClient from './ClientesClient'

export default async function ClientesPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const [{ data: clients }, { data: profiles }, { data: units }] = await Promise.all([
    supabase
      .from('clients')
      .select('*, lead:leads(id,nome,sobrenome,funnel_id,stage_id)')
      .order('criado_em', { ascending: false }),
    supabase.from('profiles').select('id, full_name').order('full_name'),
    supabase.from('units').select('id, nome').eq('ativo', true),
  ])

  return (
    <ClientesClient
      initialClients={clients ?? []}
      profiles={profiles ?? []}
      units={units ?? []}
    />
  )
}
