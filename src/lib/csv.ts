/**
 * CSV de planilha (Excel BR, Google Planilhas, LibreOffice): leitura e escrita,
 * sem dependências. Regras puras, usadas no navegador e no servidor.
 */

export type Separador = ';' | ',' | '\t'

export type Codificacao = 'utf-8' | 'windows-1252'

const BOM = '﻿'

/** Arquivo binário do Excel (.xlsx é um zip; .xls antigo é OLE), que não é CSV. */
export function ehPlanilhaExcel(bytes: Uint8Array): boolean {
  const zip = bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04
  const ole = bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0
  return zip || ole
}

/**
 * Texto do arquivo. Tenta UTF-8 estrito; se algum byte não for UTF-8 válido, o
 * arquivo veio do "CSV (separado por vírgulas)" do Excel BR, que grava em
 * Windows-1252 (Latin-1 com aspas curvas e €): decodifica assim e avisa.
 */
export function decodificarArquivo(bytes: Uint8Array): { texto: string; codificacao: Codificacao } {
  let texto: string
  let codificacao: Codificacao = 'utf-8'
  try {
    texto = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes)
  } catch {
    texto = new TextDecoder('windows-1252').decode(bytes)
    codificacao = 'windows-1252'
  }
  return { texto: texto.startsWith(BOM) ? texto.slice(1) : texto, codificacao }
}

/** "SÃ£o Paulo": UTF-8 que já foi lido como Latin-1 e salvo de novo. */
export function pareceTextoCorrompido(texto: string): boolean {
  return /Ã[\u0080-¿]|Â[ -¿]/.test(texto)
}

/** Separador mais frequente fora de aspas na primeira linha; empate fica com `;` (Excel BR). */
export function detectarSeparador(texto: string): Separador {
  const contagem: Record<Separador, number> = { ';': 0, ',': 0, '\t': 0 }
  let entreAspas = false
  for (const c of texto.startsWith(BOM) ? texto.slice(1) : texto) {
    if (c === '"') entreAspas = !entreAspas
    else if (!entreAspas && (c === '\n' || c === '\r')) break
    else if (!entreAspas && (c === ';' || c === ',' || c === '\t')) contagem[c]++
  }
  if (contagem['\t'] > contagem[';'] && contagem['\t'] > contagem[',']) return '\t'
  return contagem[','] > contagem[';'] ? ',' : ';'
}

export interface CsvLido {
  /** Registros (uma linha da planilha cada), na ordem do arquivo, inclusive os vazios */
  registros: string[][]
  separador: Separador
  /** Terminou dentro de aspas: o arquivo está truncado ou tem aspas sem par */
  aspasAbertas: boolean
}

/**
 * Lê CSV no padrão RFC 4180: campo entre aspas pode ter separador, quebra de
 * linha e aspas duplicadas (""). Aceita CRLF, LF e CR. Uma quebra no fim do
 * arquivo não gera registro vazio.
 */
export function lerCsv(texto: string, separador: Separador = detectarSeparador(texto)): CsvLido {
  const s = texto.startsWith(BOM) ? texto.slice(1) : texto
  const registros: string[][] = []
  let registro: string[] = []
  let campo = ''
  let entreAspas = false
  let i = 0

  const fecharCampo = () => { registro.push(campo); campo = '' }
  const fecharRegistro = () => { fecharCampo(); registros.push(registro); registro = [] }

  while (i < s.length) {
    const c = s[i]
    if (entreAspas) {
      if (c === '"') {
        if (s[i + 1] === '"') { campo += '"'; i += 2; continue }
        entreAspas = false
      } else {
        campo += c
      }
      i++
      continue
    }
    if (c === '"' && campo === '') entreAspas = true
    else if (c === separador) fecharCampo()
    else if (c === '\r' || c === '\n') {
      fecharRegistro()
      if (c === '\r' && s[i + 1] === '\n') i++
    } else campo += c
    i++
  }
  if (campo !== '' || registro.length > 0 || entreAspas) fecharRegistro()

  return { registros, separador, aspasAbertas: entreAspas }
}

/** Registro sem nenhum valor (linha em branco ou só separadores). */
export function registroVazio(registro: readonly string[]): boolean {
  return registro.every(c => c.trim() === '')
}

/**
 * Célula que o Excel/Planilhas executaria como fórmula (= + - @, tab ou CR no
 * início) ganha um apóstrofo na frente, que a planilha mostra como texto.
 */
export function celulaSegura(valor: string): string {
  return /^[=+\-@\t\r]/.test(valor) ? "'" + valor : valor
}

/** Desfaz {@link celulaSegura} ao reimportar um CSV exportado pelo próprio app. */
export function desfazerCelulaSegura(valor: string): string {
  return /^'[=+\-@\t\r]/.test(valor) ? valor.slice(1) : valor
}

/** Uma linha CSV (sem a quebra), com proteção contra fórmula em toda célula. */
export function linhaCsv(celulas: readonly string[], separador: Separador = ';'): string {
  return celulas.map(c => {
    const v = celulaSegura(c)
    return v.includes(separador) || /["\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v
  }).join(separador)
}

/** Arquivo CSV completo: BOM UTF-8 (o Excel BR abre com acentos certos), `;` e CRLF. */
export function gerarCsv(linhas: readonly (readonly string[])[], separador: Separador = ';'): string {
  return BOM + linhas.map(l => linhaCsv(l, separador)).join('\r\n') + '\r\n'
}
