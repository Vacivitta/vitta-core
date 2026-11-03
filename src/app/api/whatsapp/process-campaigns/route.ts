/**
 * POST /api/whatsapp/process-campaigns — alvo do job pg_cron process-wa-campaigns
 * (a cada minuto), com `Authorization: Bearer <CRON_SECRET>`.
 *
 * Rodar duas vezes seguidas (ou junto com o botão Disparar) não envia em dobro:
 * os destinatários são reservados no banco antes do envio.
 */
import { after, NextRequest, NextResponse } from 'next/server'
import { cronAutorizado } from '@/lib/auth/cron'
import { createAdminClient } from '@/lib/supabase/admin'
import { resumoErro } from '@/lib/log-seguro'
import { PRAZO_LOTE_MS, processarLoteCampanha } from '@/lib/whatsapp/campanha'

export const maxDuration = 60

const MAX_CAMPANHAS = 5

export async function POST(req: NextRequest) {
  if (!cronAutorizado(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createAdminClient()
  const agora = new Date().toISOString()
  const prazo = Date.now() + PRAZO_LOTE_MS

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

  const { data: enviando, error: errEnviando } = await supabase
    .from('wa_campaigns')
    .select('id')
    .eq('status', 'enviando')
    .order('updated_at', { ascending: true })
    .limit(MAX_CAMPANHAS)
  if (errEnviando) return NextResponse.json({ error: errEnviando.message }, { status: 500 })

  // Os lotes levam ~20 s (2 s entre envios) e o pg_net desiste da resposta em
  // 5 s: responde já e envia depois da resposta
  after(async () => {
    await Promise.all((enviando ?? []).map(async ({ id }) => {
      try {
        const resultado = await processarLoteCampanha(supabase, id, prazo)
        if (resultado.tipo === 'pausada') {
          console.warn(`[process-campaigns] campanha=${id} pausada (${resultado.motivo}): ${resultado.detalhe}`)
        }
      } catch (e) {
        console.error(`[process-campaigns] campanha=${id}:`, resumoErro(e))
      }
    }))
  })

  return NextResponse.json({
    agendadas_iniciadas: agendadas?.length ?? 0,
    retomadas: retomadas?.length ?? 0,
    lotes: enviando?.length ?? 0,
  })
}
