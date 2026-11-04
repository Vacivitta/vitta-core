/**
 * Cálculos do painel "Negócios" do dashboard (status do lead, migração 126).
 * Funções puras: o server component busca as linhas sob RLS, chama
 * `montarPainelNegocios` e manda para o navegador só os agregados.
 */

export type StatusNegocio = 'aberto' | 'ganho' | 'perdido'
export type ResultadoEtapaNegocio = 'ganho' | 'perdido' | null

/** Intervalo do filtro de período; `desde` null = desde sempre. */
export interface Janela { desde: Date | null; ate: Date }

export interface LeadNegocio {
  id:             string
  funnel_id:      string | null
  stage_id:       string | null
  responsavel_id: string | null
  status:         StatusNegocio
  created_at:     string
  ganho_em:       string | null
  perdido_em:     string | null
  /** Motivo de perda já agrupado (`motivoParaAgrupar`), null se não há motivo */
  motivo:         string | null
}

export interface Movimento {
  lead_id:       string
  de_stage_id:   string | null
  para_stage_id: string
  criado_em:     string
  movido_via:    string | null
}

export interface EtapaNegocio {
  id:        string
  funnel_id: string
  nome:      string
  cor:       string
  ordem:     number
  resultado: ResultadoEtapaNegocio
}

export interface OrcamentoNegocio {
  lead_id:         string | null
  status:          string
  total_calculado: number | null
  criado_em:       string
  aceito_em:       string | null
}

/** Primeiro registro de lead_stage_history em produção: antes disso não há movimentos. */
export const HISTORICO_ETAPAS_DESDE = '2026-06-24T00:00:00-03:00'

const DIA_MS  = 86_400_000
const HORA_MS = 3_600_000

/** parte / total, ou null quando não há base (total 0). */
export function taxa(parte: number, total: number): number | null {
  return total > 0 ? parte / total : null
}

function media(valores: number[]): number | null {
  return valores.length > 0 ? valores.reduce((s, v) => s + v, 0) / valores.length : null
}

function ms(iso: string): number {
  return new Date(iso).getTime()
}

/** A data cai na janela? Data nula nunca cai. */
export function naJanela(iso: string | null, janela: Janela): boolean {
  return iso !== null && instanteNaJanela(ms(iso), janela)
}

function instanteNaJanela(t: number, janela: Janela): boolean {
  return (janela.desde === null || t >= janela.desde.getTime()) && t <= janela.ate.getTime()
}

/**
 * Fechado na janela pelo status atual e pela data do fechamento. Sem período
 * ("Tudo") conta também quem não tem data (clientes antigos com ganho_em NULL).
 * Status atual porque reabrir não apaga ganho_em/perdido_em (trigger da 126).
 */
function fechadoNaJanela(lead: LeadNegocio, status: 'ganho' | 'perdido', janela: Janela): boolean {
  if (lead.status !== status) return false
  if (janela.desde === null) return true
  return naJanela(status === 'ganho' ? lead.ganho_em : lead.perdido_em, janela)
}

export function ganhosNaJanela(leads: LeadNegocio[], janela: Janela): LeadNegocio[] {
  return leads.filter(l => fechadoNaJanela(l, 'ganho', janela))
}

export function perdidosNaJanela(leads: LeadNegocio[], janela: Janela): LeadNegocio[] {
  return leads.filter(l => fechadoNaJanela(l, 'perdido', janela))
}

/** Dias entre a criação e o ganho; null sem ganho_em ou com data incoerente (ganho antes da criação). */
export function cicloDias(lead: LeadNegocio): number | null {
  if (!lead.ganho_em) return null
  const dias = (ms(lead.ganho_em) - ms(lead.created_at)) / DIA_MS
  return dias >= 0 ? dias : null
}

export interface Indicadores {
  novos:          number
  ganhos:         number
  perdidos:       number
  abertos:        number
  taxaGanho:      number | null
  cicloMedioDias: number | null
  /** Quantos ganhos entraram na média do ciclo (os que têm ganho_em) */
  cicloBase:      number
}

export function indicadores(leads: LeadNegocio[], janela: Janela): Indicadores {
  const ganhos   = ganhosNaJanela(leads, janela)
  const perdidos = perdidosNaJanela(leads, janela).length
  const ciclos   = ganhos.map(cicloDias).filter((d): d is number => d !== null)
  return {
    novos:          leads.filter(l => naJanela(l.created_at, janela)).length,
    ganhos:         ganhos.length,
    perdidos,
    abertos:        leads.filter(l => l.status === 'aberto').length,
    taxaGanho:      taxa(ganhos.length, ganhos.length + perdidos),
    cicloMedioDias: media(ciclos),
    cicloBase:      ciclos.length,
  }
}

export interface ValorGanho {
  total:        number
  comOrcamento: number
  semOrcamento: number
}

/**
 * Valor dos ganhos: para cada lead ganho, o orçamento aceito mais recente
 * vinculado a ele (um negócio = um orçamento, para não somar recompras antigas).
 * Ganho sem orçamento aceito fica fora da soma e é contado à parte.
 */
export function valorGanho(ganhos: LeadNegocio[], orcamentos: OrcamentoNegocio[]): ValorGanho {
  const ultimoAceito = new Map<string, OrcamentoNegocio>()
  for (const q of orcamentos) {
    if (q.status !== 'aceito' || !q.lead_id) continue
    const atual = ultimoAceito.get(q.lead_id)
    if (!atual || ms(q.aceito_em ?? q.criado_em) > ms(atual.aceito_em ?? atual.criado_em)) ultimoAceito.set(q.lead_id, q)
  }
  let total = 0
  let comOrcamento = 0
  for (const l of ganhos) {
    const q = ultimoAceito.get(l.id)
    if (!q) continue
    comOrcamento++
    total += q.total_calculado ?? 0
  }
  return { total, comOrcamento, semOrcamento: ganhos.length - comOrcamento }
}

export interface Contagem { rotulo: string; total: number }

function contar(chaves: string[]): Contagem[] {
  const m = new Map<string, number>()
  for (const k of chaves) m.set(k, (m.get(k) ?? 0) + 1)
  return [...m].map(([rotulo, total]) => ({ rotulo, total }))
    .sort((a, b) => b.total - a.total || a.rotulo.localeCompare(b.rotulo))
}

export const SEM_MOTIVO = 'Não informado'
export const ETAPA_NAO_REGISTRADA = 'Etapa não registrada'

export function perdasPorMotivo(leads: LeadNegocio[], janela: Janela): Contagem[] {
  return contar(perdidosNaJanela(leads, janela).map(l => l.motivo ?? SEM_MOTIVO))
}

/** Movimentos agrupados por lead, em ordem cronológica. */
export function movimentosPorLead(movimentos: Movimento[]): Map<string, Movimento[]> {
  const m = new Map<string, Movimento[]>()
  for (const mv of movimentos) {
    const lista = m.get(mv.lead_id)
    if (lista) lista.push(mv)
    else m.set(mv.lead_id, [mv])
  }
  for (const lista of m.values()) lista.sort((a, b) => ms(a.criado_em) - ms(b.criado_em))
  return m
}

/**
 * Etapa em que o lead estava quando foi perdido: a etapa atual, ou, se ele foi
 * movido para uma etapa de resultado "perdido", a etapa de onde saiu. Null se
 * isso não está no histórico (perda anterior a 24/06/2026).
 */
export function etapaDaPerda(
  lead: LeadNegocio, movimentos: Movimento[], etapas: Map<string, EtapaNegocio>,
): string | null {
  const atual = lead.stage_id ? etapas.get(lead.stage_id) : undefined
  if (!atual) return null
  if (atual.resultado !== 'perdido') return atual.id
  for (let i = movimentos.length - 1; i >= 0; i--) {
    if (movimentos[i].para_stage_id === atual.id) return movimentos[i].de_stage_id
  }
  return null
}

export function perdasPorEtapa(
  leads: LeadNegocio[], movimentos: Map<string, Movimento[]>, etapas: Map<string, EtapaNegocio>, janela: Janela,
): Contagem[] {
  return contar(perdidosNaJanela(leads, janela).map(l => {
    const id = etapaDaPerda(l, movimentos.get(l.id) ?? [], etapas)
    return (id && etapas.get(id)?.nome) || ETAPA_NAO_REGISTRADA
  }))
}

interface Entrada { etapa: string; em: number; via: string; movimento: Movimento | null }

/**
 * Entradas do lead em etapas: os movimentos e, para leads criados depois do
 * início do histórico, a etapa inicial na data de criação (a de origem do
 * primeiro movimento, ou a atual se ele nunca foi movido; criar não grava
 * histórico).
 */
function entradasDoLead(lead: LeadNegocio, movimentos: Movimento[], historicoDesde: number): Entrada[] {
  const entradas: Entrada[] = []
  const inicial = movimentos.length > 0 ? movimentos[0].de_stage_id : lead.stage_id
  if (inicial && ms(lead.created_at) >= historicoDesde) {
    entradas.push({ etapa: inicial, em: ms(lead.created_at), via: 'criacao', movimento: null })
  }
  for (const mv of movimentos) {
    entradas.push({ etapa: mv.para_stage_id, em: ms(mv.criado_em), via: mv.movido_via ?? 'manual', movimento: mv })
  }
  return entradas
}

/** Ir de `de` para `para` é avançar no funil? Mesmo funil, ordem maior e não é perda; etapa de ganho sempre é. */
export function avancou(de: EtapaNegocio, para: EtapaNegocio): boolean {
  if (para.funnel_id !== de.funnel_id || para.id === de.id) return false
  if (para.resultado === 'ganho') return true
  return para.resultado === null && para.ordem > de.ordem
}

export interface PassagemEtapa {
  entraram:  number
  avancaram: number
  taxa:      number | null
}

/**
 * Taxa de passagem por etapa: dos leads que entraram na etapa dentro da janela
 * (cada lead uma vez, pela primeira entrada), quantos depois foram para uma
 * etapa posterior do mesmo funil ou estão ganhos com ganho_em depois da entrada.
 * Reabertura não conta como entrada: é o negócio fechado voltando ao início,
 * não progresso no funil. Pular etapas conta como avanço da etapa de onde saiu
 * e não como entrada nas puladas.
 */
export function passagemPorEtapa(
  leads: LeadNegocio[], movimentos: Map<string, Movimento[]>, etapas: Map<string, EtapaNegocio>,
  janela: Janela, historicoDesde = ms(HISTORICO_ETAPAS_DESDE),
): Map<string, PassagemEtapa> {
  const resultado = new Map<string, PassagemEtapa>()
  for (const lead of leads) {
    const entradas = entradasDoLead(lead, movimentos.get(lead.id) ?? [], historicoDesde)
    const vistas = new Set<string>()
    entradas.forEach((e, i) => {
      const etapa = etapas.get(e.etapa)
      if (!etapa || etapa.resultado !== null || vistas.has(etapa.id)) return
      if (e.via === 'reabertura' || !instanteNaJanela(e.em, janela)) return
      vistas.add(etapa.id)
      const depois = entradas.slice(i + 1).some(p => {
        const para = etapas.get(p.etapa)
        return para !== undefined && avancou(etapa, para)
      })
      const ganhou = lead.status === 'ganho' && lead.ganho_em !== null && ms(lead.ganho_em) >= e.em
      const p = resultado.get(etapa.id) ?? { entraram: 0, avancaram: 0, taxa: null }
      p.entraram++
      if (depois || ganhou) p.avancaram++
      resultado.set(etapa.id, p)
    })
  }
  for (const p of resultado.values()) p.taxa = taxa(p.avancaram, p.entraram)
  return resultado
}

export interface TempoEtapa { mediaHoras: number; saidas: number }

/**
 * Tempo médio na etapa: para cada saída da etapa dentro da janela, o tempo
 * desde a entrada anterior nela. Saída por reabertura não conta (o negócio
 * estava fechado, não sendo trabalhado na etapa).
 */
export function tempoPorEtapa(
  leads: LeadNegocio[], movimentos: Map<string, Movimento[]>, janela: Janela,
  historicoDesde = ms(HISTORICO_ETAPAS_DESDE),
): Map<string, TempoEtapa> {
  const horas = new Map<string, number[]>()
  for (const lead of leads) {
    const entradas = entradasDoLead(lead, movimentos.get(lead.id) ?? [], historicoDesde)
    for (let i = 1; i < entradas.length; i++) {
      const saida = entradas[i].movimento
      const anterior = entradas[i - 1]
      if (!saida || saida.de_stage_id !== anterior.etapa || saida.movido_via === 'reabertura') continue
      if (!naJanela(saida.criado_em, janela)) continue
      const h = (entradas[i].em - anterior.em) / HORA_MS
      if (h < 0) continue
      const lista = horas.get(anterior.etapa)
      if (lista) lista.push(h)
      else horas.set(anterior.etapa, [h])
    }
  }
  const resultado = new Map<string, TempoEtapa>()
  for (const [etapa, lista] of horas) resultado.set(etapa, { mediaHoras: media(lista) ?? 0, saidas: lista.length })
  return resultado
}

export interface LinhaRanking {
  responsavel_id: string | null
  ganhos:         number
  perdidos:       number
  taxa:           number | null
}

/** Ganhos e perdidos na janela por responsável atual do lead. */
export function rankingResponsaveis(leads: LeadNegocio[], janela: Janela): LinhaRanking[] {
  const m = new Map<string | null, LinhaRanking>()
  const linha = (id: string | null) => {
    let r = m.get(id)
    if (!r) { r = { responsavel_id: id, ganhos: 0, perdidos: 0, taxa: null }; m.set(id, r) }
    return r
  }
  for (const l of ganhosNaJanela(leads, janela)) linha(l.responsavel_id).ganhos++
  for (const l of perdidosNaJanela(leads, janela)) linha(l.responsavel_id).perdidos++
  const linhas = [...m.values()]
  for (const r of linhas) r.taxa = taxa(r.ganhos, r.ganhos + r.perdidos)
  return linhas.sort((a, b) => b.ganhos - a.ganhos || (b.taxa ?? 0) - (a.taxa ?? 0) || a.perdidos - b.perdidos)
}

export interface EtapaPainel {
  id:              string
  nome:            string
  cor:             string
  resultado:       ResultadoEtapaNegocio
  abertos:         number
  entraram:        number
  avancaram:       number
  taxaPassagem:    number | null
  tempoMedioHoras: number | null
  saidas:          number
}

export interface FunilPainel { id: string; nome: string; etapas: EtapaPainel[] }

export interface PainelNegocios {
  indicadores:     Indicadores
  valor:           ValorGanho
  perdasPorMotivo: Contagem[]
  perdasPorEtapa:  Contagem[]
  funis:           FunilPainel[]
  ranking:         LinhaRanking[]
  historicoDesde:  string
}

/**
 * Painel inteiro a partir das linhas já filtradas por funil e responsável.
 * `movimentos` pode vir da unidade toda: só contam os dos leads recebidos.
 */
export function montarPainelNegocios(entrada: {
  leads:      LeadNegocio[]
  movimentos: Movimento[]
  etapas:     EtapaNegocio[]
  funis:      { id: string; nome: string }[]
  orcamentos: OrcamentoNegocio[]
  janela:     Janela
}): PainelNegocios {
  const { leads, etapas, funis, orcamentos, janela } = entrada
  const ids = new Set(leads.map(l => l.id))
  const movimentos = movimentosPorLead(entrada.movimentos.filter(m => ids.has(m.lead_id)))
  const porId = new Map(etapas.map(e => [e.id, e]))
  const passagem = passagemPorEtapa(leads, movimentos, porId, janela)
  const tempo = tempoPorEtapa(leads, movimentos, janela)
  const abertos = new Map<string, number>()
  for (const l of leads) {
    if (l.status === 'aberto' && l.stage_id) abertos.set(l.stage_id, (abertos.get(l.stage_id) ?? 0) + 1)
  }
  const ganhos = ganhosNaJanela(leads, janela)

  return {
    indicadores:     indicadores(leads, janela),
    valor:           valorGanho(ganhos, orcamentos),
    perdasPorMotivo: perdasPorMotivo(leads, janela),
    perdasPorEtapa:  perdasPorEtapa(leads, movimentos, porId, janela),
    funis: funis.map(f => ({
      id: f.id,
      nome: f.nome,
      etapas: etapas.filter(e => e.funnel_id === f.id).sort((a, b) => a.ordem - b.ordem).map(e => {
        const p = passagem.get(e.id)
        const t = tempo.get(e.id)
        return {
          id: e.id, nome: e.nome, cor: e.cor, resultado: e.resultado,
          abertos:         abertos.get(e.id) ?? 0,
          entraram:        p?.entraram ?? 0,
          avancaram:       p?.avancaram ?? 0,
          taxaPassagem:    p?.taxa ?? null,
          tempoMedioHoras: t?.mediaHoras ?? null,
          saidas:          t?.saidas ?? 0,
        }
      }),
    })).filter(f => f.etapas.length > 0),
    ranking:        rankingResponsaveis(leads, janela),
    historicoDesde: HISTORICO_ETAPAS_DESDE,
  }
}
