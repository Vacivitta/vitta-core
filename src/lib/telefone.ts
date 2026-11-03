/**
 * Telefone num formato só. A forma canônica (`telefone_norm`) tem só dígitos,
 * com DDI: Brasil é 55 + DDD + número, celular sempre com o 9 (13 dígitos) e
 * fixo com 12. A função SQL `public.normalizar_telefone` (migração 121) aplica
 * a MESMA regra; os casos de `tests/db/telefone_casos.json` valem para as duas.
 */

/**
 * Converte o que foi digitado (ou recebido) para a forma canônica.
 *
 * Com `+`, ou sem `+` e com mais de 11 dígitos, o número já traz o DDI: 55 com
 * 12 ou 13 dígitos é Brasil; outro DDI com 11 a 15 dígitos é estrangeiro e fica
 * como está. Sem `+`, 10 ou 11 dígitos são DDD + número brasileiro; zeros de
 * tronco à esquerda (0DD...) são ignorados. Celular de 8 dígitos (6–9) ganha o 9.
 *
 * @param raw - Telefone em qualquer formato, ex.: "(31) 99667-4494", "+1 212 555 1234"
 * @returns Só dígitos com DDI, ou `null` se vazio ou inválido
 */
export function normalizarTelefone(raw: string | null | undefined): string | null {
  if (!raw) return null
  const internacional = /^\s*\+/.test(raw)
  let d = raw.replace(/\D/g, '')
  if (!internacional) d = d.replace(/^0+/, '')

  let nacional: string
  if (d.startsWith('55') && (d.length === 12 || d.length === 13)) nacional = d.slice(2)
  else if (internacional || d.length > 11) return !d.startsWith('55') && d.length >= 11 && d.length <= 15 ? d : null
  else if (d.length === 10 || d.length === 11) nacional = d
  else return null

  if (!/^[1-9]{2}/.test(nacional)) return null
  const primeiro = nacional[2]
  if (nacional.length === 11) return primeiro === '9' ? '55' + nacional : null
  if (primeiro >= '2' && primeiro <= '5') return '55' + nacional
  if (primeiro >= '6') return '55' + nacional.slice(0, 2) + '9' + nacional.slice(2)
  return null
}

/**
 * Normaliza o número que a Meta usa (wa_id / `wa_conversations.wa_phone`), que
 * sempre traz o DDI mas vem sem `+`: sem ele, um número americano de 11 dígitos
 * seria lido como DDD + celular brasileiro.
 *
 * @param waPhone - Ex.: "553196674494", "12125551234"
 */
export function normalizarWaPhone(waPhone: string): string | null {
  return normalizarTelefone('+' + waPhone.replace(/\D/g, ''))
}

/**
 * Forma de exibição: "(31) 99667-4494", "(31) 3333-4444" ou "+12125551234".
 *
 * @param norm - Telefone na forma canônica
 */
export function formatarTelefone(norm: string): string {
  if (norm.startsWith('55') && norm.length === 13) return `(${norm.slice(2, 4)}) ${norm.slice(4, 9)}-${norm.slice(9)}`
  if (norm.startsWith('55') && norm.length === 12) return `(${norm.slice(2, 4)}) ${norm.slice(4, 8)}-${norm.slice(8)}`
  return '+' + norm
}

/**
 * O que gravar em `leads.telefone` a partir do que foi digitado: a forma de
 * exibição se o número for válido; senão o texto como está (ou `null` se vazio),
 * para não perder o que a pessoa escreveu.
 *
 * @param raw - Texto digitado
 */
export function telefoneParaGravar(raw: string | null | undefined): string | null {
  const norm = normalizarTelefone(raw)
  return norm ? formatarTelefone(norm) : (raw?.trim() || null)
}

/**
 * Versões do número que podem estar em `wa_phone`: para muitos DDDs a Meta
 * identifica o celular SEM o 9 (553196674494), enquanto a forma canônica tem
 * (5531996674494).
 *
 * @param norm - Telefone na forma canônica
 * @returns A própria forma canônica e, se for celular brasileiro, a versão sem o 9
 */
export function variantesTelefone(norm: string): string[] {
  if (norm.startsWith('55') && norm.length === 13) return [norm, norm.slice(0, 4) + norm.slice(5)]
  return [norm]
}

/**
 * Aviso para o campo de telefone de um formulário, ou `null` se estiver ok (ou vazio).
 *
 * @param raw - Texto digitado
 */
export function avisoTelefone(raw: string): string | null {
  if (!raw.trim()) return null
  const norm = normalizarTelefone(raw)
  if (!norm) return 'Número inválido. Informe DDD + número (ex.: 34 99999-8888) ou, se for de outro país, + e o DDI'
  if (norm.length === 13 && norm.startsWith('55') && !raw.replace(/\D/g, '').endsWith(norm.slice(4))) {
    return `Celular sem o 9° dígito. Formato correto: ${formatarTelefone(norm)}`
  }
  return null
}
