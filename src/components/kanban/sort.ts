import type { LeadKanban } from '@/types/database'

/** Critérios de ordenação dos cards dentro de cada coluna do funil. */
export type KanbanSortMode =
  | 'atividade'
  | 'mais_tempo_etapa'
  | 'menos_tempo_etapa'
  | 'mais_recentes'
  | 'mais_antigos'
  | 'nome_az'
  | 'nome_za'
  | 'maior_valor'
  | 'proxima_tarefa'
  | 'sem_resposta'
  | 'manual'

export const KANBAN_SORT_OPTIONS: { value: KanbanSortMode; label: string }[] = [
  { value: 'atividade',         label: 'Atividade recente' },
  { value: 'mais_tempo_etapa',  label: 'Mais tempo na etapa' },
  { value: 'menos_tempo_etapa', label: 'Menos tempo na etapa' },
  { value: 'mais_recentes',     label: 'Cadastro mais recente' },
  { value: 'mais_antigos',      label: 'Cadastro mais antigo' },
  { value: 'nome_az',           label: 'Nome (A–Z)' },
  { value: 'nome_za',           label: 'Nome (Z–A)' },
  { value: 'maior_valor',       label: 'Maior valor' },
  { value: 'proxima_tarefa',    label: 'Próxima tarefa' },
  { value: 'sem_resposta',      label: 'Sem resposta há mais tempo' },
  { value: 'manual',            label: 'Manual (arrastar)' },
]

/** Cookie com a ordenação escolhida no funil (lido no servidor para a 1ª tela já vir ordenada). */
export const COOKIE_ORDENACAO_FUNIL = 'funil_sort_mode'

export const DEFAULT_KANBAN_SORT: KanbanSortMode = 'atividade'

/** Dados de conversa usados por alguns critérios, indexados por lead_id. */
export interface KanbanSortContext {
  unreadByLead:   Record<string, number>
  lastMsgByLead:  Record<string, string>
  /** Direção da última mensagem da conversa mais recente do lead */
  lastDirByLead:  Record<string, 'inbound' | 'outbound'>
}

const collator = new Intl.Collator('pt-BR', { sensitivity: 'base' })

const ts = (iso: string | null | undefined) => (iso ? new Date(iso).getTime() : NaN)

/** Ordena valores ausentes (NaN) sempre no fim, independente da direção. */
function byNumber(a: number, b: number, dir: 'asc' | 'desc'): number {
  const na = Number.isNaN(a), nb = Number.isNaN(b)
  if (na || nb) return na === nb ? 0 : na ? 1 : -1
  return dir === 'asc' ? a - b : b - a
}

/** Mesmo valor exibido no card: negociado → proposta → soma dos orçamentos. */
function leadValue(l: LeadKanban): number {
  const v = l.valor_negociado ?? l.valor_proposta ?? (Number(l.valor_orcamentos) || 0)
  return v > 0 ? v : NaN
}

/** Desempate estável: ordem manual e depois data de cadastro. */
function tiebreak(a: LeadKanban, b: LeadKanban): number {
  return (a.ordem ?? 0) - (b.ordem ?? 0) || byNumber(ts(a.created_at), ts(b.created_at), 'asc')
}

/**
 * Retorna uma cópia dos leads ordenada pelo critério escolhido.
 * Só "Atividade recente" coloca não lidas no topo; nos demais critérios a
 * ordenação escolhida vale para todos os cards.
 *
 * @param leads - Leads de uma coluna
 * @param mode - Critério de ordenação
 * @param ctx - Não lidas, última mensagem e direção por lead
 * @returns Nova lista ordenada
 */
export function sortKanbanLeads(leads: LeadKanban[], mode: KanbanSortMode, ctx: KanbanSortContext): LeadKanban[] {
  const { unreadByLead, lastMsgByLead, lastDirByLead } = ctx

  const compare = (a: LeadKanban, b: LeadKanban): number => {
    switch (mode) {
      case 'atividade': {
        const ua = (unreadByLead[a.id] ?? 0) > 0, ub = (unreadByLead[b.id] ?? 0) > 0
        if (ua !== ub) return ua ? -1 : 1
        return byNumber(ts(lastMsgByLead[a.id]), ts(lastMsgByLead[b.id]), 'desc')
      }
      case 'mais_tempo_etapa':  return byNumber(ts(a.stage_changed_at), ts(b.stage_changed_at), 'asc')
      case 'menos_tempo_etapa': return byNumber(ts(a.stage_changed_at), ts(b.stage_changed_at), 'desc')
      case 'mais_recentes':     return byNumber(ts(a.created_at), ts(b.created_at), 'desc')
      case 'mais_antigos':      return byNumber(ts(a.created_at), ts(b.created_at), 'asc')
      case 'nome_az':
      case 'nome_za': {
        const r = collator.compare(`${a.nome} ${a.sobrenome ?? ''}`.trim(), `${b.nome} ${b.sobrenome ?? ''}`.trim())
        return mode === 'nome_az' ? r : -r
      }
      case 'maior_valor':       return byNumber(leadValue(a), leadValue(b), 'desc')
      case 'proxima_tarefa':    return byNumber(ts(a.proxima_tarefa_data), ts(b.proxima_tarefa_data), 'asc')
      case 'sem_resposta': {
        // Cliente esperando (última mensagem foi dele): quem espera há mais tempo no topo
        const wa = lastDirByLead[a.id] === 'inbound', wb = lastDirByLead[b.id] === 'inbound'
        if (wa !== wb) return wa ? -1 : 1
        if (wa) return byNumber(ts(lastMsgByLead[a.id]), ts(lastMsgByLead[b.id]), 'asc')
        return byNumber(ts(lastMsgByLead[a.id]), ts(lastMsgByLead[b.id]), 'desc')
      }
      case 'manual':
      default:
        return 0
    }
  }

  return [...leads].sort((a, b) => compare(a, b) || tiebreak(a, b))
}
