/**
 * Regras puras de empresas e tickets (147), testadas em tests/tickets.test.mjs.
 */
import type { TicketPrioridade } from '@/types/database'

/** CNPJ só com dígitos; null se vazio. Recusa o que não tiver 14 dígitos. */
export function cnpjParaGravar(entrada: string): { cnpj: string | null; erro: string | null } {
  const digitos = entrada.replace(/\D/g, '')
  if (!digitos) return { cnpj: null, erro: null }
  if (digitos.length !== 14) return { cnpj: null, erro: 'CNPJ precisa de 14 dígitos' }
  return { cnpj: digitos, erro: null }
}

/** 12345678000190 → 12.345.678/0001-90 */
export function formatarCnpj(cnpj: string | null): string {
  if (!cnpj || cnpj.length !== 14) return cnpj ?? ''
  return `${cnpj.slice(0, 2)}.${cnpj.slice(2, 5)}.${cnpj.slice(5, 8)}/${cnpj.slice(8, 12)}-${cnpj.slice(12)}`
}

const PESO: Record<TicketPrioridade, number> = { urgente: 0, alta: 1, media: 2, baixa: 3 }

interface TicketOrdenavel { prioridade: TicketPrioridade; status: string; criado_em: string; stage_id: string | null }

/** Abertos antes dos resolvidos; depois a prioridade; depois o mais antigo primeiro (fila). */
export function ordenarTickets<T extends TicketOrdenavel>(tickets: readonly T[]): T[] {
  return [...tickets].sort((a, b) =>
    (a.status === 'resolvido' ? 1 : 0) - (b.status === 'resolvido' ? 1 : 0)
    || PESO[a.prioridade] - PESO[b.prioridade]
    || a.criado_em.localeCompare(b.criado_em))
}

/**
 * Colunas do kanban: uma por etapa, na ordem do funil, e "Sem etapa" no começo
 * quando houver ticket sem etapa (ou com etapa apagada).
 */
export function colunasDoKanban<T extends TicketOrdenavel>(
  etapas: readonly { id: string; nome: string; ordem: number }[],
  tickets: readonly T[],
): { id: string | null; nome: string; tickets: T[] }[] {
  const ordenadas = [...etapas].sort((a, b) => a.ordem - b.ordem)
  const ids = new Set(ordenadas.map(e => e.id))
  const semEtapa = tickets.filter(t => !t.stage_id || !ids.has(t.stage_id))
  const colunas = ordenadas.map(e => ({ id: e.id as string | null, nome: e.nome, tickets: ordenarTickets(tickets.filter(t => t.stage_id === e.id)) }))
  return semEtapa.length ? [{ id: null, nome: 'Sem etapa', tickets: ordenarTickets(semEtapa) }, ...colunas] : colunas
}
