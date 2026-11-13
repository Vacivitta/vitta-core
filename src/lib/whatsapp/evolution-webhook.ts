/**
 * Regras puras do webhook da Evolution (conexão por QR Code), testadas em
 * tests/evolution.test.mjs sem rede nem banco.
 */
import { createHmac, timingSafeEqual } from 'node:crypto'

function base64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/**
 * Confere o `Authorization: Bearer <JWT>` que a Evolution assina com o `jwt_key`
 * da instância (HS256, validade de 10 minutos). Recusa outro algoritmo, assinatura
 * errada, token vencido ou emitido no futuro (com 60 s de folga para relógios).
 *
 * @param cabecalho - valor do cabeçalho Authorization
 * @param segredo - EVOLUTION_WEBHOOK_SECRET
 * @param agoraSeg - instante atual em segundos (injetável para teste)
 */
export function webhookEvolutionAutorizado(cabecalho: string | null, segredo: string | undefined, agoraSeg = Math.floor(Date.now() / 1000)): boolean {
  if (!segredo || !cabecalho?.startsWith('Bearer ')) return false
  const partes = cabecalho.slice(7).trim().split('.')
  if (partes.length !== 3) return false
  const [cab, carga, assinatura] = partes
  let cabecalhoJwt: { alg?: string }
  let corpo: { exp?: number; iat?: number }
  try {
    cabecalhoJwt = JSON.parse(Buffer.from(cab, 'base64url').toString('utf8'))
    corpo = JSON.parse(Buffer.from(carga, 'base64url').toString('utf8'))
  } catch {
    return false
  }
  if (cabecalhoJwt.alg !== 'HS256') return false
  const esperada = Buffer.from(base64url(createHmac('sha256', segredo).update(`${cab}.${carga}`).digest()))
  const recebida = Buffer.from(assinatura)
  if (esperada.length !== recebida.length || !timingSafeEqual(esperada, recebida)) return false
  if (typeof corpo.exp !== 'number' || corpo.exp < agoraSeg) return false
  if (typeof corpo.iat === 'number' && corpo.iat > agoraSeg + 60) return false
  return true
}

export type StatusConexao = 'conectada' | 'desconectada' | 'aguardando_qr'

/** Estado da sessão na Evolution → status da conexão. `null` quando não muda nada. */
export function statusDaConexao(estado: string | null | undefined): StatusConexao | null {
  if (estado === 'open') return 'conectada'
  if (estado === 'close' || estado === 'refused') return 'desconectada'
  return null
}

export interface MensagemQr {
  /** Conversa individual: wa_id do contato (só dígitos, com DDI). Grupo: id do grupo (antes do @g.us). */
  telefone:   string
  grupo:      boolean
  /** Quem escreveu no grupo; null na conversa individual e no que a própria conexão enviou */
  autor:      { telefone: string | null; nome: string | null } | null
  deMim:      boolean
  id:         string
  /** Nome do contato (pushName) na conversa individual; no grupo vai em autor */
  nome:       string | null
  tipo:       'text' | 'image' | 'audio' | 'video' | 'document' | 'sticker'
  texto:      string | null
  midia:      { base64: string; mimetype: string; nomeArquivo: string | null } | null
}

interface DadosMensagem {
  key?: { remoteJid?: string; fromMe?: boolean; id?: string; participant?: string; participantAlt?: string }
  pushName?: string
  messageType?: string
  message?: Record<string, unknown> & { base64?: string }
}

const TIPOS: Record<string, MensagemQr['tipo']> = {
  conversation: 'text',
  extendedTextMessage: 'text',
  imageMessage: 'image',
  audioMessage: 'audio',
  videoMessage: 'video',
  documentMessage: 'document',
  documentWithCaptionMessage: 'document',
  stickerMessage: 'sticker',
}

function numeroDoJid(jid: string): string {
  return jid.split('@')[0].split(':')[0].replace(/\D/g, '')
}

/**
 * Interpreta `data` de um evento `messages.upsert`. Devolve `null` para o que o
 * Atendimento não mostra: status, transmissão, contato só por LID (sem número) e
 * tipos sem conteúdo (reação, enquete, chamada...). No grupo, o autor vem de
 * key.participant ou, quando ele é um LID, de key.participantAlt.
 */
export function interpretarMensagemQr(dados: DadosMensagem | null | undefined): MensagemQr | null {
  const jid = dados?.key?.remoteJid ?? ''
  const id = dados?.key?.id
  const grupo = jid.endsWith('@g.us')
  if (!id || (!grupo && !jid.endsWith('@s.whatsapp.net'))) return null
  const telefone = grupo ? jid.split('@')[0].replace(/[^0-9-]/g, '') : numeroDoJid(jid)
  if (!telefone) return null

  const tipo = TIPOS[dados?.messageType ?? '']
  if (!tipo) return null
  const msg = dados?.message ?? {}
  const corpo = (msg[dados!.messageType!] ?? {}) as Record<string, unknown>
  const documento = dados?.messageType === 'documentWithCaptionMessage'
    ? ((corpo.message as Record<string, unknown> | undefined)?.documentMessage ?? {}) as Record<string, unknown>
    : corpo

  const texto = tipo === 'text'
    ? (typeof msg.conversation === 'string' ? msg.conversation : (corpo.text as string | undefined) ?? null)
    : ((documento.caption as string | undefined) ?? null)

  const base64 = typeof msg.base64 === 'string' && msg.base64 ? msg.base64 : null
  const midia = tipo !== 'text' && base64
    ? {
        base64,
        mimetype: ((documento.mimetype as string | undefined) ?? 'application/octet-stream').split(';')[0].trim(),
        nomeArquivo: (documento.fileName as string | undefined) ?? null,
      }
    : null

  if (tipo === 'text' && !texto) return null
  const deMim = dados?.key?.fromMe === true
  const nome = dados?.pushName?.trim() || null
  const jidAutor = [dados?.key?.participant, dados?.key?.participantAlt].find(j => j?.endsWith('@s.whatsapp.net'))
  return {
    telefone,
    grupo,
    autor: grupo && !deMim ? { telefone: jidAutor ? numeroDoJid(jidAutor) : null, nome } : null,
    deMim,
    id,
    nome: grupo ? null : nome,
    tipo,
    texto,
    midia,
  }
}

/** Prévia da conversa na lista, como o webhook da Meta faz; no grupo, com o nome de quem escreveu. */
export function previaDaMensagem(m: Pick<MensagemQr, 'tipo' | 'texto'> & { autor?: MensagemQr['autor'] }): string {
  const quem = m.autor ? `${m.autor.nome ?? m.autor.telefone ?? 'Participante'}: ` : ''
  if (m.tipo === 'text') return quem + (m.texto ?? '')
  const rotulo = { image: '📷 Imagem', audio: '🎤 Áudio', video: '🎬 Vídeo', document: '📎 Documento', sticker: '🏷️ Figurinha' }[m.tipo]
  return quem + (m.texto ? `${rotulo}: ${m.texto}` : rotulo)
}
