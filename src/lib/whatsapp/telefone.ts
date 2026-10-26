import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Versões possíveis de um número de celular brasileiro no WhatsApp.
 *
 * Para muitos DDDs a Meta identifica o contato (wa_id) SEM o 9º dígito
 * (ex.: 553196674494), enquanto o número digitado pela equipe tem o 9
 * (5531996674494). Sem considerar as duas formas, o mesmo cliente ganhava duas
 * conversas: uma com as mensagens enviadas e outra com as respostas.
 *
 * @param waPhone - Número só com dígitos, com DDI 55 (12 ou 13 dígitos)
 * @returns O próprio número e, se for celular brasileiro, a outra versão
 */
export function variantesWaPhone(waPhone: string): string[] {
  const d = waPhone.replace(/\D/g, '')
  if (!d.startsWith('55')) return [d]
  // 55 + DDD + 9 + 8 dígitos → versão sem o 9
  if (d.length === 13 && d[4] === '9') return [d, d.slice(0, 4) + d.slice(5)]
  // 55 + DDD + 8 dígitos de celular (6-9) → versão com o 9
  if (d.length === 12 && /[6-9]/.test(d[4])) return [d, d.slice(0, 4) + '9' + d.slice(4)]
  return [d]
}

/**
 * Procura a conversa da unidade com qualquer versão do número (com ou sem o 9).
 * Se houver mais de uma (duplicatas antigas), prefere a com mensagem mais recente.
 *
 * @param supabase - Cliente service-role
 * @param unitId - Unidade da conversa
 * @param waPhone - Número com DDI 55
 * @returns `{ id, lead_id, wa_phone, profile_picture_url }` ou `null`
 */
export async function buscarConversaPorTelefone(
  supabase: SupabaseClient,
  unitId: string,
  waPhone: string,
): Promise<{ id: string; lead_id: string | null; wa_phone: string; profile_picture_url: string | null } | null> {
  const { data } = await supabase
    .from('wa_conversations')
    .select('id, lead_id, wa_phone, profile_picture_url')
    .eq('unit_id', unitId)
    .in('wa_phone', variantesWaPhone(waPhone))
    .order('last_message_at', { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle()
  return data
}
