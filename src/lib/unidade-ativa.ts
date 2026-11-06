/** Cookie com a unidade da aba em foco; cada aba o reescreve ao ganhar foco. */
export const COOKIE_UNIDADE = 'vd_unidade'

/**
 * Unidade ativa: a pedida pela aba, se o usuário está vinculado a ela; senão a
 * última usada (profiles.unit_id), que vale para aba nova e para o admin da marca.
 */
export function unidadeDaAba(
  pedida: string | null | undefined,
  ultima: string | null,
  vinculos: readonly string[],
): string | null {
  if (pedida && vinculos.includes(pedida)) return pedida
  return ultima
}
