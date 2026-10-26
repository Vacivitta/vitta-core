/** Etiqueta de conversa exibida no card do funil. */
export interface EtiquetaCard { id: string; name: string; color: string }

/** Linha de `wa_conversations` usada pelo funil (com as etiquetas aninhadas). */
export interface ConversaFunil {
  id:                     string
  lead_id:                string | null
  unread_count:           number
  last_message_at:        string | null
  last_message_direction: 'inbound' | 'outbound' | null
  tags?:                  unknown
}

/** Dados de conversa por lead que os cards do funil exibem. */
export interface ResumoConversas {
  unreadByLead:  Record<string, number>
  lastMsgByLead: Record<string, string>
  lastDirByLead: Record<string, 'inbound' | 'outbound'>
  convIdByLead:  Record<string, string>
  tagsByLead:    Record<string, EtiquetaCard[]>
}

/** Colunas buscadas em `wa_conversations` para montar o resumo. */
export const SELECT_CONVERSAS_FUNIL =
  'id, lead_id, unread_count, last_message_at, last_message_direction, tags:wa_conversation_tags(tag:wa_tags(id,name,color))'

/**
 * Agrupa as conversas por lead: não lidas (somadas), última mensagem e direção
 * (da conversa mais recente), id da conversa e etiquetas.
 *
 * Usado no servidor (primeira renderização do funil já com esses dados — antes os
 * cards apareciam sem eles e se reorganizavam quando o navegador terminava de
 * buscar) e no navegador (recarga).
 *
 * @param rows - Conversas da unidade com lead vinculado
 * @returns Mapas por lead_id
 */
export function montarResumoConversas(rows: ConversaFunil[]): ResumoConversas {
  const r: ResumoConversas = { unreadByLead: {}, lastMsgByLead: {}, lastDirByLead: {}, convIdByLead: {}, tagsByLead: {} }
  for (const row of rows) {
    if (!row.lead_id) continue
    r.convIdByLead[row.lead_id] = row.id
    if (row.unread_count > 0) r.unreadByLead[row.lead_id] = (r.unreadByLead[row.lead_id] ?? 0) + row.unread_count
    if (row.last_message_at && (!r.lastMsgByLead[row.lead_id] || row.last_message_at > r.lastMsgByLead[row.lead_id])) {
      r.lastMsgByLead[row.lead_id] = row.last_message_at
      if (row.last_message_direction) r.lastDirByLead[row.lead_id] = row.last_message_direction
    }
    const etiquetas = ((row.tags ?? []) as Array<{ tag: EtiquetaCard | null }>).map(t => t.tag).filter((t): t is EtiquetaCard => !!t)
    if (etiquetas.length > 0) r.tagsByLead[row.lead_id] = etiquetas
  }
  return r
}
