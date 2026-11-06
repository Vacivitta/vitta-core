import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import TemplatesClient from './TemplatesClient'
import type { Profile, QuoteTemplate } from '@/types/database'
import { buscarPerfil } from '@/lib/supabase/perfil'

export const metadata = { title: 'Templates de Orçamento — VittaDesk' }

export default async function TemplatesPage() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profileData } = await buscarPerfil(supabase, user.id, '*')

  if (!profileData) redirect('/login')
  if (profileData.perfil === 'atendente') redirect('/funil')

  const unitId = (profileData as Profile).unit_id

  const { data: templatesData } = await supabase
    .from('quote_templates')
    .select('*')
    .eq('unit_id', unitId)
    .order('nome')

  return (
    <TemplatesClient
      currentUser={profileData as Profile}
      initialTemplates={(templatesData ?? []) as QuoteTemplate[]}
    />
  )
}
