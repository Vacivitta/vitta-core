import type { ResultadoEtapa, StatusLead } from '@/types/database'

/** O que se grava em leads ao marcar perdido (o trigger preenche perdido_em). */
export interface GravacaoPerda {
  status:          'perdido'
  motivo_perda_id: string
  motivo_perda:    string | null
}

/**
 * Valida a escolha do modal de perda: motivo obrigatório e, no "Outro", detalhe
 * obrigatório (a lista do funil não cobre o caso).
 *
 * @param motivo - Motivo escolhido (`motivos_perda`), ou null se nenhum
 * @param detalhe - Texto livre digitado
 * @returns Os valores a gravar, ou a mensagem de erro para a tela
 */
export function gravacaoPerda(
  motivo: { id: string; nome: string } | null,
  detalhe: string,
): { ok: true; valores: GravacaoPerda } | { ok: false; erro: string } {
  if (!motivo) return { ok: false, erro: 'Escolha um motivo' }
  const texto = detalhe.trim()
  if (motivo.nome === 'Outro' && !texto) return { ok: false, erro: 'Descreva o motivo' }
  return { ok: true, valores: { status: 'perdido', motivo_perda_id: motivo.id, motivo_perda: texto || null } }
}

/**
 * Texto do motivo para listas e para a ficha: "Motivo: detalhe", só o motivo, ou
 * o texto livre dos leads perdidos antes da 126 (sem motivo estruturado).
 */
export function rotuloMotivoPerda(nome: string | null, detalhe: string | null): string | null {
  const d = detalhe?.trim() || null
  if (nome && d) return `${nome}: ${d}`
  return nome ?? d
}

/**
 * Motivo para agrupar no dashboard: o motivo estruturado; perda só com texto
 * (legado ou automação) conta como "Outro".
 */
export function motivoParaAgrupar(nome: string | null, detalhe: string | null): string | null {
  if (nome) return nome
  return detalhe?.trim() ? 'Outro' : null
}

/**
 * Etapa para onde vai um lead reaberto pela ficha. Se a etapa atual tem resultado
 * (ex.: "Perdido"), ficar nela contradiz o status: volta para a primeira etapa
 * sem resultado do mesmo funil. Senão, fica onde está (null).
 *
 * @param atual - Etapa atual do lead
 * @param etapasDoFunil - Etapas do funil do lead
 */
export function etapaAoReabrir(
  atual: { id: string; resultado: ResultadoEtapa | null } | null,
  etapasDoFunil: { id: string; ordem: number; resultado: ResultadoEtapa | null }[],
): string | null {
  if (!atual?.resultado) return null
  const destino = [...etapasDoFunil]
    .sort((a, b) => a.ordem - b.ordem)
    .find(s => s.resultado === null && s.id !== atual.id)
  return destino?.id ?? null
}

/**
 * Mensagem recebida de um lead com negócio fechado (ganho ou perdido) reabre o
 * negócio na etapa padrão da unidade (1ª etapa do 1º funil), como o webhook já
 * fazia com os arquivados. is_converted não muda: quem é cliente continua cliente.
 *
 * @param lead - Status e etapa atuais
 * @param destino - Etapa padrão da unidade, ou null se a unidade não tem funil
 * @returns O update e o histórico de etapa a gravar, ou null se o negócio já está aberto
 */
export function reaberturaPorMensagem(
  lead: { status: StatusLead; stage_id: string | null },
  destino: { funnel_id: string; stage_id: string } | null,
): {
  valores: { status: 'aberto'; funnel_id?: string; stage_id?: string }
  historico: { de: string | null; para: string } | null
} | null {
  if (lead.status === 'aberto') return null
  if (!destino) return { valores: { status: 'aberto' }, historico: null }
  return {
    valores: { status: 'aberto', funnel_id: destino.funnel_id, stage_id: destino.stage_id },
    historico: destino.stage_id === lead.stage_id ? null : { de: lead.stage_id, para: destino.stage_id },
  }
}
