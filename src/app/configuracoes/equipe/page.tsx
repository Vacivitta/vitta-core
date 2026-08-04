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

  const [{ data: profiles }, { data: units }, { data: userUnits }] = await Promise.all([
    supabase
      .from('profiles')
      .select('id, full_name, apelido, email, perfil, unit_id, ativo, created_at, unit:units(id,nome)')
      .order('full_name'),
    supabase
      .from('units')
      .select('*')
      .order('nome'),
    supabase
      .from('user_units')
      .select('user_id, unit_id')
      .eq('ativo', true),
  ])

  const unitsByUser: Record<string, string[]> = {}
  for (const row of userUnits ?? []) {
    if (!unitsByUser[row.user_id]) unitsByUser[row.user_id] = []
    unitsByUser[row.user_id].push(row.unit_id)
  }

  const users = (profiles ?? []).map(p => ({
    ...p,
    unit_ids: unitsByUser[p.id] ?? (p.unit_id ? [p.unit_id] : []),
  }))

  return (
    <EquipeClient
      initialUsers={users as unknown as Parameters<typeof EquipeClient>[0]['initialUsers']}
      initialUnits={units ?? []}
    />
  )
}
