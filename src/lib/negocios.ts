import type { StatusLead } from '@/types/database'

/**
 * Etapa 5c2 do Contato (ADR 0001): um contato pode ter vários negócios. Estas
 * regras decidem qual negócio do contato recebe uma mensagem ou uma conversa.
 */

export interface NegocioResumo {
  id:         string
  status:     StatusLead
  arquivado:  boolean
  stage_id:   string | null
  created_at: string
}

const maisRecente = <N extends NegocioResumo>(lista: N[]): N | null =>
  lista.reduce<N | null>((m, n) => (!m || n.created_at > m.created_at ? n : m), null)

/**
 * O negócio que representa o contato agora: o aberto e não arquivado mais
 * recente; senão o não arquivado mais recente; senão o mais recente.
 */
export function escolherNegocio<N extends NegocioResumo>(negocios: N[]): N | null {
  return maisRecente(negocios.filter(n => n.status === 'aberto' && !n.arquivado))
    ?? maisRecente(negocios.filter(n => !n.arquivado))
    ?? maisRecente(negocios)
}

export type AcaoDaMensagem<N extends NegocioResumo = NegocioResumo> =
  | { tipo: 'usar'; negocio: N }
  | { tipo: 'desarquivar'; negocio: N }
  | { tipo: 'novo' }

/**
 * Mensagem recebida de um contato (substitui a reabertura do negócio fechado):
 * - negócio aberto e não arquivado: a mensagem vai para ele (o mais recente);
 * - negócio aberto, mas arquivado: desarquiva (saiu do quadro sem ser fechado);
 * - só negócios ganhos ou perdidos, ou nenhum: abre um negócio novo. O ganho e o
 *   perdido ficam como estão, com o histórico deles.
 */
export function acaoDaMensagem<N extends NegocioResumo>(negocios: N[]): AcaoDaMensagem<N> {
  const abertos = negocios.filter(n => n.status === 'aberto')
  const ativo = maisRecente(abertos.filter(n => !n.arquivado))
  if (ativo) return { tipo: 'usar', negocio: ativo }
  const arquivado = maisRecente(abertos)
  if (arquivado) return { tipo: 'desarquivar', negocio: arquivado }
  return { tipo: 'novo' }
}
