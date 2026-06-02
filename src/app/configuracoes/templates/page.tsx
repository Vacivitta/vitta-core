import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import TemplatesClient from './TemplatesClient'
import type { Profile, QuoteTemplate } from '@/types/database'

export const metadata = { title: 'Templates de Orçamento — Vitta Core' }

export default async function TemplatesPage() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profileData } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single()

  if (!profileData) redirect('/login')
  if (profileData.perfil === 'atendente') redirect('/funil')

  const { data: templatesData } = await supabase
    .from('quote_templates')
    .select('*')
    .order('nome')

  return (
    <TemplatesClient
      currentUser={profileData as Profile}
      initialTemplates={(templatesData ?? []) as QuoteTemplate[]}
    />
  )
}
