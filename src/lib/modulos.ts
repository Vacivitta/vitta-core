/**
 * Módulos ligáveis por unidade (146). Mesmo padrão de modulo_ativo() no banco:
 * sem linha em unidade_modulos, Orçamentos, Catálogo e Campanhas ficam ligados e
 * QR Code, Empresas e Tickets desligados. Testado em tests/modulos.test.mjs.
 */
import type { Modulo } from '@/types/database'

export const MODULOS: readonly { chave: Modulo; nome: string; descricao: string; padrao: boolean }[] = [
  { chave: 'orcamentos', nome: 'Orçamentos', descricao: 'Orçamentos com PDF e link público', padrao: true },
  { chave: 'catalogo', nome: 'Catálogo', descricao: 'Vacinas, pacotes e serviços com preço', padrao: true },
  { chave: 'campanhas', nome: 'Campanhas', descricao: 'Disparos de WhatsApp pela API oficial', padrao: true },
  { chave: 'qrcode', nome: 'WhatsApp por QR Code', descricao: 'Conectar números por QR Code (canal não oficial, com grupos)', padrao: false },
  { chave: 'empresas', nome: 'Empresas', descricao: 'Empresas ligadas aos clientes e aos grupos', padrao: false },
  { chave: 'tickets', nome: 'Tickets', descricao: 'Pedidos de suporte com funil próprio', padrao: false },
]

/** Módulos ligados na unidade, a partir das exceções gravadas. */
export function modulosLigados(excecoes: readonly { modulo: string; ativo: boolean }[]): Set<Modulo> {
  const ligados = new Set<Modulo>()
  for (const m of MODULOS) {
    const excecao = excecoes.find(e => e.modulo === m.chave)
    if (excecao ? excecao.ativo : m.padrao) ligados.add(m.chave)
  }
  return ligados
}

/** Página que só existe com o módulo ligado. */
export const MODULO_DA_ROTA: Readonly<Record<string, Modulo>> = {
  '/orcamento': 'orcamentos',
  '/produtos': 'catalogo',
  '/campanhas': 'campanhas',
  '/empresas': 'empresas',
  '/tickets': 'tickets',
}

/** A rota aparece no menu? Rotas sem módulo sempre aparecem. */
export function rotaNoMenu(href: string, ligados: ReadonlySet<Modulo>): boolean {
  const modulo = MODULO_DA_ROTA[href]
  return !modulo || ligados.has(modulo)
}
