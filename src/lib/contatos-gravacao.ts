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
