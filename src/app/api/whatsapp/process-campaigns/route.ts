/**
 * POST /api/whatsapp/process-campaigns — alvo do job pg_cron process-wa-campaigns
 * (a cada minuto), com `Authorization: Bearer <CRON_SECRET>`.
 *
 * 1. agendada com scheduled_at vencido → enviando;
 * 2. pausada por limite diário com retomar_em vencido → enviando;
 * 3. um lote por campanha 'enviando', até MAX_CAMPANHAS em paralelo.
 *
 * Rodar duas vezes seguidas (ou junto com o botão Disparar) não envia em dobro:
 * os destinatários são reservados no banco antes do envio.
 */
import { NextRequest, NextResponse } from 'next/server'
import { cronAutorizado } from '@/lib/auth/cron'
import { createAdminClient } from '@/lib/supabase/admin'
import { resumoErro } from '@/lib/log-seguro'
import { processarLoteCampanha } from '@/lib/whatsapp/campanha'

export const maxDuration = 60

const MAX_CAMPANHAS = 5
// Folga para gravar contadores antes do maxDuration
const PRAZO_ENVIOS_MS = 40_000

export async function POST(req: NextRequest) {
  if (!cronAutorizado(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createAdminClient()
  const agora = new Date().toISOString()
  const prazo = Date.now() + PRAZO_ENVIOS_MS

  const { data: agendadas, error: errAgendadas } = await supabase
    .from('wa_campaigns')
    .update({ status: 'enviando', started_at: agora, motivo_pausa: null, retomar_em: null })
    .eq('status', 'agendada')
    .lte('scheduled_at', agora)
    .select('id')
  if (errAgendadas) return NextResponse.json({ error: errAgendadas.message }, { status: 500 })

  const { data: retomadas, error: errRetomadas } = await supabase
    .from('wa_campaigns')
    .update({ status: 'enviando', motivo_pausa: null, retomar_em: null })
    .eq('status', 'pausada')
    .eq('motivo_pausa', 'limite_diario')
    .lte('retomar_em', agora)
    .select('id')
  if (errRetomadas) return NextResponse.json({ error: errRetomadas.message }, { status: 500 })

  // A menos atualizada primeiro, para revezar quando houver mais que MAX_CAMPANHAS
  const { data: enviando, error: errEnviando } = await supabase
    .from('wa_campaigns')
    .select('id')
    .eq('status', 'enviando')
    .order('updated_at', { ascending: true })
    .limit(MAX_CAMPANHAS)
  if (errEnviando) return NextResponse.json({ error: errEnviando.message }, { status: 500 })

  const resultados = await Promise.all((enviando ?? []).map(async ({ id }) => {
    try {
      return { id, resultado: await processarLoteCampanha(supabase, id, prazo) }
    } catch (e) {
      console.error(`[process-campaigns] campanha=${id}:`, resumoErro(e))
      return { id, resultado: { tipo: 'erro' as const } }
    }
  }))

  return NextResponse.json({
    agendadas_iniciadas: agendadas?.length ?? 0,
    retomadas: retomadas?.length ?? 0,
    lotes: resultados.map(r => ({ id: r.id, tipo: r.resultado.tipo })),
  })
}
