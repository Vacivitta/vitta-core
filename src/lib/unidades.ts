/** Mesma paleta e ordem do preenchimento da migração 139 (tests/unidades.test.mjs confere). */
export const PALETA_UNIDADES = ['#3E9849', '#2563EB', '#C87F1B', '#7C3AED', '#DB2777', '#0891B2', '#DC2626', '#4D7C0F'] as const

/** Unidade como a caixa de entrada e o sino mostram: nome, cor e número da conexão. */
export interface UnidadeDaCaixa {
  id:     string
  nome:   string
  cor:    string
  numero: string | null
}

/** Cor gravada da unidade ou, sem ela, a da paleta pela posição na lista (ordem de criação). */
export function corDaUnidade(cor: string | null, posicao: number): string {
  return cor ?? PALETA_UNIDADES[posicao % PALETA_UNIDADES.length]
}

/** Conexão da conversa (143), como o Atendimento mostra; sem token. */
export interface ConexaoDaCaixa {
  id:      string
  nome:    string
  numero:  string | null
  tipo:    'oficial' | 'qrcode'
  pessoal: boolean
}

/**
 * Rótulo da barra acima da caixa de texto: a unidade e o número pelo qual a
 * resposta sai (o da conexão da conversa; sem ela, o da unidade). QR Code avisa
 * que o canal não é oficial.
 */
export function rotuloRespondendoComo(
  unidade: Pick<UnidadeDaCaixa, 'nome' | 'numero'>,
  conexao?: Pick<ConexaoDaCaixa, 'numero' | 'tipo'> | null,
): string {
  const numero = conexao?.numero ?? unidade.numero ?? 'número não configurado'
  return `Respondendo como ${unidade.nome} · ${numero}${conexao?.tipo === 'qrcode' ? ' · QR Code (não oficial)' : ''}`
}

/**
 * Responder numa conversa de outra unidade que não a ativa pede confirmação uma vez
 * por conversa. A mensagem sai sempre pela conexão da unidade da conversa.
 */
export function precisaConfirmarResposta(
  unidadeDaConversa: string | null,
  unidadeAtiva: string | null,
  conversaId: string,
  confirmadas: ReadonlySet<string>,
): boolean {
  if (!unidadeDaConversa || unidadeDaConversa === unidadeAtiva) return false
  return !confirmadas.has(conversaId)
}
