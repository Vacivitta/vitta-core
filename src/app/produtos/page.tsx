import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import ProdutosClient from './ProdutosClient'
import type { Profile, Product } from '@/types/database'
import { buscarPerfil } from '@/lib/supabase/perfil'

export const metadata = { title: 'Catálogo de Vacinas — VittaDesk' }

export default async function ProdutosPage() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profileData } = await buscarPerfil(supabase, user.id, '*')

  if (!profileData) redirect('/login')

  const { data: productsData } = await supabase
    .from('products')
    .select('*')
    .eq('unit_id', profileData.unit_id)
    .order('nome')

  return (
    <ProdutosClient
      currentUser={profileData as Profile}
      initialProducts={(productsData ?? []) as Product[]}
    />
  )
}
