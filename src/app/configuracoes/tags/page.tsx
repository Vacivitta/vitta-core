import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import TagsConfigClient from './TagsConfigClient'
import type { WaTag } from '@/types/database'
import { buscarPerfil } from '@/lib/supabase/perfil'

export const metadata = { title: 'Tags — VittaDesk' }

export default async function TagsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await buscarPerfil(supabase, user.id, '*')
  if (!profile) redirect('/login')

  const unitId = profile.unit_id

  const { data: tags } = await supabase
    .from('wa_tags')
    .select('*')
    .eq('unit_id', unitId)
    .order('name')

  return <TagsConfigClient initialTags={(tags ?? []) as WaTag[]} />
}
