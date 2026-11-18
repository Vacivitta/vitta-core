import type { FunnelStage, LeadKanban } from '@/types/database'

/**
 * Lead como fica logo depois de mudar de etapa, antes do banco responder: o
 * relógio da etapa zera (o gatilho trg_stage_changed_at faz o mesmo no banco) e
 * o prazo passa a ser o da etapa de destino. Sem isso o card chegava vencido na
 * nova etapa até a próxima recarga.
 *
 * @param lead - Lead na etapa de origem
 * @param stage - Etapa de destino
 * @param agoraIso - Momento da mudança (ISO)
 */
export function leadNaEtapa(lead: LeadKanban, stage: FunnelStage, agoraIso: string): LeadKanban {
  return {
    ...lead,
    stage_id:           stage.id,
    stage_nome:         stage.nome,
    stage_cor:          stage.cor,
    stage_ordem:        stage.ordem,
    stage_alerta_horas: stage.alerta_horas,
    stage_sla_mensal:   stage.sla_mensal,
    stage_changed_at:   agoraIso,
  }
}
