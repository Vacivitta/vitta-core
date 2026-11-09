import type { SupabaseClient } from '@supabase/supabase-js'

const TELEFONES_POR_CONSULTA = 200

/**
 * Quais destes telefones (forma canônica) já têm contato na unidade. É o que
 * impede reimportar o mesmo arquivo: desde a 150 o banco aceita outro negócio para
 * o mesmo telefone (liga ao contato), então "já existe" é decidido aqui. Consulta
 * em blocos: a lista vai na URL do PostgREST.
 */
export async function telefonesExistentes(
  supabase: SupabaseClient,
  unitId: string,
  telefones: readonly string[],
): Promise<{ existentes: Set<string>; erro: string | null }> {
  const existentes = new Set<string>()
  for (let i = 0; i < telefones.length; i += TELEFONES_POR_CONSULTA) {
    const bloco = telefones.slice(i, i + TELEFONES_POR_CONSULTA)
    const { data, error } = await supabase
      .from('contatos')
      .select('telefone_norm')
      .eq('unit_id', unitId)
      .is('responsavel_id', null)
      .in('telefone_norm', bloco)
    if (error) return { existentes, erro: error.message }
    for (const l of data ?? []) if (l.telefone_norm) existentes.add(l.telefone_norm as string)
  }
  return { existentes, erro: null }
}
