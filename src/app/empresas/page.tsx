import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { buscarPerfil } from '@/lib/supabase/perfil'
import { isPerfilGestor } from '@/lib/auth/access'
import { dadosDeTicket } from '@/lib/tickets-servidor'
import type { Empresa } from '@/types/database'
import EmpresasClient, { type EmpresaDaLista } from './EmpresasClient'

export const metadata = { title: 'Empresas — VittaDesk' }

export default async function EmpresasPage({ searchParams }: { searchParams: Promise<{ empresa?: string }> }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await buscarPerfil(supabase, user.id, 'unit_id, perfil')
  if (!profile?.unit_id) redirect('/login')
  const unitId = profile.unit_id
  const { empresa } = await searchParams

  const dados = await dadosDeTicket(supabase, unitId)
  if (!dados.modulos.has('empresas')) {
    return (
      <div style={{ padding: 32, maxWidth: 640, margin: '0 auto', color: '#71856F', fontSize: 13.5, lineHeight: 1.6 }}>
        <h1 style={{ fontSize: 22, fontWeight: 800, color: '#25402C' }}>Empresas</h1>
        O módulo Empresas está desligado nesta unidade. A marca liga em Configurações › Módulos.
      </div>
    )
  }

  const { data: empresas } = await supabase.from('empresas')
    .select('*, empresa_vinculos(count), tickets(count)')
    .eq('unit_id', unitId)
    .order('nome')
    .returns<(Empresa & { empresa_vinculos: { count: number }[]; tickets: { count: number }[] })[]>()

  return (
    <EmpresasClient
      unitId={unitId}
      usuarioId={user.id}
      gestor={isPerfilGestor(profile.perfil)}
      ticketsLigado={dados.modulos.has('tickets')}
      pessoas={dados.pessoas}
      empresas={(empresas ?? []).map(e => ({
        ...e,
        contatos: e.empresa_vinculos?.[0]?.count ?? 0,
        totalTickets: e.tickets?.[0]?.count ?? 0,
      })) as EmpresaDaLista[]}
      empresaInicial={empresa ?? null}
    />
  )
}
