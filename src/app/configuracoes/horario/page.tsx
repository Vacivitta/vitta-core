import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { buscarPerfil } from '@/lib/supabase/perfil'
import HorarioClient, { type Feriado, type HorarioComFaixas } from './HorarioClient'

export const metadata = { title: 'Horário de atendimento — VittaDesk' }

export default async function HorarioPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await buscarPerfil(supabase, user.id, 'unit_id, perfil')
  if (!profile?.unit_id) redirect('/login')
  if (profile.perfil === 'atendente') redirect('/funil')
  const unitId = profile.unit_id

  const hoje = new Date().toISOString().slice(0, 10)
  const [{ data: unidade }, { data: horarios }, { data: filas }, { data: funis }, { data: feriados }] = await Promise.all([
    supabase.from('units').select('id, nome, fuso').eq('id', unitId).single(),
    supabase.from('horarios_atendimento')
      .select('id, escopo, fila_id, funnel_id, ativo, horario_faixas(dia_semana, inicio, fim)')
      .eq('unit_id', unitId)
      .returns<HorarioComFaixas[]>(),
    supabase.from('wa_queues').select('id, nome').eq('unit_id', unitId).eq('ativo', true).order('nome'),
    supabase.from('funnels').select('id, nome').eq('unit_id', unitId).eq('ativo', true).order('ordem'),
    supabase.from('feriados')
      .select('id, unit_id, data, nome, fechado, inicio, fim')
      .or(`unit_id.is.null,unit_id.eq.${unitId}`)
      .gte('data', hoje)
      .order('data')
      .returns<Feriado[]>(),
  ])
  if (!unidade) redirect('/funil')

  return (
    <HorarioClient
      unidade={{ id: unidade.id as string, nome: unidade.nome as string, fuso: unidade.fuso as string }}
      marca={profile.perfil === 'admin' || profile.perfil === 'gestor_vacivitta'}
      horarios={horarios ?? []}
      filas={(filas ?? []) as { id: string; nome: string }[]}
      funis={(funis ?? []) as { id: string; nome: string }[]}
      feriados={feriados ?? []}
    />
  )
}
