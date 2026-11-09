import { notFound, redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { ordenarNegocios, type NegocioDoContato } from '@/lib/contatos'
import type { Contato, StatusLead } from '@/types/database'
import ContatoClient, { type ConversaDoContato } from './ContatoClient'

export const metadata = { title: 'Contato — VittaDesk' }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

interface LinhaDeNegocio {
  id: string; status: StatusLead; arquivado: boolean; created_at: string
  funil: { nome: string } | null
  etapa: { nome: string; cor: string | null } | null
  responsavel: { full_name: string | null } | null
  negociacao: { valor_proposta: number | null; valor_negociado: number | null } | null
}

/** Ficha do contato (etapa 5b): a pessoa, os negócios dela, os dependentes e as conversas. Só leitura. */
export default async function ContatoPage({ params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { id } = await params
  if (!UUID.test(id)) notFound()

  const { data: contato } = await supabase.from('contatos').select('*').eq('id', id).maybeSingle<Contato>()
  if (!contato) notFound()

  // O dependente não tem negócios nem conversas: a ficha dele aponta para o responsável
  const [{ data: responsavel }, { data: dependentes }, { data: negocios }, { data: conversas }] = await Promise.all([
    contato.responsavel_id
      ? supabase.from('contatos').select('id, nome, sobrenome').eq('id', contato.responsavel_id).maybeSingle()
      : Promise.resolve({ data: null }),
    supabase.from('contatos').select('*').eq('responsavel_id', id).order('criado_em').returns<Contato[]>(),
    supabase.from('leads')
      .select('id, status, arquivado, created_at, funil:funnels!funnel_id(nome), etapa:funnel_stages!stage_id(nome, cor), responsavel:profiles!responsavel_id(full_name), negociacao:lead_negotiation(valor_proposta, valor_negociado)')
      .eq('contato_id', id)
      .returns<LinhaDeNegocio[]>(),
    supabase.from('wa_conversations')
      .select('id, wa_phone, status, last_message_at, last_message_content')
      .eq('contato_id', id)
      .order('last_message_at', { ascending: false, nullsFirst: false })
      .returns<ConversaDoContato[]>(),
  ])

  const lista: NegocioDoContato[] = (negocios ?? []).map(n => ({
    id: n.id,
    status: n.status,
    arquivado: n.arquivado,
    created_at: n.created_at,
    funil: n.funil?.nome ?? null,
    etapa: n.etapa?.nome ?? null,
    cor: n.etapa?.cor ?? null,
    responsavel: n.responsavel?.full_name ?? null,
    valor: n.negociacao?.valor_negociado ?? n.negociacao?.valor_proposta ?? null,
  }))

  return (
    <ContatoClient
      contato={contato}
      responsavel={responsavel ?? null}
      dependentes={dependentes ?? []}
      negocios={ordenarNegocios(lista)}
      conversas={conversas ?? []}
    />
  )
}
