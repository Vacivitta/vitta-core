import type { TipoTag } from '@/types/database'

// Tags de cliente e de conversa (migração 133): regras puras, testadas em
// tests/tags.test.mjs.

export const TIPOS_TAG: readonly TipoTag[] = ['lead', 'conversa']

export const ROTULO_TIPO_TAG: Record<TipoTag, string> = { lead: 'Cliente', conversa: 'Conversa' }

/** Valor vindo da URL ou do corpo da requisição; null se não for um tipo válido. */
export function lerTipoTag(valor: unknown): TipoTag | null {
  return TIPOS_TAG.find(t => t === valor) ?? null
}

/** Só as tags do tipo pedido, na ordem em que vieram. */
export function tagsDoTipo<T extends { tipo: TipoTag }>(tags: readonly T[], tipo: TipoTag): T[] {
  return tags.filter(t => t.tipo === tipo)
}

/** Tags separadas por tipo (Cliente antes de Conversa), sem os grupos vazios. */
export function agruparPorTipo<T extends { tipo: TipoTag }>(
  tags: readonly T[],
): { tipo: TipoTag; rotulo: string; tags: T[] }[] {
  return TIPOS_TAG
    .map(tipo => ({ tipo, rotulo: ROTULO_TIPO_TAG[tipo], tags: tagsDoTipo(tags, tipo) }))
    .filter(g => g.tags.length > 0)
}
