import type { MotivoArquivamento, ResultadoEtapa, StatusLead } from '@/types/database'

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
 * Etapa para onde vai um lead marcado como perdido pela ficha: a etapa de perda
 * do funil (resultado 'perdido'; a de menor ordem, se houver mais de uma), para
 * ele continuar no kanban, na coluna de perda (leads_kanban, migração 131).
 * Null se ele já está numa etapa de perda ou se o funil não tem nenhuma (aí o
 * lead fica na coluna onde está, com o selo Perdido).
 *
 * @param atual - Etapa atual do lead (null se não tem etapa)
 * @param etapasDoFunil - Etapas do funil do lead
 */
export function etapaAoPerder(
  atual: { id: string; resultado: ResultadoEtapa | null } | null,
  etapasDoFunil: { id: string; ordem: number; resultado: ResultadoEtapa | null }[],
): string | null {
  if (atual?.resultado === 'perdido') return null
  return primeiraEtapaCom('perdido', etapasDoFunil)
}

/**
 * Etapa para onde vai um lead marcado como ganho pela ficha: a etapa de ganho do
 * funil (resultado 'ganho'; a de menor ordem, se houver mais de uma). Null se ele
 * já está numa etapa de ganho ou se o funil não tem nenhuma (aí o lead fica na
 * coluna onde está, com o selo Ganho).
 *
 * @param atual - Etapa atual do lead (null se não tem etapa)
 * @param etapasDoFunil - Etapas do funil do lead
 */
export function etapaAoGanhar(
  atual: { id: string; resultado: ResultadoEtapa | null } | null,
  etapasDoFunil: { id: string; ordem: number; resultado: ResultadoEtapa | null }[],
): string | null {
  if (atual?.resultado === 'ganho') return null
  return primeiraEtapaCom('ganho', etapasDoFunil)
}

function primeiraEtapaCom(
  resultado: ResultadoEtapa,
  etapasDoFunil: { id: string; ordem: number; resultado: ResultadoEtapa | null }[],
): string | null {
  const destino = [...etapasDoFunil]
    .sort((a, b) => a.ordem - b.ordem || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .find(s => s.resultado === resultado)
  return destino?.id ?? null
}

/**
 * Mensagem recebida reabre o lead na etapa padrão da unidade (1ª etapa do 1º
 * funil) quando o negócio está fechado (ganho ou perdido) ou o lead está
 * arquivado (migração 132: desarquiva, como o webhook fazia antes da 126).
 * is_converted não muda: quem é cliente continua cliente.
 *
 * @param lead - Status, etapa e arquivamento atuais
 * @param destino - Etapa padrão da unidade, ou null se a unidade não tem funil
 * @returns O update e o histórico de etapa a gravar, ou null se o lead está aberto e não arquivado
 */
export function reaberturaPorMensagem(
  lead: { status: StatusLead; stage_id: string | null; arquivado: boolean },
  destino: { funnel_id: string; stage_id: string } | null,
): {
  valores: { status: 'aberto'; arquivado_em?: null; funnel_id?: string; stage_id?: string }
  historico: { de: string | null; para: string } | null
} | null {
  if (lead.status === 'aberto' && !lead.arquivado) return null
  const base = lead.arquivado ? { status: 'aberto' as const, arquivado_em: null } : { status: 'aberto' as const }
  if (!destino) return { valores: base, historico: null }
  return {
    valores: { ...base, funnel_id: destino.funnel_id, stage_id: destino.stage_id },
    historico: destino.stage_id === lead.stage_id ? null : { de: lead.stage_id, para: destino.stage_id },
  }
}

/**
 * Valida a escolha do modal de arquivar e monta o texto gravado em
 * leads.arquivado_motivo: "Motivo" ou "Motivo: detalhe". "Outro" exige detalhe.
 *
 * @param motivo - Motivo da lista fixa (MOTIVOS_ARQUIVAMENTO), ou null se nenhum
 * @param detalhe - Texto livre digitado
 */
export function motivoArquivamento(
  motivo: MotivoArquivamento | null,
  detalhe: string,
): { ok: true; texto: string } | { ok: false; erro: string } {
  if (!motivo) return { ok: false, erro: 'Escolha um motivo' }
  const d = detalhe.trim().replace(/\s+/g, ' ')
  if (motivo === 'Outro' && !d) return { ok: false, erro: 'Descreva o motivo' }
  if (d.length > 300) return { ok: false, erro: 'Descrição muito longa (máximo 300 caracteres)' }
  return { ok: true, texto: d ? `${motivo}: ${d}` : motivo }
}
