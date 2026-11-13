import type { CampoLead, CamposDoLead, ObjetoCampo, TipoCampo, ValorCampo, ValorTipado } from '@/types/database'

// Regras dos campos personalizados. A chave e a validade do valor repetem as
// funções campo_chave_slug, campo_opcoes_validas e campo_valor_valido da
// migração 129; tests/db/campos_casos.json é conferido contra as duas.

export const TIPOS_CAMPO: readonly TipoCampo[] = [
  'texto', 'numero', 'moeda', 'data', 'selecao', 'multipla', 'sim_nao', 'telefone', 'email',
]

export const TIPO_CAMPO_LABELS: Record<TipoCampo, string> = {
  texto:    'Texto',
  numero:   'Número',
  moeda:    'Valor (R$)',
  data:     'Data',
  selecao:  'Lista (uma opção)',
  multipla: 'Lista (várias opções)',
  sim_nao:  'Sim / Não',
  telefone: 'Telefone',
  email:    'E-mail',
}

export function tipoTemOpcoes(tipo: TipoCampo): tipo is 'selecao' | 'multipla' {
  return tipo === 'selecao' || tipo === 'multipla'
}

const DE   = 'ÁÀÂÃÄÅáàâãäåªÉÈÊËéèêëÍÌÎÏíìîïÓÒÔÕÖóòôõöºÚÙÛÜúùûüÇçÑñÝýÿABCDEFGHIJKLMNOPQRSTUVWXYZ'
const PARA = 'aaaaaaaaaaaaaeeeeeeeeiiiiiiiiooooooooooouuuuuuuuccnnyyyabcdefghijklmnopqrstuvwxyz'
const TROCA = new Map(Array.from(DE, (c, i) => [c, PARA[i]]))

/** Chave que o banco gera para o rótulo (sem o sufixo _2, _3... de repetição). */
export function chaveDoRotulo(rotulo: string): string {
  const traduzido = Array.from(rotulo, c => TROCA.get(c) ?? c).join('')
  const chave = traduzido.replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40).replace(/^_+|_+$/g, '')
  return chave || 'campo'
}

/** Opções de seleção: 1 a 100 textos, sem repetir, sem espaços nas pontas. */
export function opcoesValidas(opcoes: unknown): opcoes is string[] {
  if (!Array.isArray(opcoes) || opcoes.length < 1 || opcoes.length > 100) return false
  if (!opcoes.every(o => typeof o === 'string' && o.trim() !== '' && o.trim() === o && o.length <= 100)) return false
  return new Set(opcoes).size === opcoes.length
}

const DATA_ISO = /^(19|2[01])\d{2}-\d{2}-\d{2}$/
const TELEFONE = /^[0-9 ()+.-]+$/
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function dataValida(s: string): boolean {
  if (!DATA_ISO.test(s)) return false
  const [ano, mes, dia] = s.split('-').map(Number)
  const d = new Date(Date.UTC(ano, mes - 1, dia))
  return d.getUTCFullYear() === ano && d.getUTCMonth() === mes - 1 && d.getUTCDate() === dia
}

function temDuasCasas(n: number): boolean {
  return Math.abs(Math.round(n * 100) - n * 100) < 1e-6
}

/** Mesma regra de campo_valor_valido (migração 129). */
export function valorValido(tipo: string, opcoes: unknown, valor: unknown): boolean {
  const lista = Array.isArray(opcoes) ? opcoes : null
  switch (tipo) {
    case 'texto':    return typeof valor === 'string' && valor.trim() !== '' && Array.from(valor).length <= 2000
    case 'numero':   return typeof valor === 'number' && Number.isFinite(valor)
    case 'moeda':    return typeof valor === 'number' && Number.isFinite(valor) && temDuasCasas(valor)
    case 'sim_nao':  return typeof valor === 'boolean'
    case 'data':     return typeof valor === 'string' && dataValida(valor)
    case 'selecao':  return typeof valor === 'string' && !!lista && lista.includes(valor)
    case 'multipla':
      return Array.isArray(valor) && valor.length > 0 && !!lista
        && valor.every(v => typeof v === 'string' && lista.includes(v))
        && new Set(valor).size === valor.length
    case 'telefone': {
      if (typeof valor !== 'string' || !TELEFONE.test(valor)) return false
      const digitos = valor.replace(/\D/g, '').length
      return digitos >= 8 && digitos <= 15
    }
    case 'email':    return typeof valor === 'string' && Array.from(valor).length <= 254 && EMAIL.test(valor)
    default:         return false
  }
}

/** "1.234,56", "1234,56", "1234.56" → número; vazio ou inválido → null. */
export function lerNumeroBR(texto: string): number | null {
  let s = texto.trim().replace(/^R\$\s*/i, '').replace(/\s/g, '')
  if (s === '') return null
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.')
  else if (/^-?\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '')
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

/** O que a ficha manda para o campo: texto digitado, marcação ou lista escolhida. */
export type EntradaCampo = string | boolean | string[]

export type ResultadoEntrada =
  | { ok: true; valor: ValorCampo | null }
  | { ok: false; erro: string }

/**
 * Converte o que foi digitado no valor a gravar (null = limpar o campo) e
 * valida com a mesma regra do banco.
 */
export function valorDaEntrada(campo: CampoLead, entrada: EntradaCampo): ResultadoEntrada {
  const texto = typeof entrada === 'string' ? entrada.trim() : null
  if (texto === '' || (Array.isArray(entrada) && entrada.length === 0)) return { ok: true, valor: null }

  let valor: unknown = entrada
  switch (campo.tipo) {
    case 'numero':
    case 'moeda': {
      const n = texto === null ? null : lerNumeroBR(texto)
      if (n === null) return { ok: false, erro: 'Digite um número' }
      valor = campo.tipo === 'moeda' ? Math.round(n * 100) / 100 : n
      break
    }
    case 'email':
      valor = texto?.toLowerCase()
      break
    case 'texto':
    case 'telefone':
    case 'data':
    case 'selecao':
      valor = texto
      break
    case 'multipla':
    case 'sim_nao':
      break
  }
  if (!valorValido(campo.tipo, campo.opcoes, valor)) {
    return { ok: false, erro: MENSAGEM_INVALIDO[campo.tipo] }
  }
  return { ok: true, valor: valor as ValorCampo }
}

const MENSAGEM_INVALIDO: Record<TipoCampo, string> = {
  texto:    'Texto de até 2000 caracteres',
  numero:   'Digite um número',
  moeda:    'Digite um valor em reais',
  data:     'Data inválida',
  selecao:  'Escolha uma das opções',
  multipla: 'Escolha entre as opções',
  sim_nao:  'Escolha Sim ou Não',
  telefone: 'Telefone com 8 a 15 dígitos',
  email:    'E-mail inválido',
}

/** Valor guardado com o tipo do campo, ou null se não bate (ex.: gravado antes de mudar opções). */
export function valorTipado(campo: CampoLead, valor: unknown): ValorTipado | null {
  if (valor === undefined || valor === null) return null
  switch (campo.tipo) {
    case 'numero':
    case 'moeda':
      return typeof valor === 'number' ? { tipo: campo.tipo, valor } : null
    case 'sim_nao':
      return typeof valor === 'boolean' ? { tipo: 'sim_nao', valor } : null
    case 'multipla':
      return Array.isArray(valor) && valor.every(v => typeof v === 'string') ? { tipo: 'multipla', valor } : null
    case 'texto':
    case 'data':
    case 'selecao':
    case 'telefone':
    case 'email':
      return typeof valor === 'string' ? { tipo: campo.tipo, valor } : null
  }
}

const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
const NUMERO = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 6 })

/** Texto para exibir: moeda em R$, data dd/mm/aaaa, Sim/Não, lista separada por vírgula. */
export function formatarValor(campo: CampoLead, valor: unknown): string {
  const v = valorTipado(campo, valor)
  if (!v) return valor === undefined || valor === null ? '' : String(valor)
  switch (v.tipo) {
    case 'moeda':    return BRL.format(v.valor)
    case 'numero':   return NUMERO.format(v.valor)
    case 'data': {
      const [ano, mes, dia] = v.valor.split('-')
      return dia && mes && ano ? `${dia}/${mes}/${ano}` : v.valor
    }
    case 'sim_nao':  return v.valor ? 'Sim' : 'Não'
    case 'multipla': return v.valor.join(', ')
    case 'texto':
    case 'selecao':
    case 'telefone':
    case 'email':
      return v.valor
  }
}

/** Valor do campo como texto para preencher o input de edição. */
export function entradaInicial(campo: CampoLead, valor: unknown): EntradaCampo {
  const v = valorTipado(campo, valor)
  if (!v) return campo.tipo === 'multipla' ? [] : ''
  switch (v.tipo) {
    case 'moeda':    return v.valor.toFixed(2).replace('.', ',')
    case 'numero':   return String(v.valor).replace('.', ',')
    case 'sim_nao':  return v.valor
    case 'multipla': return v.valor
    default:         return v.valor
  }
}

/** Campos que a ficha mostra para um lead: ativos, da unidade toda ou do funil dele. */
export function camposDoFunil(campos: CampoLead[], funnelId: string | null): CampoLead[] {
  return campos
    .filter(c => c.ativo && (c.funnel_id === null || c.funnel_id === funnelId))
    .sort((a, b) => a.ordem - b.ordem || a.rotulo.localeCompare(b.rotulo, 'pt-BR'))
}

/** Rótulo de onde o campo é guardado, para a configuração e a ficha. */
export const OBJETO_CAMPO_LABELS: Record<ObjetoCampo, string> = {
  negocio: 'Do negócio',
  contato: 'Da pessoa',
}

/**
 * Separa valores de campos entre o negócio (leads.campos) e a pessoa
 * (contatos.campos), pelo objeto de cada definição. Chave sem definição fica no
 * negócio, onde o banco a recusa com a mensagem certa.
 */
export function separarCampos(
  definicoes: readonly Pick<CampoLead, 'chave' | 'objeto'>[],
  valores: CamposDoLead,
): { negocio: CamposDoLead; pessoa: CamposDoLead } {
  const daPessoa = new Set(definicoes.filter(d => d.objeto === 'contato').map(d => d.chave))
  const negocio: CamposDoLead = {}
  const pessoa: CamposDoLead = {}
  for (const [k, v] of Object.entries(valores)) (daPessoa.has(k) ? pessoa : negocio)[k] = v
  return { negocio, pessoa }
}

/** leads.campos com uma chave trocada (valor null tira a chave). */
export function comValor(campos: CamposDoLead, chave: string, valor: ValorCampo | null): CamposDoLead {
  const novo = { ...campos }
  if (valor === null) delete novo[chave]
  else novo[chave] = valor
  return novo
}
