/**
 * /api/orcamento/check-expiring
 *
 * Cron endpoint: verifica orçamentos próximos do vencimento e expirados.
 * - 1 dia antes do vencimento → notificação `quote_expiring`
 * - No dia do vencimento → notificação `quote_expiring` (lembrete final)
 * - Após vencimento → marca como `expirado` + notificação `quote_expirado`
 *
 * Proteja com CRON_SECRET: Authorization: Bearer <CRON_SECRET>
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const maxDuration = 30

export async function GET(req: NextRequest) { return handler(req) }
export async function POST(req: NextRequest) { return handler(req) }

async function handler(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (secret) {
    const auth = req.headers.get('authorization') ?? ''
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    return NextResponse.json({ error: 'Missing Supabase config' }, { status: 500 })
  }

  const supabase = createClient(url, key)
  const now = new Date()
  const today = now.toISOString().slice(0, 10)

  const tomorrow = new Date(now)
  tomorrow.setDate(tomorrow.getDate() + 1)
  const tomorrowStr = tomorrow.toISOString().slice(0, 10)

  const activeStatuses = ['rascunho', 'enviado', 'visualizado', 'em_negociacao']

  const { data: quotes, error: fetchErr } = await supabase
    .from('quotes')
    .select('id, unit_id, lead_id, responsavel_id, numero, total_calculado, validade_ate, status, lead:leads(nome,sobrenome)')
    .in('status', activeStatuses)
    .not('validade_ate', 'is', null)
    .lte('validade_ate', tomorrowStr)

  if (fetchErr) {
    return NextResponse.json({ error: fetchErr.message }, { status: 500 })
  }

  if (!quotes || quotes.length === 0) {
    return NextResponse.json({ processed: 0 })
  }

  const fmtBRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
  let notified = 0
  let expired = 0

  for (const q of quotes) {
    const validade = q.validade_ate as string
    const numStr = String(q.numero ?? 0).padStart(4, '0')
    const lead = q.lead as unknown as { nome: string; sobrenome: string | null } | null
    const patientName = lead ? `${lead.nome}${lead.sobrenome ? ` ${lead.sobrenome}` : ''}` : 'Paciente'
    const valorStr = q.total_calculado != null ? fmtBRL.format(Number(q.total_calculado)) : ''
    const body = `#${numStr} · ${patientName}${valorStr ? ` · ${valorStr}` : ''}`

    if (validade < today) {
      // Vencido — marcar como expirado (trigger fn_notify_quote_expired cria a notificação)
      await supabase
        .from('quotes')
        .update({ status: 'expirado' })
        .eq('id', q.id)

      expired++
      notified++
    } else if (validade === today || validade === tomorrowStr) {
      // Vence hoje ou amanhã — notificar
      const isToday = validade === today
      await supabase.rpc('create_quote_notification', {
        p_unit_id:  q.unit_id,
        p_user_id:  q.responsavel_id ?? null,
        p_type:     'quote_expiring',
        p_title:    isToday ? '⚠️ Orçamento vence hoje' : '📋 Orçamento vence amanhã',
        p_body:     body,
        p_quote_id: q.id,
        p_lead_id:  q.lead_id ?? null,
      })
      notified++
    }
  }

  return NextResponse.json({ processed: quotes.length, notified, expired })
}
