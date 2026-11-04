import type { CampoLead, CamposDoLead } from '@/types/database'

// Campos obrigatórios por etapa (migração 130). funnel_stages.campos_obrigatorios
// guarda chaves de campos personalizados e campos fixos do lead com prefixo
// 'lead:'. A lista de fixos é a de campos_fixos_lead() no banco;
// tests/db/obrigatorios_fixos.json é conferido contra as duas.

export const CAMPOS_FIXOS = [
  { chave: 'lead:email',           coluna: 'email',           rotulo: 'E-mail' },
  { chave: 'lead:telefone',        coluna: 'telefone',        rotulo: 'Telefone' },
  { chave: 'lead:sobrenome',       coluna: 'sobrenome',       rotulo: 'Sobrenome' },
  { chave: 'lead:cpf',             coluna: 'cpf',             rotulo: 'CPF' },
  { chave: 'lead:data_nascimento', coluna: 'data_nascimento', rotulo: 'Data de nascimento' },
  { chave: 'lead:profissao',       coluna: 'profissao',       rotulo: 'Profissão' },
  { chave: 'lead:cidade',          coluna: 'cidade',          rotulo: 'Cidade' },
  { chave: 'lead:estado',          coluna: 'estado',          rotulo: 'Estado' },
  { chave: 'lead:origem',          coluna: 'origem',          rotulo: 'Origem' },
  { chave: 'lead:responsavel_id',  coluna: 'responsavel_id',  rotulo: 'Responsável' },
] as const

export type CampoFixo = (typeof CAMPOS_FIXOS)[number]
export type ColunaFixa = CampoFixo['coluna']
/** Valores das colunas fixas do lead que uma etapa pode exigir. */
export type ValoresFixos = Partial<Record<ColunaFixa, string | null>>

/** SQLSTATE de fn_lead_obrigatorios quando falta campo para entrar na etapa. */
export const ERRO_OBRIGATORIOS = 'VC001'

export function campoFixo(chave: string): CampoFixo | undefined {
  return CAMPOS_FIXOS.find(f => f.chave === chave)
}

export interface Faltando {
  etapaId:  string
  faltando: string[]
}

/** Chaves que faltam, lidas do HINT do erro VC001; null para qualquer outro erro. */
export function faltandoDoErro(err: unknown): Faltando | null {
  if (typeof err !== 'object' || err === null) return null
  const { code, hint } = err as { code?: unknown; hint?: unknown }
  if (code !== ERRO_OBRIGATORIOS || typeof hint !== 'string') return null
  let dados: unknown
  try { dados = JSON.parse(hint) } catch { return null }
  if (typeof dados !== 'object' || dados === null) return null
  const { etapa_id, faltando } = dados as { etapa_id?: unknown; faltando?: unknown }
  if (typeof etapa_id !== 'string' || !Array.isArray(faltando)) return null
  const chaves = faltando.filter((c): c is string => typeof c === 'string')
  if (chaves.length === 0) return null
  return { etapaId: etapa_id, faltando: chaves }
}

function vazio(v: unknown): boolean {
  return v === null || v === undefined || (typeof v === 'string' && v.trim() === '')
}

/**
 * Mesma regra de fn_lead_obrigatorios: o que falta ao lead para entrar numa
 * etapa. Campo personalizado desativado, de outro funil ou desconhecido não conta.
 */
export function faltandoNoLead(
  exigidos: readonly string[],
  lead: ValoresFixos & { funnel_id: string | null; campos: CamposDoLead },
  definicoes: readonly CampoLead[],
): string[] {
  return exigidos.filter(chave => {
    const fixo = campoFixo(chave)
    if (fixo) return vazio(lead[fixo.coluna])
    if (chave.startsWith('lead:')) return false
    const def = definicoes.find(d => d.chave === chave)
    if (!def || !def.ativo || (def.funnel_id !== null && def.funnel_id !== lead.funnel_id)) return false
    return vazio(lead.campos[chave])
  })
}

/** Rótulo para exibir; chave de campo apagado ou desconhecido aparece como está. */
export function rotuloObrigatorio(chave: string, definicoes: readonly CampoLead[]): string {
  return campoFixo(chave)?.rotulo ?? definicoes.find(d => d.chave === chave)?.rotulo ?? chave
}

export interface OpcaoObrigatorio {
  chave:      string
  rotulo:     string
  desativado: boolean
}

/**
 * O que a configuração da etapa oferece: os fixos, os campos ativos da unidade
 * ou do funil e, para poder tirar, os já escolhidos que foram desativados.
 */
export function opcoesObrigatorios(
  definicoes: readonly CampoLead[], funnelId: string, escolhidos: readonly string[],
): { fixos: OpcaoObrigatorio[]; personalizados: OpcaoObrigatorio[] } {
  const doFunil = definicoes
    .filter(d => d.funnel_id === null || d.funnel_id === funnelId)
    .filter(d => d.ativo || escolhidos.includes(d.chave))
    .sort((a, b) => a.ordem - b.ordem || a.rotulo.localeCompare(b.rotulo, 'pt-BR'))
  return {
    fixos: CAMPOS_FIXOS.map(f => ({ chave: f.chave, rotulo: f.rotulo, desativado: false })),
    personalizados: doFunil.map(d => ({ chave: d.chave, rotulo: d.rotulo, desativado: !d.ativo })),
  }
}

/** Liga ou desliga uma exigência mantendo a ordem em que foram escolhidas. */
export function alternarObrigatorio(escolhidos: readonly string[], chave: string): string[] {
  return escolhidos.includes(chave) ? escolhidos.filter(c => c !== chave) : [...escolhidos, chave]
}
