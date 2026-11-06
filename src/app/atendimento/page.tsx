import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { corDaUnidade, type ConexaoDaCaixa, type UnidadeDaCaixa } from '@/lib/unidades'
import AtendimentoClient from './AtendimentoClient'
import type { Profile, FunnelWithStages } from '@/types/database'
import { buscarPerfil } from '@/lib/supabase/perfil'

export const metadata = { title: 'Atendimento — VittaDesk' }

export default async function AtendimentoPage({
  searchParams,
}: {
  searchParams: Promise<{ numero?: string; conversa?: string }>
}) {
  const supabase = await createClient()
  const { numero, conversa } = await searchParams

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profileData } = await buscarPerfil(supabase, user.id, '*')

  const unitId = (profileData as Profile)?.unit_id

  const [
    { data: profilesData },
    { data: funnelsData },
    { data: stagesData },
    { data: userUnits },
    unidades,
  ] = await Promise.all([
    supabase.from('profiles').select('*').eq('unit_id', unitId).order('full_name'),
    supabase.from('funnels').select('*').eq('ativo', true).eq('unit_id', unitId).order('ordem'),
    supabase.from('funnel_stages').select('*').eq('unit_id', unitId).order('funnel_id').order('ordem'),
    supabase.from('user_units').select('user_id').eq('unit_id', unitId).eq('ativo', true),
    unidadesDaCaixa(supabase, user.id),
  ])

  // Conexões das unidades do usuário (RLS de conexoes, 143): nome, número e tipo, sem token
  const { data: conexoesData } = await supabase.from('conexoes')
    .select('id, nome, numero, tipo, pessoal')
    .in('unit_id', unidades.map(u => u.id))

  const extraUserIds = (userUnits ?? [])
    .map(r => r.user_id as string)
    .filter(id => !(profilesData ?? []).some(p => p.id === id))

  let allProfiles = profilesData ?? []
  if (extraUserIds.length > 0) {
    const { data: extra } = await supabase
      .from('profiles').select('*').in('id', extraUserIds).order('full_name')
    if (extra) allProfiles = [...allProfiles, ...extra]
  }

  const funnelsWithStages: FunnelWithStages[] = (funnelsData ?? []).map(f => ({
    ...f,
    stages: (stagesData ?? []).filter(s => s.funnel_id === f.id),
  }))

  return (
    <AtendimentoClient
      funnels={funnelsWithStages}
      profiles={allProfiles as Profile[]}
      currentUser={profileData as Profile}
      initialNumero={numero ?? null}
      initialConversaId={conversa ?? null}
      unidades={unidades}
      conexoes={(conexoesData ?? []) as ConexaoDaCaixa[]}
    />
  )
}

/**
 * Unidades vinculadas ao usuário, com cor e o número da conexão. O número vem do
 * wa_config com service role (a tabela guarda o token e não tem policy para o
 * navegador): só display_phone, e só das unidades em que o usuário está.
 */
async function unidadesDaCaixa(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
): Promise<UnidadeDaCaixa[]> {
  const { data: vinculos } = await supabase.from('user_units').select('unit_id').eq('user_id', userId)
  const ids = (vinculos ?? []).map(v => v.unit_id as string)
  if (ids.length === 0) return []

  const [{ data: units }, { data: conexoes }] = await Promise.all([
    supabase.from('units').select('id, nome, cor').in('id', ids).order('criado_em').order('id'),
    createAdminClient().from('wa_config').select('unit_id, display_phone').in('unit_id', ids).eq('is_active', true),
  ])
  const numeroPorUnidade = new Map((conexoes ?? []).map(c => [c.unit_id as string, (c.display_phone as string | null) ?? null]))

  return (units ?? []).map((u, posicao) => ({
    id:     u.id as string,
    nome:   u.nome as string,
    cor:    corDaUnidade((u.cor as string | null) ?? null, posicao),
    numero: numeroPorUnidade.get(u.id as string) ?? null,
  }))
}
