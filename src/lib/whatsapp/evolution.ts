/**
 * Cliente do conector de WhatsApp por QR Code (Evolution API 2.3, ADR 0002).
 *
 * Só roda no servidor: a chave global da Evolution dá controle de todas as
 * instâncias. Cada conexão `qrcode` tem uma instância (`conexoes.instancia`). A
 * Evolution guarda só a sessão; mensagens, contatos e conversas ficam no VittaDesk
 * (o webhook dela entrega tudo em `/api/whatsapp/qr/webhook`).
 *
 * Variáveis: EVOLUTION_URL, EVOLUTION_API_KEY, EVOLUTION_WEBHOOK_URL (onde a
 * Evolution alcança o app) e EVOLUTION_WEBHOOK_SECRET (assina o JWT do webhook).
 */

interface ConfigEvolution { url: string; apiKey: string; webhookUrl: string; webhookSecret: string }

/** Configuração da Evolution, ou `null` se o conector não está configurado neste ambiente. */
export function configEvolution(): ConfigEvolution | null {
  const url = process.env.EVOLUTION_URL?.replace(/\/+$/, '')
  const apiKey = process.env.EVOLUTION_API_KEY
  const webhookUrl = process.env.EVOLUTION_WEBHOOK_URL
  const webhookSecret = process.env.EVOLUTION_WEBHOOK_SECRET
  if (!url || !apiKey || !webhookUrl || !webhookSecret) return null
  return { url, apiKey, webhookUrl, webhookSecret }
}

export class ErroEvolution extends Error {
  constructor(message: string, readonly status: number) { super(message) }
}

async function chamar<T>(metodo: 'GET' | 'POST' | 'DELETE', caminho: string, corpo?: unknown): Promise<T> {
  const config = configEvolution()
  if (!config) throw new ErroEvolution('Conector de QR Code não configurado', 503)
  const res = await fetch(`${config.url}${caminho}`, {
    method: metodo,
    headers: { apikey: config.apiKey, 'Content-Type': 'application/json' },
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
    signal: AbortSignal.timeout(20_000),
  })
  const texto = await res.text()
  if (!res.ok) {
    // A resposta de erro da Evolution não traz segredo; corta para não lotar o log
    throw new ErroEvolution(`Evolution ${metodo} ${caminho.split('/').slice(0, 3).join('/')}: ${res.status} ${texto.slice(0, 200)}`, res.status)
  }
  return (texto ? JSON.parse(texto) : {}) as T
}

/** Eventos que o VittaDesk recebe de cada instância. */
export const EVENTOS_WEBHOOK = ['MESSAGES_UPSERT', 'CONNECTION_UPDATE', 'QRCODE_UPDATED'] as const

/**
 * Cria a instância da conexão, já com o webhook assinado (o `jwt_key` faz a
 * Evolution mandar `Authorization: Bearer <JWT HS256 de 10 min>`). Grupos entram
 * no Atendimento (entrega 3 da Fase 3·2).
 *
 * @returns o QR Code em data URL, quando a Evolution já o devolve
 */
export async function criarInstancia(instancia: string): Promise<string | null> {
  const config = configEvolution()
  if (!config) throw new ErroEvolution('Conector de QR Code não configurado', 503)
  const res = await chamar<{ qrcode?: { base64?: string } }>('POST', '/instance/create', {
    instanceName: instancia,
    integration: 'WHATSAPP-BAILEYS',
    qrcode: true,
    groupsIgnore: false,
    rejectCall: false,
    alwaysOnline: false,
    readMessages: false,
    readStatus: false,
    syncFullHistory: false,
    webhook: {
      enabled: true,
      url: config.webhookUrl,
      byEvents: false,
      base64: true,
      headers: { jwt_key: config.webhookSecret },
      events: EVENTOS_WEBHOOK,
    },
  })
  return res.qrcode?.base64 ?? null
}

/**
 * Liga as mensagens de grupo numa instância criada antes da entrega 3 (que nascia
 * com groupsIgnore). Idempotente; o webhook chama ao conectar.
 */
export async function receberGrupos(instancia: string): Promise<void> {
  await chamar('POST', `/settings/set/${encodeURIComponent(instancia)}`, {
    groupsIgnore: false, rejectCall: false, alwaysOnline: false, readMessages: false, readStatus: false, syncFullHistory: false,
  })
}

/** Nome (assunto) do grupo, ou `null` se a Evolution não souber. */
export async function nomeDoGrupo(instancia: string, grupoId: string): Promise<string | null> {
  const res = await chamar<{ subject?: string }>('GET',
    `/group/findGroupInfos/${encodeURIComponent(instancia)}?groupJid=${encodeURIComponent(`${grupoId}@g.us`)}`)
  return res.subject?.trim() || null
}

/** Pede um QR Code novo (ou o atual) para ler no celular. */
export async function qrCodeDaInstancia(instancia: string): Promise<string | null> {
  const res = await chamar<{ base64?: string }>('GET', `/instance/connect/${encodeURIComponent(instancia)}`)
  return res.base64 ?? null
}

/** Estado da sessão: 'open' (conectada), 'connecting' ou 'close'. */
export async function estadoDaInstancia(instancia: string): Promise<string | null> {
  const res = await chamar<{ instance?: { state?: string } }>('GET', `/instance/connectionState/${encodeURIComponent(instancia)}`)
  return res.instance?.state ?? null
}

/** Desconecta o número e apaga a instância (a sessão some da Evolution). */
export async function apagarInstancia(instancia: string): Promise<void> {
  const nome = encodeURIComponent(instancia)
  await chamar('DELETE', `/instance/logout/${nome}`).catch(() => undefined)
  await chamar('DELETE', `/instance/delete/${nome}`)
}

interface RespostaEnvio { key?: { id?: string } }

/** Envia texto. @returns o id da mensagem no WhatsApp */
export async function enviarTextoQr(instancia: string, numero: string, texto: string): Promise<string | null> {
  const res = await chamar<RespostaEnvio>('POST', `/message/sendText/${encodeURIComponent(instancia)}`, { number: numero, text: texto })
  return res.key?.id ?? null
}

/** Envia mídia em base64 (imagem, vídeo, documento) ou áudio. @returns o id da mensagem no WhatsApp */
export async function enviarMidiaQr(
  instancia: string,
  numero: string,
  midia: { tipo: 'image' | 'video' | 'document' | 'audio'; base64: string; mimetype: string; nomeArquivo?: string; legenda?: string },
): Promise<string | null> {
  const nome = encodeURIComponent(instancia)
  const res = midia.tipo === 'audio'
    ? await chamar<RespostaEnvio>('POST', `/message/sendWhatsAppAudio/${nome}`, { number: numero, audio: midia.base64 })
    : await chamar<RespostaEnvio>('POST', `/message/sendMedia/${nome}`, {
        number: numero,
        mediatype: midia.tipo,
        mimetype: midia.mimetype,
        media: midia.base64,
        fileName: midia.nomeArquivo,
        caption: midia.legenda,
      })
  return res.key?.id ?? null
}
