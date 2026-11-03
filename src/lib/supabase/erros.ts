/** SQLSTATE do Postgres para violação de índice único (ex.: telefone repetido na unidade, migração 122). */
export const VIOLACAO_UNICA = '23505'

export function isViolacaoUnica(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: unknown }).code === VIOLACAO_UNICA
}
