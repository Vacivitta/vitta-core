/**
 * Datas no horário de Brasília, independentes do fuso de onde o código roda.
 *
 * As páginas são renderizadas primeiro no servidor (UTC) e depois no navegador
 * (America/Sao_Paulo). Usar getHours()/format() direto dava resultados diferentes
 * nos dois lados: a linha "agora" da agenda aparecia 3 h adiantada (o React não
 * corrige atributos de estilo vindos do servidor) e o funil disparava o erro de
 * hidratação #418. Converter para o "relógio de parede" de Brasília deixa os dois
 * lados iguais.
 */

export const FUSO_BR = 'America/Sao_Paulo'

const formatoPartes = new Intl.DateTimeFormat('en-US', {
  timeZone: FUSO_BR,
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit',
  hourCycle: 'h23',
})

/** Componentes de data/hora de um instante no horário de Brasília. */
export function partesBR(d: Date) {
  const p: Record<string, string> = {}
  for (const parte of formatoPartes.formatToParts(d)) p[parte.type] = parte.value
  return {
    ano: Number(p.year), mes: Number(p.month), dia: Number(p.day),
    hora: Number(p.hour), minuto: Number(p.minute), segundo: Number(p.second),
  }
}

/**
 * Converte um instante para o "relógio de parede" de Brasília: um Date cujos campos
 * locais (getHours, getDate, format do date-fns, isSameDay...) mostram o horário de
 * Brasília em qualquer fuso. Usar só para exibição e comparação de dias — para
 * gravar no banco, voltar ao instante real com {@link deHorarioBR}.
 */
export function paraHorarioBR(d: Date): Date {
  const p = partesBR(d)
  return new Date(p.ano, p.mes - 1, p.dia, p.hora, p.minuto, p.segundo)
}

/**
 * Instante real (para gravar no banco) de um horário digitado/escolhido em Brasília.
 *
 * @example deHorarioBR(2026, 10, 23, 14, 0) // 2026-10-23T17:00:00.000Z
 */
export function deHorarioBR(ano: number, mes: number, dia: number, hora: number, minuto: number): Date {
  const palpite = Date.UTC(ano, mes - 1, dia, hora, minuto)
  const p = partesBR(new Date(palpite))
  const deslocamento = Date.UTC(p.ano, p.mes - 1, p.dia, p.hora, p.minuto) - palpite
  return new Date(palpite - deslocamento)
}

/** "agora" no relógio de parede de Brasília. */
export function agoraBR(): Date {
  return paraHorarioBR(new Date())
}
