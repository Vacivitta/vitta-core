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
  ganho_em:   string | null
}

/**
 * Por quantos dias depois do ganho as mensagens do cliente continuam no negócio
 * ganho (agendar e aplicar as doses fechadas), em vez de abrir um negócio novo.
 */
export const DIAS_ATENDIMENTO_APOS_GANHO = 180

const DIA_MS = 24 * 60 * 60 * 1000

/** Dias que um negócio ganho continua visível no quadro do funil depois do ganho. */
export const DIAS_GANHO_NO_QUADRO = 7

/**
 * Negócio ganho há mais de DIAS_GANHO_NO_QUADRO dias sai do quadro de vendas: o
 * cliente segue em Clientes e na ficha, e as mensagens dele vão para esse negócio
 * (acaoDaMensagem) sem criar cards repetidos.
 *
 * @param agora - Momento atual (ms)
 */
export function ganhoForaDoQuadro(n: { status: StatusLead; ganho_em: string | null }, agora: number): boolean {
  return n.status === 'ganho' && !!n.ganho_em && agora - new Date(n.ganho_em).getTime() > DIAS_GANHO_NO_QUADRO * DIA_MS
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
 * - negócio ganho há até DIAS_ATENDIMENTO_APOS_GANHO dias (não arquivado): a
 *   mensagem vai para ele e ele continua ganho. Depois de fechar, o cliente volta
 *   várias vezes para agendar as doses: isso é o mesmo negócio, não uma venda nova;
 * - fora isso (ganhos antigos, perdidos, nenhum): abre um negócio novo. O ganho e
 *   o perdido ficam como estão, com o histórico deles.
 *
 * @param negocios - Negócios do contato
 * @param agora - Momento da mensagem (ms)
 */
export function acaoDaMensagem<N extends NegocioResumo>(negocios: N[], agora: number = Date.now()): AcaoDaMensagem<N> {
  const abertos = negocios.filter(n => n.status === 'aberto')
  const ativo = maisRecente(abertos.filter(n => !n.arquivado))
  if (ativo) return { tipo: 'usar', negocio: ativo }
  const arquivado = maisRecente(abertos)
  if (arquivado) return { tipo: 'desarquivar', negocio: arquivado }
  const ganhoRecente = negocios
    .filter(n => n.status === 'ganho' && !n.arquivado && n.ganho_em && agora - new Date(n.ganho_em).getTime() <= DIAS_ATENDIMENTO_APOS_GANHO * DIA_MS)
    .reduce<N | null>((m, n) => (!m || n.ganho_em! > m.ganho_em! ? n : m), null)
  if (ganhoRecente) return { tipo: 'usar', negocio: ganhoRecente }
  return { tipo: 'novo' }
}
