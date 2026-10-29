/**
 * Resumo de erro para log, sem dados de pessoas: só código e mensagem.
 *
 * Erros do Postgres/PostgREST trazem em `details` a linha que falhou (telefone,
 * nome, texto da mensagem, token) e respostas da Meta podem trazer o número do
 * destinatário em `contacts`. Por isso nunca registre o objeto inteiro.
 *
 * @param err - Erro do Supabase, da Meta (`{ error: {...} }`) ou exceção
 * @returns Texto curto com código e mensagem
 */
export function resumoErro(err: unknown): string {
  if (!err) return 'sem detalhe'
  if (err instanceof Error) return err.message
  if (typeof err === 'object') {
    const e = err as {
      code?: unknown; message?: unknown
      error?: { code?: unknown; error_subcode?: unknown; message?: unknown }
    }
    if (e.error && typeof e.error === 'object') {
      const m = e.error
      return `meta code=${String(m.code ?? '?')}${m.error_subcode ? ` subcode=${String(m.error_subcode)}` : ''} ${String(m.message ?? '')}`.trim()
    }
    if (e.code !== undefined || e.message !== undefined) {
      return `${String(e.code ?? '')} ${String(e.message ?? '')}`.trim()
    }
  }
  return 'erro sem formato conhecido'
}
