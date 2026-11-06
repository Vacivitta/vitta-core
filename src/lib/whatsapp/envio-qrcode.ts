import type { SupabaseClient } from '@supabase/supabase-js'
import { enviarMidiaQr, enviarTextoQr, ErroEvolution } from '@/lib/whatsapp/evolution'
import { resumoErro } from '@/lib/log-seguro'

export interface ConexaoEnvio { id: string; tipo: 'oficial' | 'qrcode'; instancia: string | null; ativo: boolean; status: string }

/** Destino na Evolution: o número do contato ou, no grupo, o jid do grupo. */
export function destinoQr(conversa: { wa_phone: string; tipo?: string | null }): string {
  return conversa.tipo === 'grupo' ? `${conversa.wa_phone}@g.us` : conversa.wa_phone
}

export type ResultadoEnvioQr =
  | { ok: true; waMessageId: string | null }
  | { ok: false; erro: string; status: number }

type Envio =
  | { tipo: 'texto'; texto: string }
  | { tipo: 'midia'; midia: Parameters<typeof enviarMidiaQr>[2] }

/**
 * Envia pela conexão de QR Code (Evolution): só com a sessão conectada e dentro
 * do limite por minuto do número (reservar_envio_conexao, 144). Modelo de
 * mensagem não existe nesse canal; quem chama recusa antes.
 */
export async function enviarPorQrCode(admin: SupabaseClient, conexao: ConexaoEnvio, para: string, envio: Envio): Promise<ResultadoEnvioQr> {
  if (!conexao.ativo || conexao.status !== 'conectada' || !conexao.instancia) {
    return { ok: false, status: 409, erro: 'Este número está desconectado. Leia o QR Code de novo em Configurações › Conexões.' }
  }
  const { data: vaga, error } = await admin.rpc('reservar_envio_conexao', { p_conexao: conexao.id })
  if (error) {
    console.error(`[QR envio] reserva conexão=${conexao.id}:`, resumoErro(error))
    return { ok: false, status: 500, erro: 'Erro ao reservar o envio' }
  }
  if (!vaga) {
    return { ok: false, status: 429, erro: 'Limite de mensagens por minuto deste número atingido (canal não oficial). Tente de novo em instantes.' }
  }
  try {
    const waMessageId = envio.tipo === 'texto'
      ? await enviarTextoQr(conexao.instancia, para, envio.texto)
      : await enviarMidiaQr(conexao.instancia, para, envio.midia)
    return { ok: true, waMessageId }
  } catch (e) {
    console.error(`[QR envio] conexão=${conexao.id}:`, e instanceof ErroEvolution ? e.message : resumoErro(e))
    return { ok: false, status: 502, erro: 'Falha ao enviar pelo WhatsApp (QR Code)' }
  }
}
