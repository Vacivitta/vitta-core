import { createClient } from '@/lib/supabase/client'
import type { Contato } from '@/types/database'
import type { PessoaGravavel } from '@/lib/contatos'

/**
 * Grava a pessoa no contato titular (149). O banco copia para os negócios dele.
 * Telefone repetido na unidade sobe como erro 23505 (isViolacaoUnica).
 *
 * @returns o contato gravado
 * @throws se o banco recusar ou se nenhuma linha mudar (contato fora do alcance)
 */
export async function gravarPessoa(contatoId: string, pessoa: PessoaGravavel): Promise<Contato> {
  const { data, error } = await createClient()
    .from('contatos').update(pessoa).eq('id', contatoId).select('*')
  if (error) throw error
  const gravado = data?.[0]
  if (!gravado) throw new Error('Não foi possível gravar o contato: ele não está ao seu alcance.')
  return gravado as Contato
}

/** Pessoa que já tem este telefone na unidade, com a contagem dos negócios dela */
export interface PessoaExistente {
  id:       string
  nome:     string
  negocios: number
  abertos:  number
}

/**
 * Desde a 150 o banco não recusa mais criar lead com um telefone que já existe: o
 * lead vira mais um negócio da pessoa. As telas de criação perguntam antes.
 *
 * @param norm - telefone na forma canônica (normalizarTelefone); null não procura
 */
export async function pessoaDoTelefone(unitId: string | null, norm: string | null): Promise<PessoaExistente | null> {
  if (!unitId || !norm) return null
  const { data } = await createClient()
    .from('contatos').select('id, nome, sobrenome, leads(status, arquivado)')
    .eq('unit_id', unitId).is('responsavel_id', null).eq('telefone_norm', norm)
    .maybeSingle()
  if (!data) return null
  const negocios = (data.leads ?? []) as { status: string; arquivado: boolean }[]
  return {
    id: data.id as string,
    nome: [data.nome, data.sobrenome].filter(Boolean).join(' '),
    negocios: negocios.length,
    abertos: negocios.filter(n => n.status === 'aberto' && !n.arquivado).length,
  }
}
