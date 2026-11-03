import type { SupabaseClient } from '@supabase/supabase-js'
import { getWaCredentials } from '@/lib/whatsapp/credentials'
import { resumoErro } from '@/lib/log-seguro'
import { normalizarTelefone } from '@/lib/telefone'
import { contarVariaveis, montarComponentesTemplate, resolveVariables } from '@/lib/whatsapp/template-variaveis'
import {
  atualizacaoAposLote, decidirLote, inicioDoDiaSaoPaulo, type ResultadoLote,
} from '@/lib/whatsapp/campanha-regras'

const META_API_URL = 'https://graph.facebook.com/v20.0'
export const TAMANHO_LOTE = 10
const INTERVALO_ENVIOS_MS = 2000
const MAX_TAXA_ERRO = 0.20
const ESPERA_429_MS = 8000

type Destinatario = { id: string; phone: string; lead_id: string | null; nome: string | null }

type Envio =
  | { tipo: 'enviado'; waId: string }
  | { tipo: 'falhou'; erro: string }
  | { tipo: 'pausar'; motivo: 'erro_meta' | 'autorizacao'; erro: string }

const esperar = (ms: number) => new Promise(r => setTimeout(r, ms))

async function enviarTemplate(
  url: string, accessToken: string, payload: object,
): Promise<Envio> {
  const chamar = () => fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(15_000),
  })
  try {
    let res = await chamar()
    if (res.status === 429) {
      await esperar(ESPERA_429_MS)
      res = await chamar()
      if (res.status === 429) {
        return { tipo: 'pausar', motivo: 'erro_meta', erro: 'Limite de taxa da Meta (429); retome em alguns minutos' }
      }
    }
    if (res.status === 401) {
      return {
        tipo: 'pausar', motivo: 'autorizacao',
        erro: 'Token de acesso inválido (401): verifique o token em Configurações → WhatsApp API',
      }
    }
    const data = await res.json() as { messages?: { id: string }[]; error?: { message?: string } }
    const waId = data.messages?.[0]?.id
    if (res.ok && waId) return { tipo: 'enviado', waId }
    console.error('[campanha] Meta recusou o envio:', resumoErro(data))
    return { tipo: 'falhou', erro: data.error?.message ?? `HTTP ${res.status}` }
  } catch (e) {
    return { tipo: 'falhou', erro: e instanceof Error ? e.message : 'Erro de rede/timeout' }
  }
}

async function contar(
  supabase: SupabaseClient, campaignId: string, filtro: 'pendentes' | 'enviados' | 'falhas',
): Promise<number> {
  let q = supabase.from('wa_campaign_recipients').select('id', { count: 'exact', head: true }).eq('campaign_id', campaignId)
  if (filtro === 'pendentes') q = q.eq('status', 'pending')
  else if (filtro === 'enviados') q = q.not('sent_at', 'is', null)
  else q = q.eq('status', 'failed')
  const { count, error } = await q
  if (error) throw new Error(`[campanha] contagem de ${filtro}: ${resumoErro(error)}`)
  return count ?? 0
}

async function enviadosHojeNaUnidade(supabase: SupabaseClient, unitId: string, agora: Date): Promise<number> {
  const { count, error } = await supabase
    .from('wa_campaign_recipients')
    .select('id, wa_campaigns!inner(unit_id)', { count: 'exact', head: true })
    .eq('wa_campaigns.unit_id', unitId)
    .gte('sent_at', inicioDoDiaSaoPaulo(agora).toISOString())
  if (error) throw new Error(`[campanha] envios do dia: ${resumoErro(error)}`)
  return count ?? 0
}

async function liberarReservas(supabase: SupabaseClient, ids: string[]) {
  if (ids.length === 0) return
  await supabase.from('wa_campaign_recipients').update({ reservado_em: null }).in('id', ids).eq('status', 'pending')
}

async function gravarResultado(
  supabase: SupabaseClient, campaignId: string, resultado: ResultadoLote, agora: Date,
) {
  const [enviados, falhas] = await Promise.all([
    contar(supabase, campaignId, 'enviados'),
    contar(supabase, campaignId, 'falhas'),
  ])
  const atualizacao = atualizacaoAposLote(resultado, agora)
  // Só mexe no status se ainda está 'enviando': pausa ou cancelamento feitos
  // durante o lote prevalecem
  await supabase.from('wa_campaigns').update({ sent_count: enviados, failed_count: falhas }).eq('id', campaignId)
  if (atualizacao) {
    await supabase.from('wa_campaigns').update(atualizacao).eq('id', campaignId).eq('status', 'enviando')
  }
}

/**
 * Envia um lote de uma campanha 'enviando'. Chamado pelo job a cada minuto e
 * pelo botão Disparar. Reserva os destinatários no banco antes de enviar
 * (`reservar_destinatarios_campanha`), então chamadas simultâneas não enviam
 * em dobro, e respeita o limite diário da unidade.
 *
 * @param prazo - Instante (ms) a partir do qual não começa outro envio; o que
 *   sobrar da reserva é devolvido para o próximo lote
 */
export async function processarLoteCampanha(
  supabase: SupabaseClient, campaignId: string, prazo: number,
): Promise<ResultadoLote> {
  const agora = new Date()
  const { data: campanha, error: errCampanha } = await supabase
    .from('wa_campaigns')
    .select('id, unit_id, status, daily_limit, template_id')
    .eq('id', campaignId)
    .maybeSingle()
  if (errCampanha) throw new Error(`[campanha] leitura: ${resumoErro(errCampanha)}`)
  if (!campanha) return { tipo: 'ignorada', status: 'inexistente' }
  if (campanha.status !== 'enviando') return { tipo: 'ignorada', status: campanha.status }

  const finalizar = async (r: ResultadoLote) => {
    await gravarResultado(supabase, campaignId, r, agora)
    return r
  }
  const pausar = (motivo: 'erro_meta' | 'autorizacao', detalhe: string, enviados = 0, falhas = 0) =>
    finalizar({ tipo: 'pausada', motivo, detalhe, enviados, falhas })

  const { data: template } = campanha.template_id
    ? await supabase
      .from('wa_message_templates')
      .select('name, template_name, language, content, variable_order, header_type, header_image_url')
      .eq('id', campanha.template_id)
      .maybeSingle()
    : { data: null }
  if (!template) return pausar('erro_meta', 'Template não encontrado')

  const { phoneNumberId, accessToken } = await getWaCredentials(campanha.unit_id)
  if (!phoneNumberId || !accessToken) return pausar('autorizacao', 'WhatsApp não configurado para esta unidade')

  const decisao = decidirLote({
    pendentes: await contar(supabase, campaignId, 'pendentes'),
    lote: TAMANHO_LOTE,
    limiteDiario: campanha.daily_limit,
    enviadosHojeNaUnidade: await enviadosHojeNaUnidade(supabase, campanha.unit_id, agora),
    agora,
  })
  if (decisao.tipo === 'concluida') return finalizar({ tipo: 'concluida', enviados: 0, falhas: 0 })
  if (decisao.tipo === 'limite_diario') {
    return finalizar({ tipo: 'limite_diario', retomarEm: decisao.retomarEm, enviados: 0, falhas: 0 })
  }

  const { data: reservados, error: errReserva } = await supabase
    .rpc('reservar_destinatarios_campanha', { p_campaign: campaignId, p_limite: decisao.quantidade })
  if (errReserva) throw new Error(`[campanha] reserva: ${resumoErro(errReserva)}`)
  const lote = (reservados ?? []) as Destinatario[]
  // Outro processo está com os pendentes (ou o limite foi consumido por ele)
  if (lote.length === 0) return { tipo: 'ocupada' }

  const varCount = contarVariaveis(template.content)
  const url = `${META_API_URL}/${phoneNumberId}/messages`
  let enviados = 0
  let falhas = 0
  let tentativas = 0

  for (let i = 0; i < lote.length; i++) {
    const d = lote[i]
    const restantes = () => lote.slice(i).map(x => x.id)

    if (Date.now() >= prazo) {
      await liberarReservas(supabase, restantes())
      break
    }
    const { data: atual } = await supabase.from('wa_campaigns').select('status').eq('id', campaignId).single()
    if (atual?.status !== 'enviando') {
      await liberarReservas(supabase, restantes())
      return finalizar({ tipo: 'ignorada', status: atual?.status ?? 'inexistente' })
    }

    if (d.lead_id) {
      const { data: lead } = await supabase.from('leads').select('wa_optout_at').eq('id', d.lead_id).maybeSingle()
      if (lead?.wa_optout_at) {
        await supabase.from('wa_campaign_recipients')
          .update({ status: 'skipped', error_msg: 'opt-out detectado antes do envio' })
          .eq('id', d.id)
        continue
      }
    }

    const para = normalizarTelefone(d.phone)
    if (!para) {
      await supabase.from('wa_campaign_recipients')
        .update({ status: 'failed', error_msg: 'Telefone inválido' })
        .eq('id', d.id)
      falhas++
      tentativas++
      continue
    }

    const valores = varCount > 0
      ? await resolveVariables(supabase, campanha.unit_id, d.lead_id, template.variable_order as string[] | null, varCount, d.nome)
      : []
    const { components } = montarComponentesTemplate(template, valores)

    const envio = await enviarTemplate(url, accessToken, {
      messaging_product: 'whatsapp',
      to: para,
      type: 'template',
      template: {
        name: template.template_name ?? template.name,
        language: { code: template.language ?? 'pt_BR' },
        components,
      },
    })

    if (envio.tipo === 'pausar') {
      await liberarReservas(supabase, restantes())
      return pausar(envio.motivo, envio.erro, enviados, falhas)
    }

    await supabase.from('wa_campaign_recipients').update(
      envio.tipo === 'enviado'
        ? { status: 'sent', wa_msg_id: envio.waId, sent_at: new Date().toISOString(), error_msg: null }
        : { status: 'failed', error_msg: envio.erro },
    ).eq('id', d.id)

    tentativas++
    if (envio.tipo === 'enviado') enviados++
    else falhas++

    if (tentativas >= 5 && falhas / tentativas > MAX_TAXA_ERRO) {
      await liberarReservas(supabase, lote.slice(i + 1).map(x => x.id))
      return pausar('erro_meta', `Taxa de erro de ${Math.round(falhas / tentativas * 100)}% no lote`, enviados, falhas)
    }

    if (i < lote.length - 1) await esperar(INTERVALO_ENVIOS_MS)
  }

  const pendentes = await contar(supabase, campaignId, 'pendentes')
  return finalizar(pendentes === 0
    ? { tipo: 'concluida', enviados, falhas }
    : { tipo: 'continua', pendentes, enviados, falhas })
}
