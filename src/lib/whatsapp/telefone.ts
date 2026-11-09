import type { SupabaseClient } from '@supabase/supabase-js'
import { normalizarWaPhone, variantesTelefone } from '@/lib/telefone'
import type { StatusLead } from '@/types/database'
import { escolherNegocio, type NegocioResumo } from '@/lib/negocios'

/**
 * Procura a conversa da conexão com qualquer versão do número (com ou sem o 9).
 * Para muitos DDDs a Meta identifica o contato SEM o 9º dígito; sem considerar as
 * duas formas, o mesmo cliente ganhava duas conversas. Se houver mais de uma
 * (duplicatas antigas), prefere a com mensagem mais recente.
 *
 * @param supabase - Cliente service-role
 * @param conexaoId - Conexão da conversa (143): o mesmo cliente pode falar com dois números da unidade
 * @param waPhone - Número com DDI, só dígitos (wa_id da Meta ou forma canônica)
 * @returns `{ id, lead_id, wa_phone, profile_picture_url }` ou `null`
 */
export async function buscarConversaPorTelefone(
  supabase: SupabaseClient,
  conexaoId: string,
  waPhone: string,
): Promise<{ id: string; lead_id: string | null; wa_phone: string; profile_picture_url: string | null } | null> {
  const norm = normalizarWaPhone(waPhone)
  const variantes = norm ? [...new Set([waPhone, ...variantesTelefone(norm)])] : [waPhone]
  const { data } = await supabase
    .from('wa_conversations')
    .select('id, lead_id, wa_phone, profile_picture_url')
    .eq('conexao_id', conexaoId)
    .in('wa_phone', variantes)
    .order('last_message_at', { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle()
  return data
}

/**
 * Procura o negócio da unidade pelo telefone na forma canônica (`leads.telefone_norm`).
 * Um contato pode ter vários (150): prefere o aberto, depois o não arquivado,
 * e entre iguais o mais recente (escolherNegocio).
 *
 * @param supabase - Cliente service-role
 * @param unitId - Unidade do lead
 * @param norm - Telefone na forma canônica (`normalizarTelefone`/`normalizarWaPhone`)
 * @returns `{ id, status, stage_id, arquivado }` ou `null`
 */
export async function buscarLeadPorTelefone(
  supabase: SupabaseClient,
  unitId: string,
  norm: string,
): Promise<{ id: string; status: StatusLead; stage_id: string | null; arquivado: boolean } | null> {
  const { data } = await supabase
    .from('leads')
    .select('id, status, stage_id, arquivado, created_at')
    .eq('unit_id', unitId)
    .eq('telefone_norm', norm)
  const escolhido = escolherNegocio((data ?? []) as NegocioResumo[])
  return escolhido
    ? { id: escolhido.id, status: escolhido.status, stage_id: escolhido.stage_id, arquivado: escolhido.arquivado }
    : null
}
