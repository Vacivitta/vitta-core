import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { buscarPerfil } from '@/lib/supabase/perfil'
import { isPerfilAdminGlobal } from '@/lib/auth/access'
import type { UnidadeModulo } from '@/types/database'
import ModulosClient from './ModulosClient'

export const metadata = { title: 'Módulos — VittaDesk' }

export default async function ModulosPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await buscarPerfil(supabase, user.id, 'unit_id, perfil')
  if (!isPerfilAdminGlobal(profile?.perfil)) redirect('/funil')

  const [{ data: units }, { data: excecoes }] = await Promise.all([
    supabase.from('units').select('id, nome, tipo').eq('ativo', true).order('nome'),
    supabase.from('unidade_modulos').select('unit_id, modulo, ativo, alterado_em, alterado_por').returns<UnidadeModulo[]>(),
  ])

  return (
    <ModulosClient
      unidades={(units ?? []) as { id: string; nome: string; tipo: string }[]}
      excecoes={excecoes ?? []}
      userId={user.id}
    />
  )
}
