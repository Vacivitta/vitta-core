import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import EquipeClient from './EquipeClient'

export default async function EquipePage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles').select('perfil').eq('id', user.id).single()

  if (!profile || !['admin', 'gestor_vacivitta', 'gestor_unidade'].includes(profile.perfil)) {
    redirect('/funil')
  }

  const [{ data: users }, { data: units }] = await Promise.all([
    supabase
      .from('profiles')
      .select('id, full_name, email, perfil, unit_id, ativo, created_at, unit:units(id,nome)')
      .order('full_name'),
    supabase
      .from('units')
      .select('*')
      .order('nome'),
  ])

  return (
    <EquipeClient
      initialUsers={users ?? []}
      initialUnits={units ?? []}
    />
  )
}
