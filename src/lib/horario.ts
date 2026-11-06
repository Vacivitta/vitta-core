/** Faixa de atendimento num dia, em HH:MM; o fim não está incluído (8:00–12:00 fecha às 12:00). */
export interface Faixa { inicio: string; fim: string }

/** Faixas de cada dia da semana; o índice é o dia_semana do banco (0 = domingo). */
export type Semana = Faixa[][]

export interface LinhaFaixa { dia_semana: number; inicio: string; fim: string }

export const NOMES_DIAS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'] as const

/** Ordem de exibição: a semana começa na segunda. */
export const DIAS_NA_TELA = [1, 2, 3, 4, 5, 6, 0] as const

/** Fusos do Brasil que a marca pode dar a uma unidade (units.fuso, migração 141). */
export const FUSOS_BRASIL = [
  { id: 'America/Sao_Paulo',   nome: 'Brasília (SP, RJ, MG, Sul, GO, DF)' },
  { id: 'America/Bahia',       nome: 'Bahia' },
  { id: 'America/Fortaleza',   nome: 'Fortaleza (CE, MA, PI, RN, PB)' },
  { id: 'America/Recife',      nome: 'Recife (PE)' },
  { id: 'America/Maceio',      nome: 'Maceió (AL, SE)' },
  { id: 'America/Belem',       nome: 'Belém (PA, AP)' },
  { id: 'America/Araguaina',   nome: 'Araguaína (TO)' },
  { id: 'America/Cuiaba',      nome: 'Cuiabá (MT)' },
  { id: 'America/Campo_Grande', nome: 'Campo Grande (MS)' },
  { id: 'America/Manaus',      nome: 'Manaus (AM)' },
  { id: 'America/Porto_Velho', nome: 'Porto Velho (RO)' },
  { id: 'America/Boa_Vista',   nome: 'Boa Vista (RR)' },
  { id: 'America/Rio_Branco',  nome: 'Rio Branco (AC)' },
  { id: 'America/Noronha',     nome: 'Fernando de Noronha' },
] as const

const hhmm = (t: string) => t.slice(0, 5)

export function semanaVazia(): Semana {
  return Array.from({ length: 7 }, () => [])
}

export function semanaDasLinhas(linhas: readonly LinhaFaixa[]): Semana {
  const semana = semanaVazia()
  for (const l of linhas) semana[l.dia_semana].push({ inicio: hhmm(l.inicio), fim: hhmm(l.fim) })
  for (const dia of semana) dia.sort((a, b) => a.inicio.localeCompare(b.inicio))
  return semana
}

export function linhasDaSemana(semana: Semana): LinhaFaixa[] {
  return semana.flatMap((faixas, dia_semana) => faixas.map(f => ({ dia_semana, inicio: f.inicio, fim: f.fim })))
}

/** O que impede salvar: faixa vazia, fim antes do início, faixas que se sobrepõem no mesmo dia. */
export function problemasDaSemana(semana: Semana): string[] {
  const problemas: string[] = []
  semana.forEach((faixas, dia) => {
    const nome = NOMES_DIAS[dia]
    const ordenadas = [...faixas].sort((a, b) => a.inicio.localeCompare(b.inicio))
    ordenadas.forEach((f, i) => {
      if (!f.inicio || !f.fim) problemas.push(`${nome}: preencha início e fim`)
      else if (f.fim <= f.inicio) problemas.push(`${nome}: ${f.inicio}–${f.fim} termina antes de começar`)
      const anterior = ordenadas[i - 1]
      if (anterior && f.inicio && anterior.fim > f.inicio) {
        problemas.push(`${nome}: ${anterior.inicio}–${anterior.fim} e ${f.inicio}–${f.fim} se sobrepõem`)
      }
    })
  })
  return problemas
}
