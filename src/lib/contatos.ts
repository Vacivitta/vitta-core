import type { ContactRole, Contato, Lead, LeadContact } from '@/types/database'

/**
 * Etapa 5b do Contato (ADR 0001): o app lê a pessoa de `contatos` e continua
 * gravando no lead e em `lead_contacts`; o espelho da migração 148 copia para o
 * contato na mesma transação. Na 5c a gravação passa para o contato.
 */

/** Colunas de pessoa que o lead ainda carrega e que o espelho da 148 copia para o contato */
export type PessoaDoLead = Pick<Lead,
  | 'nome' | 'sobrenome' | 'telefone' | 'email' | 'cpf' | 'data_nascimento' | 'profissao'
  | 'cidade' | 'estado' | 'pais' | 'instagram' | 'site' | 'observacoes_cli'
  | 'wa_optin_at' | 'wa_optout_at'>

/** A pessoa do contato com os nomes de coluna do lead (observacoes → observacoes_cli) */
export function pessoaDoContato(c: Contato): PessoaDoLead {
  return {
    nome: c.nome, sobrenome: c.sobrenome, telefone: c.telefone, email: c.email, cpf: c.cpf,
    data_nascimento: c.data_nascimento, profissao: c.profissao, cidade: c.cidade, estado: c.estado,
    pais: c.pais, instagram: c.instagram, site: c.site, observacoes_cli: c.observacoes,
    wa_optin_at: c.wa_optin_at, wa_optout_at: c.wa_optout_at,
  }
}

/**
 * O lead com a pessoa lida do contato. Sem contato (ainda carregando, ou fora do
 * alcance da RLS), fica o que o lead traz.
 */
export function comPessoaDoContato<L extends PessoaDoLead>(lead: L, contato: Contato | null): L {
  return contato ? { ...lead, ...pessoaDoContato(contato) } : lead
}

const RELACOES: readonly ContactRole[] = ['filho', 'filha', 'dependente', 'outro']

/**
 * Os dependentes do contato no formato que as telas usam (o de `lead_contacts`).
 * O contato do dependente tem o id da linha de `lead_contacts` (148), então editar
 * e apagar pelo id continuam valendo.
 *
 * @param lista - contatos lidos; só os ligados a `contatoId` entram
 */
export function dependentesDoContato(lista: Contato[], contatoId: string, leadId: string): LeadContact[] {
  return lista
    .filter(c => c.responsavel_id === contatoId)
    .sort((a, b) => a.criado_em.localeCompare(b.criado_em))
    .map(c => {
      const relacao = RELACOES.find(r => r === c.relacao) ?? 'outro'
      return {
        id: c.id, lead_id: leadId, nome: c.nome, telefone: c.telefone, email: c.email,
        cargo: relacao, relacao, data_nascimento: c.data_nascimento, observacao: c.observacoes,
        unit_id: c.unit_id, created_at: c.criado_em,
      }
    })
}

type NomeDePessoa = { nome: string; sobrenome: string | null }

/** "Nome Sobrenome", ou null sem contato */
export function nomeDoContato(c: NomeDePessoa | null | undefined): string | null {
  if (!c) return null
  return [c.nome, c.sobrenome].filter(Boolean).join(' ')
}

/** Nome da pessoa da conversa: o do contato; enquanto a conversa não tem contato, o do lead */
export function nomeDaPessoaDaConversa(conv: { contato?: NomeDePessoa | null; lead?: NomeDePessoa | null }): string | null {
  return nomeDoContato(conv.contato) ?? nomeDoContato(conv.lead)
}

/** Nomes dos dependentes por responsável, para a busca de conversas achar pelo nome do filho */
export function nomesDosDependentes(linhas: { responsavel_id: string | null; nome: string }[]): Record<string, string> {
  const mapa: Record<string, string> = {}
  for (const l of linhas) {
    if (!l.responsavel_id) continue
    mapa[l.responsavel_id] = mapa[l.responsavel_id] ? `${mapa[l.responsavel_id]} ${l.nome}` : l.nome
  }
  return mapa
}

/** Negócio na ficha do contato: o que a aba de negócios mostra */
export interface NegocioDoContato {
  id:         string
  status:     'aberto' | 'ganho' | 'perdido'
  arquivado:  boolean
  created_at: string
  funil:      string | null
  etapa:      string | null
  cor:        string | null
  responsavel: string | null
  valor:      number | null
}

/** Abertos primeiro (os arquivados no fim), e dentro de cada grupo o mais recente antes */
export function ordenarNegocios<N extends Pick<NegocioDoContato, 'status' | 'arquivado' | 'created_at'>>(lista: N[]): N[] {
  const grupo = (n: N) => (n.arquivado ? 2 : n.status === 'aberto' ? 0 : 1)
  return [...lista].sort((a, b) => grupo(a) - grupo(b) || b.created_at.localeCompare(a.created_at))
}

/** O que o app pode gravar no contato (149: GRANT de UPDATE só nestas colunas) */
export type PessoaGravavel = Partial<Pick<Contato,
  | 'nome' | 'sobrenome' | 'telefone' | 'email' | 'cpf' | 'data_nascimento' | 'profissao'
  | 'cidade' | 'estado' | 'pais' | 'instagram' | 'site' | 'observacoes' | 'wa_optin_at' | 'wa_optout_at'>>

const COLUNAS_DE_PESSOA = [
  'nome', 'sobrenome', 'telefone', 'email', 'cpf', 'data_nascimento', 'profissao',
  'cidade', 'estado', 'pais', 'instagram', 'site', 'wa_optin_at', 'wa_optout_at',
] as const

/**
 * Separa o formulário do negócio: a pessoa vai para o contato (5c1), o resto para o
 * lead. observacoes_cli (nome no lead) vira observacoes (nome no contato).
 */
export function separarPessoaENegocio<F extends Record<string, unknown>>(form: F): {
  pessoa: PessoaGravavel
  negocio: Omit<F, (typeof COLUNAS_DE_PESSOA)[number] | 'observacoes_cli'>
} {
  const pessoa: Record<string, unknown> = {}
  const negocio: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(form)) {
    if ((COLUNAS_DE_PESSOA as readonly string[]).includes(k)) pessoa[k] = v
    else if (k === 'observacoes_cli') pessoa.observacoes = v
    else negocio[k] = v
  }
  return {
    pessoa: pessoa as PessoaGravavel,
    negocio: negocio as Omit<F, (typeof COLUNAS_DE_PESSOA)[number] | 'observacoes_cli'>,
  }
}

/**
 * Audiência de campanha com uma linha por telefone: uma pessoa com vários negócios
 * (150) recebe uma vez. Fica a linha com opt-in, se houver; senão a primeira.
 */
export function umPorTelefone<L extends { norm: string; wa_optin_at: string | null }>(lista: L[]): L[] {
  const porTelefone = new Map<string, L>()
  for (const l of lista) {
    const atual = porTelefone.get(l.norm)
    if (!atual || (!atual.wa_optin_at && l.wa_optin_at)) porTelefone.set(l.norm, l)
  }
  return [...porTelefone.values()]
}

/** Texto do aviso de pessoa já cadastrada, nas telas que criam negócio */
export function avisoPessoaExistente(p: { nome: string; negocios: number; abertos: number }): string {
  const negocios = p.negocios === 1 ? '1 negócio' : `${p.negocios} negócios`
  const abertos = p.abertos === 0 ? 'nenhum aberto' : p.abertos === 1 ? '1 aberto' : `${p.abertos} abertos`
  return `${p.nome} já está cadastrada com este telefone (${negocios}, ${abertos}). Salvar abre mais um negócio para ela.`
}
