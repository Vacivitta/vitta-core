export type AlvoExclusao = 'etapa' | 'funil'

/**
 * Mensagem para quando o funil ou a etapa é filtro de automação por tempo
 * (wa_timed_automations.filter_funnel_id/filter_stage_id ON DELETE RESTRICT,
 * migração 135): sem o filtro a automação passaria a valer para todos.
 *
 * @param alvo - O que se tentou excluir
 * @param automacoes - Nomes das automações que usam o funil/etapa como filtro
 * @returns Texto para a tela, ou null se nenhuma automação usa
 */
export function mensagemUsadaPorAutomacao(alvo: AlvoExclusao, automacoes: readonly string[]): string | null {
  const nomes = [...new Set(automacoes.map(n => n.trim() || 'sem nome'))]
  if (nomes.length === 0) return null
  const oQue = alvo === 'etapa' ? 'Esta etapa' : 'Este funil'
  const lista = nomes.map(n => `"${n}"`).join(', ')
  const plural = nomes.length > 1
  return `${oQue} é usad${alvo === 'etapa' ? 'a' : 'o'} como filtro pela${plural ? 's' : ''} automaç${plural ? 'ões' : 'ão'} ${lista}. `
    + `Exclua ou edite ${plural ? 'essas automações' : 'essa automação'} em Configurações > Automações antes de excluir.`
}

/**
 * Mensagem para a recusa do banco por referência (23503) que a conferência
 * prévia não previu (outra tela gravou no meio, ou o filtro é de outra unidade).
 *
 * @param alvo - O que se tentou excluir
 * @param erro - Erro devolvido pelo Supabase
 * @returns Texto para a tela, ou null se o erro não é de referência
 */
export function mensagemRecusaPorReferencia(alvo: AlvoExclusao, erro: { code?: string } | null): string | null {
  if (erro?.code !== '23503') return null
  return `${alvo === 'etapa' ? 'Esta etapa' : 'Este funil'} ainda está em uso (por leads, por uma automação ou por um horário de atendimento). `
    + 'Atualize a página e confira os leads, as automações e os horários antes de excluir.'
}
