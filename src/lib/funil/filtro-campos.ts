import { camposDoFunil } from '../campos.ts'
import type { CampoLead } from '@/types/database'

/** Filtro por campo personalizado: chave do campo → valores marcados (opções, ou 'sim'/'nao'). */
export type FiltroCampos = Record<string, string[]>

export type CampoFiltravel = Extract<CampoLead, { tipo: 'selecao' | 'multipla' }> | (Extract<CampoLead, { opcoes: null }> & { tipo: 'sim_nao' })

const SIM_NAO = [{ id: 'sim', label: 'Sim' }, { id: 'nao', label: 'Não' }]

/** Campos que aparecem como filtro no funil: ativos, da unidade ou deste funil, de seleção, múltipla ou sim/não. */
export function camposFiltraveis(campos: CampoLead[], funnelId: string | null): CampoFiltravel[] {
  return camposDoFunil(campos, funnelId)
    .filter((c): c is CampoFiltravel => c.tipo === 'selecao' || c.tipo === 'multipla' || c.tipo === 'sim_nao')
}

/** Opções do filtro de um campo. */
export function opcoesDoFiltro(campo: CampoFiltravel): { id: string; label: string }[] {
  return campo.tipo === 'sim_nao' ? SIM_NAO : campo.opcoes.map(o => ({ id: o, label: o }))
}

/** Quantos valores estão marcados nos campos exibidos (o que sobrou de outro funil não conta). */
export function totalFiltrosCampos(filtro: FiltroCampos, campos: CampoFiltravel[]): number {
  return campos.reduce((n, c) => n + (filtro[c.chave]?.length ?? 0), 0)
}

/**
 * O lead passa se, em cada campo com valores marcados, o valor dele bate com
 * algum marcado (OU dentro do campo, E entre campos, como os filtros de etapa e
 * tag). Lead sem valor no campo não passa. Campos fora da lista são ignorados:
 * o filtro de um funil não esconde leads de outro.
 *
 * @param camposDoLead - leads.campos do lead (leads_kanban, migração 134)
 * @param filtro - Valores marcados por chave
 * @param campos - Campos filtráveis do funil exibido
 */
export function passaFiltroCampos(
  camposDoLead: Record<string, unknown> | null | undefined,
  filtro: FiltroCampos,
  campos: CampoFiltravel[],
): boolean {
  for (const c of campos) {
    const marcados = filtro[c.chave]
    if (!marcados?.length) continue
    const valor = camposDoLead?.[c.chave]
    switch (c.tipo) {
      case 'selecao':
        if (typeof valor !== 'string' || !marcados.includes(valor)) return false
        break
      case 'multipla':
        if (!Array.isArray(valor) || !valor.some(v => typeof v === 'string' && marcados.includes(v))) return false
        break
      case 'sim_nao':
        if (typeof valor !== 'boolean' || !marcados.includes(valor ? 'sim' : 'nao')) return false
        break
    }
  }
  return true
}
