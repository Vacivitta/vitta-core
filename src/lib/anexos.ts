/**
 * Regras dos anexos da ficha do lead (bucket privado `lead-anexos`, migração 128).
 * Sem imports com `@/`: os testes (`node --test`) importam este arquivo direto.
 */

export const ANEXOS_BUCKET = 'lead-anexos'

/** Mesmo limite do bucket e do CHECK de lead_anexos.tamanho. */
export const ANEXO_TAMANHO_MAXIMO = 20 * 1024 * 1024

/** Mesma lista do bucket e do CHECK de lead_anexos.mime. */
export const ANEXO_TIPOS = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'] as const
export type AnexoMime = (typeof ANEXO_TIPOS)[number]

const EXTENSOES: Record<AnexoMime, readonly string[]> = {
  'application/pdf': ['pdf'],
  'image/jpeg':      ['jpg', 'jpeg'],
  'image/png':       ['png'],
  'image/webp':      ['webp'],
  'image/heic':      ['heic'],
  'image/heif':      ['heif', 'heic'],
}

/** Para o `accept` do input de arquivo. O servidor não confia nele. */
export const ANEXO_ACCEPT = '.pdf,.jpg,.jpeg,.png,.webp,.heic,.heif,' + ANEXO_TIPOS.join(',')

export const ANEXO_ERRO_TIPO = 'Tipo de arquivo não permitido. Envie PDF, JPG, PNG, WebP ou HEIC.'
export const ANEXO_ERRO_TAMANHO = 'Arquivo maior que 20 MB.'
export const ANEXO_ERRO_VAZIO = 'O arquivo está vazio.'

const BRANDS_HEIC = new Set(['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis'])
const BRANDS_HEIF = new Set(['mif1', 'msf1', 'heif'])

function ascii(bytes: Uint8Array, inicio: number, fim: number): string {
  return String.fromCharCode(...bytes.subarray(inicio, fim))
}

function comeca(bytes: Uint8Array, assinatura: readonly number[]): boolean {
  return bytes.length >= assinatura.length && assinatura.every((b, i) => bytes[i] === b)
}

/**
 * Tipo do arquivo pela assinatura (primeiros bytes), não pelo MIME que o
 * navegador manda nem pela extensão, que o usuário controla.
 *
 * @param bytes - Início do arquivo (bastam 16 bytes)
 * @returns O tipo permitido ou `null` se não for nenhum deles
 */
export function detectarTipoAnexo(bytes: Uint8Array): AnexoMime | null {
  if (comeca(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) return 'application/pdf'
  if (comeca(bytes, [0xff, 0xd8, 0xff])) return 'image/jpeg'
  if (comeca(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png'
  if (bytes.length >= 12 && ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 12) === 'WEBP') return 'image/webp'
  // ISO BMFF: tamanho da caixa (4 bytes), 'ftyp' e a marca principal
  if (bytes.length >= 12 && ascii(bytes, 4, 8) === 'ftyp') {
    const marca = ascii(bytes, 8, 12)
    if (BRANDS_HEIC.has(marca)) return 'image/heic'
    if (BRANDS_HEIF.has(marca)) return 'image/heif'
  }
  return null
}

/**
 * Nome para mostrar e para o download: sem pasta, sem caracteres de controle nem
 * os que quebram nome de arquivo ou cabeçalho, até 120 caracteres mantendo a
 * extensão.
 *
 * @param nome - Nome que veio do navegador (`File.name`)
 */
export function sanitizarNomeArquivo(nome: string): string {
  let n = (nome ?? '').normalize('NFC')
  n = n.split(/[/\\]/).pop() ?? ''
  n = n.replace(/[\u0000-\u001f\u007f-\u009f<>:"|?*;%]/g, '').replace(/[​-‏‪-‮⁦-⁩]/g, '')
  n = n.replace(/\s+/g, ' ').trim().replace(/^\.+/, '').trim()
  if (!n) return 'arquivo'
  if (n.length > 120) {
    const ponto = n.lastIndexOf('.')
    const ext = ponto > 0 && n.length - ponto <= 10 ? n.slice(ponto) : ''
    n = n.slice(0, 120 - ext.length).trimEnd() + ext
  }
  return n
}

/**
 * Garante que a extensão do nome combina com o tipo detectado: um PDF chamado
 * `exame.exe` vira `exame.exe.pdf`, para o arquivo baixado abrir no programa certo.
 */
export function nomeComExtensao(nome: string, tipo: AnexoMime): string {
  const ponto = nome.lastIndexOf('.')
  const ext = ponto > 0 ? nome.slice(ponto + 1).toLowerCase() : ''
  if (EXTENSOES[tipo].includes(ext)) return nome
  return `${nome}.${EXTENSOES[tipo][0]}`
}

/**
 * Trecho do nome que vai na chave do storage: só ASCII seguro (o storage recusa
 * acentos e vários símbolos na chave), até 80 caracteres. O nome real fica na
 * coluna `nome`.
 */
export function nomeParaCaminho(nome: string): string {
  const s = nome
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
  return s.slice(0, 80).replace(/[-.]+$/, '') || 'arquivo'
}

export function prefixoAnexos(unitId: string, leadId: string): string {
  return `${unitId}/${leadId}/`
}

/** Tamanho legível: "850 KB", "1,4 MB". */
export function formatarTamanho(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} MB`
}
