import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import PublicQuoteClient from './PublicQuoteClient'
import type { QuoteWithItems } from '@/types/database'

export const metadata = { title: 'Orçamento — VittaDesk' }

interface Props {
  params: Promise<{ token: string }>
}

export default async function PublicQuotePage({ params }: Props) {
  const { token } = await params
  const supabase = await createClient()

  const { data } = await supabase
    .from('quotes')
    .select(`
      *,
      quote_items (*),
      template:quote_templates (*),
      lead:leads (nome, sobrenome, telefone)
    `)
    .eq('token_publico', token)
    .single()

  if (!data) notFound()

  // Marcar como visualizado se ainda não foi
  if (!data.visualizado_em && ['rascunho', 'enviado'].includes(data.status)) {
    await supabase
      .from('quotes')
      .update({
        visualizado_em: new Date().toISOString(),
        status: data.status === 'enviado' ? 'visualizado' : data.status,
      })
      .eq('token_publico', token)
  }

  const quote: QuoteWithItems = {
    ...data,
    items: data.quote_items ?? [],
    template: data.template ?? null,
    lead: data.lead ?? null,
  }

  return <PublicQuoteClient quote={quote} token={token} />
}
