import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import ClientesClient, { type LeadDuplicado } from './ClientesClient'
import type { Profile } from '@/types/database'
import { buscarPerfil } from '@/lib/supabase/perfil'

export default async function ClientesPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profileData } = await buscarPerfil(supabase, user.id, '*')

  const unitId = (profileData as Profile)?.unit_id

  const [
    { data: leads, error: leadsError },
    { data: profiles },
    { data: units },
    { data: funnels },
    { data: userUnits },
  ] = await Promise.all([
    supabase
      .from('leads')
      .select('*')
      .eq('is_converted', true)
      .neq('status', 'perdido')
      .eq('arquivado', false)
      .eq('unit_id', unitId)
      .order('created_at', { ascending: false }),
    supabase.from('profiles').select('id, full_name').eq('unit_id', unitId).order('full_name'),
    supabase.from('units').select('id, nome').eq('ativo', true),
    supabase
      .from('funnels')
      .select('id, stages:funnel_stages(id)')
      .eq('objeto', 'negocio')
      .eq('ativo', true)
      .eq('unit_id', unitId)
      .order('ordem')
      .limit(1),
    supabase.from('user_units').select('user_id').eq('unit_id', unitId).eq('ativo', true),
  ])

  const extraUserIds = (userUnits ?? [])
    .map(r => r.user_id as string)
    .filter(id => !(profiles ?? []).some(p => p.id === id))

  let allProfiles = profiles ?? []
  if (extraUserIds.length > 0) {
    const { data: extra } = await supabase
      .from('profiles').select('id, full_name').in('id', extraUserIds).order('full_name')
    if (extra) allProfiles = [...allProfiles, ...extra]
  }

  const telefoneDuplicados = unitId ? await buscarTelefonesDuplicados(supabase, unitId) : []

  const defaultFunnelId =(funnels as ({ id: string; stages: { id: string }[] }[] | null))?.[0]?.id ?? null
  const defaultStageId  = (funnels as ({ id: string; stages: { id: string }[] }[] | null))?.[0]?.stages?.[0]?.id ?? null

  return (
    <ClientesClient
      initialClients={umPorContato(leads ?? [])}
      initialError={leadsError?.message ?? null}
      profiles={allProfiles}
      units={units ?? []}
      defaultFunnelId={defaultFunnelId}
      defaultStageId={defaultStageId}
      telefoneDuplicados={telefoneDuplicados}
    />
  )
}

/**
 * Um contato pode ter vários negócios ganhos (150): a lista mostra o cliente uma vez,
 * pelo negócio mais recente (a consulta já vem do mais novo para o mais antigo).
 */
function umPorContato<L extends { contato_id: string }>(leads: L[]): L[] {
  const vistos = new Set<string>()
  return leads.filter(l => !vistos.has(l.contato_id) && vistos.add(l.contato_id))
}

async function buscarTelefonesDuplicados(
  supabase: Awaited<ReturnType<typeof createClient>>,
  unitId: string,
): Promise<LeadDuplicado[][]> {
  const pagina = 1000
  // Negócios do mesmo contato não são duplicados (150): conta contatos por telefone
  const contagem = new Map<string, Set<string>>()
  for (let inicio = 0; ; inicio += pagina) {
    const { data } = await supabase
      .from('leads')
      .select('id, telefone_norm, contato_id')
      .eq('unit_id', unitId)
      .not('telefone_norm', 'is', null)
      .order('id')
      .range(inicio, inicio + pagina - 1)
    for (const l of data ?? []) contagem.set(l.telefone_norm, (contagem.get(l.telefone_norm) ?? new Set<string>()).add(l.contato_id))
    if (!data || data.length < pagina) break
  }
  const repetidos = [...contagem].filter(([, contatos]) => contatos.size > 1).map(([norm]) => norm)
  if (repetidos.length === 0) return []

  const { data: leads } = await supabase
    .from('leads')
    .select('id, nome, sobrenome, telefone, telefone_norm, unit_id, created_at, status, is_converted')
    .eq('unit_id', unitId)
    .in('telefone_norm', repetidos)
    .order('created_at')
  const grupos = new Map<string, LeadDuplicado[]>()
  for (const l of (leads ?? []) as LeadDuplicado[]) {
    if (!l.telefone_norm) continue
    grupos.set(l.telefone_norm, [...(grupos.get(l.telefone_norm) ?? []), l])
  }
  return [...grupos.values()].filter(g => g.length > 1)
}
