import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import ProdutosClient from './ProdutosClient'
import type { Profile, Product } from '@/types/database'

export const metadata = { title: 'Catálogo de Vacinas — VittaDesk' }

export default async function ProdutosPage() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profileData } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single()

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
