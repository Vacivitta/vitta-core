interface NotificacaoAbrivel {
  type:      string
  quote_id:  string | null
  lead_id:   string | null
  ticket_id?: string | null
}

/** Página que a notificação abre, ou null quando ela só informa. */
export function destinoDaNotificacao(n: NotificacaoAbrivel): string | null {
  if (n.quote_id && (n.type === 'quote_expiring' || n.type === 'quote_expirado')) {
    return `/orcamento?quote_id=${n.quote_id}`
  }
  if (n.type === 'conexao_caiu') return '/configuracoes/conexoes'
  if (n.ticket_id) return `/tickets?ticket=${n.ticket_id}`
  if (n.lead_id) {
    return `/funil?lead=${n.lead_id}${n.type === 'mention_note' ? '&tab=Anotações' : ''}`
  }
  return null
}

/**
 * Unidade para a qual trocar antes de abrir a notificação: a dela, quando não é a
 * ativa e o usuário está vinculado a ela. Sem vínculo (admin da marca vendo o aviso
 * de outra unidade), abre sem trocar.
 */
export function unidadeParaAbrir(
  unidadeDaNotificacao: string,
  unidadeAtiva: string | null,
  minhasUnidades: readonly string[],
): string | null {
  if (unidadeDaNotificacao === unidadeAtiva) return null
  return minhasUnidades.includes(unidadeDaNotificacao) ? unidadeDaNotificacao : null
}
