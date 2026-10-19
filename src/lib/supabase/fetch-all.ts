import type { PostgrestError } from '@supabase/supabase-js'

/** Limite de linhas por requisição do PostgREST no projeto (padrão do Supabase). */
const PAGE_SIZE = 1000

type PageResult<T> = PromiseLike<{ data: T[] | null; error: PostgrestError | null }>

/**
 * Busca todas as linhas de uma consulta, paginando de 1000 em 1000.
 * O Supabase corta qualquer `select` em 1000 linhas sem avisar — com mais de 1000
 * leads por unidade, listas e o funil ficavam incompletos.
 *
 * A consulta precisa de ordenação determinística (inclua `.order('id')` como
 * desempate), senão as páginas podem repetir ou pular linhas.
 *
 * @param page - Monta a consulta para o intervalo informado: `(from, to) => query.range(from, to)`
 * @param max - Teto opcional de linhas (ex.: últimas 2000 mensagens)
 * @returns Todas as linhas, ou o que foi lido até o erro
 *
 * @example
 * const { data } = await fetchAll((from, to) =>
 *   supabase.from('leads').select('id,nome').eq('unit_id', unitId).order('nome').order('id').range(from, to))
 */
export async function fetchAll<T>(
  page: (from: number, to: number) => PageResult<T>,
  max = Infinity,
): Promise<{ data: T[]; error: PostgrestError | null }> {
  const rows: T[] = []
  for (let from = 0; from < max; from += PAGE_SIZE) {
    const to = Math.min(from + PAGE_SIZE, max) - 1
    const { data, error } = await page(from, to)
    if (error) return { data: rows, error }
    rows.push(...(data ?? []))
    if (!data || data.length < to - from + 1) break
  }
  return { data: rows, error: null }
}
