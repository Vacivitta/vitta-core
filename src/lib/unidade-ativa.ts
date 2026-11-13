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

export type EntradaAposLogin = { unidade: string | null; destino: '/funil' | '/atendimento' }

/**
 * Onde a pessoa entra depois do login (ADR 0006): com uma unidade, direto nela;
 * com várias, na visão de todas (a caixa de entrada), com a aba na última usada;
 * sem vínculo (admin da marca), como antes.
 */
export function entradaAposLogin(vinculos: readonly string[], ultima: string | null): EntradaAposLogin {
  if (vinculos.length === 0) return { unidade: ultima, destino: '/funil' }
  if (vinculos.length === 1) return { unidade: vinculos[0], destino: '/funil' }
  return { unidade: unidadeDaAba(ultima, vinculos[0], vinculos), destino: '/atendimento' }
}
