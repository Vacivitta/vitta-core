import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import OrcamentosClient from './OrcamentosClient'
import type { Profile, Product, QuoteTemplate } from '@/types/database'
import type { QuoteRow, PatientOption } from './OrcamentosClient'

export const metadata = { title: 'Orçamentos — Vitta Core' }

export default async function OrcamentosPage({
  searchParams,
}: {
  searchParams: Promise<{ lead_id?: string; client_id?: string; quote_id?: string }>
}) {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profileData } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single()

  if (!profileData) redirect('/login')

  const params = await searchParams
  const initialLeadId   = params.lead_id   ?? null
  const initialClientId = params.client_id ?? null
  const initialQuoteId  = params.quote_id  ?? null

  const [
    { data: quotesData },
    { data: productsData },
    { data: templatesData },
    { data: leadsData },
    { data: clientsData },
  ] = await Promise.all([
    supabase
      .from('quotes')
      .select('*, lead:leads(nome,sobrenome,telefone), client:clients(nome,sobrenome,telefone), template:quote_templates(*)')
      .order('criado_em', { ascending: false }),
    supabase.from('products').select('*').eq('ativo', true).order('nome'),
    supabase.from('quote_templates').select('*').eq('ativo', true).order('nome'),
    supabase.from('leads').select('id,nome,sobrenome,telefone').eq('arquivado', false).order('nome'),
    supabase.from('clients').select('id,nome,sobrenome,telefone').order('nome'),
  ])

  return (
    <OrcamentosClient
      currentUser={profileData as Profile}
      initialQuotes={(quotesData ?? []) as QuoteRow[]}
      products={(productsData ?? []) as Product[]}
      templates={(templatesData ?? []) as QuoteTemplate[]}
      leads={(leadsData ?? []) as PatientOption[]}
      clients={(clientsData ?? []) as PatientOption[]}
      initialLeadId={initialLeadId}
      initialClientId={initialClientId}
      initialQuoteId={initialQuoteId}
    />
  )
}
