import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import TagsConfigClient from './TagsConfigClient'
import type { WaTag } from '@/types/database'

export const metadata = { title: 'Tags de Conversa — VittaDesk' }

export default async function TagsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase.from('profiles').select('*').eq('id', user.id).single()
  if (!profile) redirect('/login')

  const { data: tags } = await supabase
    .from('wa_tags')
    .select('*')
    .order('name')

  return <TagsConfigClient initialTags={(tags ?? []) as WaTag[]} />
}
