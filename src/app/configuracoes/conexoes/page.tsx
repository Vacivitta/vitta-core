import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { buscarPerfil } from '@/lib/supabase/perfil'
import { isPerfilAdminGlobal, isPerfilGestor } from '@/lib/auth/access'
import { configEvolution } from '@/lib/whatsapp/evolution'
import type { Conexao } from '@/types/database'
import ConexoesClient from './ConexoesClient'

export const metadata = { title: 'Conexões de WhatsApp — VittaDesk' }

export default async function ConexoesPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await buscarPerfil(supabase, user.id, 'unit_id, perfil')
  if (!profile?.unit_id) redirect('/login')
  const unitId = profile.unit_id

  const [{ data: unidade }, { data: vinculo }, { data: conexoes }] = await Promise.all([
    supabase.from('units').select('id, nome').eq('id', unitId).single(),
    supabase.from('user_units').select('unit_id').eq('user_id', user.id).eq('unit_id', unitId).maybeSingle(),
    supabase.from('conexoes')
      .select('id, unit_id, tipo, nome, numero, pessoal, dona_id, wa_config_id, instancia, status, ativo, criado_em, limite_por_minuto')
      .eq('unit_id', unitId)
      .order('tipo')
      .order('criado_em')
      .returns<Conexao[]>(),
  ])
  if (!unidade) redirect('/funil')

  const donas = [...new Set((conexoes ?? []).map(c => c.dona_id).filter((id): id is string => !!id))]
  const { data: perfis } = donas.length
    ? await supabase.from('profiles').select('id, full_name, apelido').in('id', donas)
    : { data: [] as { id: string; full_name: string | null; apelido: string | null }[] }

  return (
    <ConexoesClient
      unidade={{ id: unidade.id as string, nome: unidade.nome as string }}
      conexoes={conexoes ?? []}
      nomesDasDonas={Object.fromEntries((perfis ?? []).map(p => [p.id as string, (p.apelido as string | null) || (p.full_name as string | null) || 'Sem nome']))}
      quem={{ userId: user.id, ehMarca: isPerfilAdminGlobal(profile.perfil), ehGestor: isPerfilGestor(profile.perfil), membro: !!vinculo }}
      conectorConfigurado={configEvolution() !== null}
    />
  )
}
