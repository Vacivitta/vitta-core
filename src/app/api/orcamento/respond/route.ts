import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import type { AutomationTrigger, QuoteStatus } from '@/types/database'

// POST /api/orcamento/respond
// Body: { token: string, status: AutomationTrigger, motivo?: string }
//
// 'criado' é especial: só dispara automação, não altera o status do orçamento.
// Demais triggers também atualizam o status na tabela quotes.

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  if (!body?.token || !body?.status) {
    return NextResponse.json({ error: 'token e status são obrigatórios' }, { status: 400 })
  }

  const { token, status, motivo } = body as {
    token:   string
    status:  AutomationTrigger
    motivo?: string
  }

  if (status === 'recusado' && !motivo?.trim()) {
    return NextResponse.json({ error: 'motivo obrigatório para status recusado' }, { status: 400 })
  }

  const supabase = await createClient()

  // ── 1. Buscar o orçamento pelo token ──────────────────────────────────────
  const { data: quote, error: fetchErr } = await supabase
    .from('quotes')
    .select('id, unit_id, lead_id, client_id, status, responsavel_id, numero, total_calculado, lead:leads(nome,sobrenome), client:clients(nome,sobrenome)')
    .eq('token_publico', token)
    .single()

  if (fetchErr || !quote) {
    return NextResponse.json({ error: 'Orçamento não encontrado' }, { status: 404 })
  }

  // Impede re-processamento de status finais
  if (['aceito', 'recusado'].includes(quote.status)) {
    return NextResponse.json({ error: 'Orçamento já finalizado' }, { status: 409 })
  }

  // ── 2. Atualizar status do orçamento (não aplicável para 'criado') ─────────
  let updatedQuote = null
  if (status !== 'criado') {
    const now = new Date().toISOString()
    const quoteUpdate: Record<string, unknown> = { status: status as QuoteStatus }
    if (status === 'enviado')     quoteUpdate.enviado_em     = now
    if (status === 'visualizado') quoteUpdate.visualizado_em = now
    if (status === 'aceito')      quoteUpdate.aceito_em      = now
    if (status === 'recusado')    quoteUpdate.motivo_recusa  = motivo?.trim()

    const { data, error: updateErr } = await supabase
      .from('quotes')
      .update(quoteUpdate)
      .eq('token_publico', token)
      .select('*, quote_items(*), template:quote_templates(*), lead:leads(nome,sobrenome,telefone), client:clients(nome,sobrenome,telefone)')
      .single()

    if (updateErr) {
      return NextResponse.json({ error: updateErr.message }, { status: 500 })
    }
    updatedQuote = data
  }

  // ── 3. Executar automação de funil via função SECURITY DEFINER ────────────
  const leadId = quote.lead_id
  if (leadId) {
    const { error: autoErr } = await supabase.rpc('execute_quote_automation', {
      p_unit_id:      quote.unit_id,
      p_lead_id:      leadId,
      p_quote_status: status,
      p_motivo:       motivo ?? null,
    })
    if (autoErr) console.error('[orcamento/respond] execute_quote_automation:', autoErr.message)
  }

  // ── 4. Criar notificação in-app ao aceitar ou recusar ─────────────────────
  if (status === 'aceito' || status === 'recusado') {
    type QuoteRelation = { nome: string; sobrenome: string | null }
    type QuoteRow = typeof quote & {
      lead:            QuoteRelation | null
      client:          QuoteRelation | null
      responsavel_id:  string | null
    }
    const q          = quote as QuoteRow
    const patient    = q.lead ?? q.client
    const patientName = patient
      ? `${patient.nome}${patient.sobrenome ? ` ${patient.sobrenome}` : ''}`
      : 'Paciente'
    const numStr   = String(quote.numero ?? 0).padStart(4, '0')
    const fmtBRL   = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
    const valorStr = quote.total_calculado != null ? fmtBRL.format(Number(quote.total_calculado)) : ''

    const { error: notifErr } = await supabase.rpc('create_quote_notification', {
      p_unit_id:  quote.unit_id,
      p_user_id:  q.responsavel_id ?? null,
      p_type:     `quote_${status}`,
      p_title:    status === 'aceito' ? '✅ Orçamento aceito' : '❌ Orçamento recusado',
      p_body:     `#${numStr} · ${patientName}${valorStr ? ` · ${valorStr}` : ''}`,
      p_quote_id: quote.id,
      p_lead_id:  leadId ?? null,
    })
    if (notifErr) console.error('[orcamento/respond] create_quote_notification:', notifErr.message)
  }

  return NextResponse.json({
    quote: updatedQuote ? {
      ...updatedQuote,
      items:    updatedQuote.quote_items ?? [],
      template: updatedQuote.template    ?? null,
      lead:     updatedQuote.lead        ?? null,
      client:   updatedQuote.client      ?? null,
    } : null,
  })
}
