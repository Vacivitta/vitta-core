import type { SupabaseClient } from '@supabase/supabase-js'
import { normalizarWaPhone, variantesTelefone } from '@/lib/telefone'
import type { StatusLead } from '@/types/database'

/**
 * Procura a conversa da unidade com qualquer versão do número (com ou sem o 9).
 * Para muitos DDDs a Meta identifica o contato SEM o 9º dígito; sem considerar as
 * duas formas, o mesmo cliente ganhava duas conversas. Se houver mais de uma
 * (duplicatas antigas), prefere a com mensagem mais recente.
 *
 * @param supabase - Cliente service-role
 * @param unitId - Unidade da conversa
 * @param waPhone - Número com DDI, só dígitos (wa_id da Meta ou forma canônica)
 * @returns `{ id, lead_id, wa_phone, profile_picture_url }` ou `null`
 */
export async function buscarConversaPorTelefone(
  supabase: SupabaseClient,
  unitId: string,
  waPhone: string,
): Promise<{ id: string; lead_id: string | null; wa_phone: string; profile_picture_url: string | null } | null> {
  const norm = normalizarWaPhone(waPhone)
  const variantes = norm ? [...new Set([waPhone, ...variantesTelefone(norm)])] : [waPhone]
  const { data } = await supabase
    .from('wa_conversations')
    .select('id, lead_id, wa_phone, profile_picture_url')
    .eq('unit_id', unitId)
    .in('wa_phone', variantes)
    .order('last_message_at', { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle()
  return data
}

/**
 * Procura o lead da unidade pelo telefone na forma canônica (`leads.telefone_norm`).
 * Prefere o não perdido e, entre iguais, o mais recente.
 *
 * @param supabase - Cliente service-role
 * @param unitId - Unidade do lead
 * @param norm - Telefone na forma canônica (`normalizarTelefone`/`normalizarWaPhone`)
 * @returns `{ id, status, stage_id }` ou `null`
 */
export async function buscarLeadPorTelefone(
  supabase: SupabaseClient,
  unitId: string,
  norm: string,
): Promise<{ id: string; status: StatusLead; stage_id: string | null } | null> {
  const { data } = await supabase
    .from('leads')
    .select('id, status, stage_id')
    .eq('unit_id', unitId)
    .eq('telefone_norm', norm)
    // arquivado é gerada (status = 'perdido'): false primeiro = não perdidos primeiro
    .order('arquivado', { ascending: true })
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  return data
}
