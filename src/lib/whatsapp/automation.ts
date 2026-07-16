import type { SupabaseClient } from '@supabase/supabase-js'

export async function runWaAutomation(
  supabase:       SupabaseClient,
  trigger:        string,
  unitId:         string,
  conversationId: string,
) {
  const { data: automation } = await supabase
    .from('wa_automations')
    .select('action, stage_id')
    .eq('unit_id', unitId)
    .eq('trigger', trigger)
    .eq('ativo', true)
    .single()

  if (!automation || automation.action !== 'move_stage' || !automation.stage_id) return

  const { data: conv } = await supabase
    .from('wa_conversations')
    .select('lead_id')
    .eq('id', conversationId)
    .single()

  if (!conv?.lead_id) return

  await supabase
    .from('leads')
    .update({ stage_id: automation.stage_id })
    .eq('id', conv.lead_id)
}
