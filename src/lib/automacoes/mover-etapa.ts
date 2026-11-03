import type { SupabaseClient } from '@supabase/supabase-js'
import { falha, type ResultadoAutomacao } from '@/lib/automacoes/execucao'

/**
 * Move um lead para outra etapa do funil por automação (evento ou tempo).
 * Atualiza `stage_id` e `funnel_id` (senão o card some do kanban quando a etapa
 * é de outro funil) e grava `lead_stage_history`, que nenhum trigger grava: o app
 * registra o histórico desde a 030.
 *
 * @param supabase - Cliente service-role
 * @param lead - Lead com a etapa atual
 * @param paraStageId - Etapa de destino em `funnel_stages`
 */
export async function moverLeadDeEtapa(
  supabase:    SupabaseClient,
  lead:        { id: string; stage_id: string | null },
  paraStageId: string,
): Promise<ResultadoAutomacao> {
  if (lead.stage_id === paraStageId) return { kind: 'pulado', motivo: 'ja_na_etapa' }

  const { data: stage, error: stageErr } = await supabase
    .from('funnel_stages')
    .select('funnel_id')
    .eq('id', paraStageId)
    .maybeSingle()

  if (stageErr) return falha('banco', stageErr)
  if (!stage) return { kind: 'pulado', motivo: 'mal_configurada' }

  const { error: updateErr } = await supabase
    .from('leads')
    .update(stage.funnel_id ? { stage_id: paraStageId, funnel_id: stage.funnel_id } : { stage_id: paraStageId })
    .eq('id', lead.id)

  if (updateErr) return falha('banco', updateErr)

  const { error: historyErr } = await supabase.from('lead_stage_history').insert({
    lead_id:       lead.id,
    de_stage_id:   lead.stage_id,
    para_stage_id: paraStageId,
    movido_por:    null,
    movido_via:    'automacao',
  })

  if (historyErr) return falha('banco', historyErr)

  return { kind: 'etapa_movida', de: lead.stage_id, para: paraStageId }
}
