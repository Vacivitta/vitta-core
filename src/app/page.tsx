import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { buscarPerfil } from '@/lib/supabase/perfil'
import { entradaAposLogin } from '@/lib/unidade-ativa'

export default async function RootPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const [{ data: vinculos }, { data: perfil }] = await Promise.all([
    supabase.from('user_units').select('unit_id').eq('user_id', user.id),
    buscarPerfil(supabase, user.id, 'unit_id'),
  ])
  redirect(entradaAposLogin((vinculos ?? []).map(v => v.unit_id as string), perfil?.unit_id ?? null).destino)
}
