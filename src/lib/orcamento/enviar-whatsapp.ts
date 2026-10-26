import { createClient } from '@/lib/supabase/client'
import type { QuoteWithItems, QuoteStatus } from '@/types/database'

/** Uma janela de atendimento do WhatsApp: mensagens livres (e arquivos) só até 24h após a última do cliente. */
const JANELA_MS = 24 * 60 * 60 * 1000

/**
 * Envia o PDF do orçamento como arquivo na conversa de WhatsApp do cliente,
 * com uma mensagem e o link de aprovação. Roda no navegador (o PDF é gerado
 * pelo @react-pdf no cliente) e usa a rota /api/whatsapp/send-media, a mesma do
 * Atendimento — a mensagem aparece na conversa e as automações rodam.
 *
 * Regras:
 * - o orçamento precisa ter cliente com conversa de WhatsApp;
 * - o cliente precisa ter escrito nas últimas 24h (regra da Meta para mensagens
 *   que não são template);
 * - rascunho passa a "enviado" (mesmo efeito do botão de copiar link).
 *
 * @param quoteId - ID do orçamento
 * @returns Novo status do orçamento
 * @throws Error com mensagem pronta para exibir ao usuário
 */
export async function enviarOrcamentoWhatsapp(quoteId: string): Promise<QuoteStatus> {
  const supabase = createClient()

  const { data, error } = await supabase
    .from('quotes')
    .select('*, quote_items (*), template:quote_templates (*), lead:leads (nome, sobrenome, telefone)')
    .eq('id', quoteId)
    .single()
  if (error || !data) throw new Error('Orçamento não encontrado.')
  if (!data.lead_id) throw new Error('Este orçamento não tem cliente vinculado.')

  const { data: conv } = await supabase
    .from('wa_conversations')
    .select('id')
    .eq('lead_id', data.lead_id)
    .order('last_message_at', { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle()
  if (!conv) throw new Error('O cliente não tem conversa no WhatsApp. Inicie a conversa pelo Atendimento.')

  const { data: ultimaDoCliente } = await supabase
    .from('wa_messages')
    .select('created_at')
    .eq('conversation_id', conv.id)
    .eq('direction', 'inbound')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (!ultimaDoCliente || Date.now() - new Date(ultimaDoCliente.created_at).getTime() > JANELA_MS) {
    throw new Error(
      'O cliente não escreve há mais de 24h e o WhatsApp só permite enviar arquivos dentro dessa janela. ' +
      'Envie um template pelo Atendimento e, quando ele responder, envie o orçamento — ou use o botão de copiar link.'
    )
  }

  const quote: QuoteWithItems = {
    ...data,
    items:    data.quote_items ?? [],
    template: data.template ?? null,
    lead:     data.lead ?? null,
  }

  const { gerarPdfBlob } = await import('@/components/orcamento/PdfButton')
  const blob   = await gerarPdfBlob(quote)
  const numero = String(quote.numero ?? 0).padStart(4, '0')
  const nome   = quote.paciente_nome || quote.lead?.nome || ''
  const link   = `${window.location.origin}/orcamento/ver/${quote.token_publico}`

  const form = new FormData()
  form.append('file', new File([blob], `Orcamento-${numero}.pdf`, { type: 'application/pdf' }))
  form.append('conversation_id', conv.id)
  form.append('caption',
    `Olá${nome ? `, ${nome}` : ''}! Segue o seu orçamento nº ${numero}.\n` +
    `Para aprovar ou tirar dúvidas, é só responder aqui ou acessar: ${link}`)

  const res = await fetch('/api/whatsapp/send-media', { method: 'POST', body: form })
  if (!res.ok) {
    const j = await res.json().catch(() => ({}))
    throw new Error(j.error ?? 'Falha ao enviar o orçamento no WhatsApp.')
  }

  if (quote.status === 'rascunho') {
    const r = await fetch('/api/orcamento/respond', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ token: quote.token_publico, status: 'enviado' }),
    })
    if (r.ok) return 'enviado'
  }
  return quote.status
}
