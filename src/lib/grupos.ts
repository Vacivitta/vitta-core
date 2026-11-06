/**
 * Conversas de grupo no Atendimento (145). Regras puras, testadas em
 * tests/grupos.test.mjs.
 */

export interface MensagemComAutor {
  direction:       string
  autor_telefone?: string | null
  autor_nome?:     string | null
  created_at:      string
}

export interface Participante { telefone: string; nome: string | null; ultimaEm: string }

/**
 * Quem escreveu no grupo, pelo telefone, com o nome mais recente; o que falou por
 * último vem primeiro. Autor sem telefone (só LID) fica de fora: não dá para criar
 * contato sem número.
 */
export function participantesDoGrupo(mensagens: readonly MensagemComAutor[]): Participante[] {
  const porTelefone = new Map<string, Participante>()
  for (const m of mensagens) {
    if (m.direction !== 'inbound' || !m.autor_telefone) continue
    const atual = porTelefone.get(m.autor_telefone)
    if (!atual || m.created_at > atual.ultimaEm) {
      porTelefone.set(m.autor_telefone, {
        telefone: m.autor_telefone,
        nome: m.autor_nome ?? atual?.nome ?? null,
        ultimaEm: m.created_at,
      })
    }
  }
  return [...porTelefone.values()].sort((a, b) => b.ultimaEm.localeCompare(a.ultimaEm))
}

const CORES_AUTOR = ['#2563EB', '#C87F1B', '#7C3AED', '#DB2777', '#0891B2', '#4D7C0F', '#DC2626', '#3E9849'] as const

/** Cor fixa por autor, para distinguir quem fala no grupo. */
export function corDoAutor(chave: string): string {
  let h = 0
  for (const ch of chave) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return CORES_AUTOR[h % CORES_AUTOR.length]
}

/** Nome da conversa na lista e no cabeçalho. */
export function nomeDaConversa(conv: { tipo?: string | null; wa_contact_name: string | null; wa_phone: string }, nomeDoLead: string | null): string {
  if (conv.tipo === 'grupo') return conv.wa_contact_name ?? 'Grupo sem nome'
  return nomeDoLead ?? conv.wa_contact_name ?? conv.wa_phone
}

/** Telefone do participante para o formulário de contato: +DDI e o número. */
export function telefoneDoParticipante(telefone: string): string {
  return `+${telefone.replace(/\D/g, '')}`
}
