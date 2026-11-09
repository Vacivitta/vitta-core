import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { buscarPerfil } from '@/lib/supabase/perfil'
import { dadosDeTicket, inicioDosResolvidos } from '@/lib/tickets-servidor'
import type { Ticket } from '@/types/database'
import TicketsClient, { type TicketDaLista } from './TicketsClient'

export const metadata = { title: 'Tickets — VittaDesk' }

export default async function TicketsPage({ searchParams }: { searchParams: Promise<{ ticket?: string }> }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await buscarPerfil(supabase, user.id, 'unit_id, perfil')
  if (!profile?.unit_id) redirect('/login')
  const unitId = profile.unit_id
  const { ticket } = await searchParams

  const dados = await dadosDeTicket(supabase, unitId)
  if (!dados.modulos.has('tickets')) {
    return (
      <div style={{ padding: 32, maxWidth: 640, margin: '0 auto', color: '#71856F', fontSize: 13.5, lineHeight: 1.6 }}>
        <h1 style={{ fontSize: 22, fontWeight: 800, color: '#25402C' }}>Tickets</h1>
        O módulo Tickets está desligado nesta unidade. A marca liga em Configurações › Módulos.
      </div>
    )
  }

  // Abertos e os resolvidos nos últimos 30 dias
  const desde = inicioDosResolvidos()
  const { data: tickets } = await supabase.from('tickets')
    .select('*, empresa:empresas(nome), lead:leads(nome, sobrenome)')
    .eq('unit_id', unitId)
    .or(`status.eq.aberto,resolvido_em.gte.${desde}`)
    .order('criado_em', { ascending: false })
    .limit(500)
    .returns<(Ticket & { empresa: { nome: string } | null; lead: { nome: string; sobrenome: string | null } | null })[]>()

  return (
    <TicketsClient
      unitId={unitId}
      usuarioId={user.id}
      tickets={(tickets ?? []) as TicketDaLista[]}
      funis={dados.funis}
      pessoas={dados.pessoas}
      empresas={dados.empresas}
      ticketInicial={ticket ?? null}
    />
  )
}
