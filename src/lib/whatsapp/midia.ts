const MB = 1024 * 1024

/** Teto do app para qualquer mídia (o proxy do Next corta o corpo em 21 MB: next.config.ts) */
export const MIDIA_TAMANHO_MAXIMO = 20 * MB

/** Corpo multipart aceito: o arquivo mais a folga dos cabeçalhos e dos outros campos */
export const MIDIA_CORPO_MAXIMO = MIDIA_TAMANHO_MAXIMO + 64 * 1024

export type TipoMidia = 'image' | 'video' | 'audio' | 'document'

/** Menor entre o limite da Meta (imagem 5 MB, áudio/vídeo 16 MB, documento 100 MB) e o teto do app */
export const LIMITE_POR_TIPO: Readonly<Record<TipoMidia, number>> = {
  image:    5 * MB,
  video:    16 * MB,
  audio:    16 * MB,
  document: MIDIA_TAMANHO_MAXIMO,
}

const NOME_DO_TIPO: Readonly<Record<TipoMidia, string>> = {
  image: 'Imagem', video: 'Vídeo', audio: 'Áudio', document: 'Arquivo',
}

export const MIDIA_ERRO_CORPO = `Arquivo maior que ${MIDIA_TAMANHO_MAXIMO / MB} MB: o WhatsApp não envia arquivos desse tamanho por aqui.`

/**
 * Tipo da mensagem do WhatsApp para o MIME do arquivo.
 *
 * @param mime - MIME já normalizado (sem parâmetros, minúsculo)
 */
export function tipoMidia(mime: string): TipoMidia {
  if (mime.startsWith('image/')) return 'image'
  if (mime.startsWith('video/')) return 'video'
  if (mime.startsWith('audio/')) return 'audio'
  return 'document'
}

/**
 * Confere o tamanho do arquivo contra o limite do tipo.
 *
 * @param mime - MIME do arquivo (pode vir com parâmetros, ex.: `audio/webm;codecs=opus`)
 * @param tamanho - Tamanho em bytes
 * @returns Mensagem para o usuário, ou null se cabe
 */
export function erroTamanhoMidia(mime: string, tamanho: number): string | null {
  const tipo = tipoMidia(mime.split(';')[0].trim().toLowerCase())
  const limite = LIMITE_POR_TIPO[tipo]
  if (tamanho <= limite) return null
  return `${NOME_DO_TIPO[tipo]} maior que ${limite / MB} MB: o WhatsApp não aceita. Reduza o arquivo antes de enviar.`
}

/**
 * Corpo declarado (Content-Length) acima do aceito. Sem o cabeçalho (envio em
 * partes) não decide: o tamanho do arquivo é conferido depois de ler.
 *
 * @param contentLength - Valor do cabeçalho Content-Length
 */
export function corpoGrandeDemais(contentLength: string | null): boolean {
  const tamanho = Number(contentLength ?? 0)
  return Number.isFinite(tamanho) && tamanho > MIDIA_CORPO_MAXIMO
}
