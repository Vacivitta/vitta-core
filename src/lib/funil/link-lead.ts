const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Lê o link /funil?lead=<id>&tab=<aba> (notificações). Id que não é uuid é
 * ignorado: a consulta daria erro de sintaxe em vez de "não encontrado".
 *
 * @param sp - searchParams da página (valor repetido chega como lista: vale o primeiro)
 * @returns O lead a abrir e a aba pedida, ou null se o link não indica um lead
 */
export function linkDoLead(
  sp: Record<string, string | string[] | undefined>,
): { leadId: string; aba: string | null } | null {
  const primeiro = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? null
  const leadId = primeiro(sp.lead)?.trim() ?? ''
  if (!UUID.test(leadId)) return null
  return { leadId: leadId.toLowerCase(), aba: primeiro(sp.tab) }
}
