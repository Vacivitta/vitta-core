import type { SupabaseClient } from '@supabase/supabase-js'

const TELEFONES_POR_CONSULTA = 200

/**
 * Quais destes telefones (forma canônica) já têm lead na unidade. Consulta em
 * blocos: a lista vai na URL do PostgREST.
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
      .from('leads')
      .select('telefone_norm')
      .eq('unit_id', unitId)
      .in('telefone_norm', bloco)
    if (error) return { existentes, erro: error.message }
    for (const l of data ?? []) if (l.telefone_norm) existentes.add(l.telefone_norm as string)
  }
  return { existentes, erro: null }
}
