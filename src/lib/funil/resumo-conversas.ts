/** Etiqueta (tag do catálogo `wa_tags`) exibida no card do funil. */
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

export interface TagDoLeadFunil {
  lead_id: string
  tag?:    unknown
}

export const SELECT_TAGS_DOS_LEADS = 'lead_id, tag:wa_tags(id,name,color)'

/** Colunas buscadas em `wa_conversations` para montar o resumo. */
export const SELECT_CONVERSAS_FUNIL =
  'id, lead_id, unread_count, last_message_at, last_message_direction, tags:wa_conversation_tags(tag:wa_tags(id,name,color))'

/**
 * Agrupa as conversas por lead: não lidas (somadas), última mensagem e direção
 * (da conversa mais recente), id da conversa e etiquetas (de todas as conversas
 * do lead, sem repetir; antes ficavam só as da última conversa lida).
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
    for (const { tag } of (row.tags ?? []) as Array<{ tag: EtiquetaCard | null }>) {
      if (tag) acrescentar(r.tagsByLead, row.lead_id, tag)
    }
  }
  return r
}

/**
 * Agrupa por lead as tags aplicadas no próprio lead (`lead_tags`).
 *
 * @param rows - Linhas de `lead_tags` com a tag aninhada
 * @returns Mapa lead_id → etiquetas
 */
export function montarTagsDosLeads(rows: TagDoLeadFunil[]): Record<string, EtiquetaCard[]> {
  const mapa: Record<string, EtiquetaCard[]> = {}
  for (const row of rows) {
    const tag = row.tag as EtiquetaCard | null | undefined
    if (tag) acrescentar(mapa, row.lead_id, tag)
  }
  return mapa
}

/**
 * Une as etiquetas do lead com as das conversas dele, sem repetir a mesma tag.
 * As do lead vêm primeiro.
 */
export function unirEtiquetas(
  doLead: Record<string, EtiquetaCard[]>,
  dasConversas: Record<string, EtiquetaCard[]>,
): Record<string, EtiquetaCard[]> {
  const mapa: Record<string, EtiquetaCard[]> = {}
  for (const origem of [doLead, dasConversas]) {
    for (const [leadId, etiquetas] of Object.entries(origem)) {
      for (const e of etiquetas) acrescentar(mapa, leadId, e)
    }
  }
  return mapa
}

function acrescentar(mapa: Record<string, EtiquetaCard[]>, leadId: string, e: EtiquetaCard) {
  const lista = mapa[leadId] ??= []
  if (!lista.some(t => t.id === e.id)) lista.push(e)
}
