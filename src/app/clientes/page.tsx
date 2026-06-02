import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import ClientesClient from './ClientesClient'

export default async function ClientesPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const [{ data: clients, error: clientsError }, { data: profiles }, { data: units }] = await Promise.all([
    supabase
      .from('clients')
      // !lead_id: hint explícito para resolver join bidirecional (clients↔leads)
      .select('*, lead:leads!lead_id(id, nome, sobrenome)')
      .order('criado_em', { ascending: false }),
    supabase.from('profiles').select('id, full_name').order('full_name'),
    supabase.from('units').select('id, nome').eq('ativo', true),
  ])

  if (clientsError) console.error('[ClientesPage] erro ao buscar clientes:', clientsError)

  return (
    <ClientesClient
      initialClients={clients ?? []}
      profiles={profiles ?? []}
      units={units ?? []}
    />
  )
}
