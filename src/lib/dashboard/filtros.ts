import type { Janela } from './negocios'

export type Periodo = '7d' | '30d' | '90d' | 'all'
export const PERIODOS: readonly Periodo[] = ['7d', '30d', '90d', 'all']
export const PERIODO_PADRAO: Periodo = '30d'

export interface FiltrosDashboard {
  periodo:       Periodo
  funilId:       string | null
  responsavelId: string | null
}

type Params = Record<string, string | string[] | undefined>

function um(v: string | string[] | undefined): string | null {
  const s = Array.isArray(v) ? v[0] : v
  return s?.trim() || null
}

/**
 * Filtros a partir da URL (?periodo=&funil=&responsavel=). Valor que não é um
 * período conhecido, funil ou perfil da unidade cai no padrão, para um link
 * velho ou editado à mão não mostrar painel vazio sem explicação.
 */
export function lerFiltros(
  params: Params, validos: { funis: string[]; responsaveis: string[] },
): FiltrosDashboard {
  const p = um(params.periodo)
  const funil = um(params.funil)
  const resp = um(params.responsavel)
  return {
    periodo:       PERIODOS.find(x => x === p) ?? PERIODO_PADRAO,
    funilId:       funil && validos.funis.includes(funil) ? funil : null,
    responsavelId: resp && validos.responsaveis.includes(resp) ? resp : null,
  }
}

/** Últimos N dias até `agora` (o mesmo corte que o dashboard já usava). */
export function janelaDoPeriodo(periodo: Periodo, agora: Date): Janela {
  if (periodo === 'all') return { desde: null, ate: agora }
  return { desde: new Date(agora.getTime() - parseInt(periodo) * 86_400_000), ate: agora }
}

/** Query string dos filtros, sem os valores padrão. */
export function queryDosFiltros(f: FiltrosDashboard): string {
  const q = new URLSearchParams()
  if (f.periodo !== PERIODO_PADRAO) q.set('periodo', f.periodo)
  if (f.funilId) q.set('funil', f.funilId)
  if (f.responsavelId) q.set('responsavel', f.responsavelId)
  const s = q.toString()
  return s ? `?${s}` : ''
}
