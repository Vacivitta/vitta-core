/**
 * Quem cria e quem gerencia (QR Code, desconectar) uma conexão de WhatsApp
 * (143/144). Regras puras, testadas em tests/conexoes.test.mjs.
 *
 * - A marca (admin, gestor_vacivitta) gerencia todas, inclusive as pessoais (ADR 0004).
 * - Conexão pessoal: só a dona, que precisa estar na unidade (ADR 0007).
 * - Conexão da unidade (QR Code compartilhado): gestor da unidade.
 */

export interface QuemPede {
  userId:  string
  /** admin ou gestor_vacivitta */
  ehMarca: boolean
  /** admin, gestor_vacivitta ou gestor_unidade */
  ehGestor: boolean
  /** vinculado à unidade da conexão */
  membro:  boolean
}

export function podeCriarConexao(quem: QuemPede, pessoal: boolean): boolean {
  if (!quem.membro && !quem.ehMarca) return false
  if (pessoal) return quem.membro
  return quem.ehGestor
}

export function podeGerenciarConexao(quem: QuemPede, conexao: { tipo: string; pessoal: boolean; dona_id: string | null }): boolean {
  if (conexao.tipo !== 'qrcode') return false
  if (quem.ehMarca) return true
  if (!quem.membro) return false
  if (conexao.pessoal) return conexao.dona_id === quem.userId
  return quem.ehGestor
}

/** Nome da instância na Evolution: só letras, números e hífen, único por conexão. */
export function nomeDaInstancia(conexaoId: string): string {
  return `vd-${conexaoId.replace(/[^a-f0-9-]/gi, '').toLowerCase()}`
}
