export const FUSO_CAMPANHAS = 'America/Sao_Paulo'

export type StatusCampanha = 'rascunho' | 'agendada' | 'enviando' | 'pausada' | 'concluida' | 'cancelada'

export type MotivoPausa = 'manual' | 'limite_diario' | 'erro_meta' | 'autorizacao' | 'optout'

export type EstadoCampanha =
  | { status: 'rascunho' }
  | { status: 'agendada'; agendadaPara: Date }
  | { status: 'enviando' }
  | { status: 'pausada'; motivo: MotivoPausa | null; retomarEm: Date | null }
  | { status: 'concluida' }
  | { status: 'cancelada' }

const STATUS: readonly StatusCampanha[] = ['rascunho', 'agendada', 'enviando', 'pausada', 'concluida', 'cancelada']
const MOTIVOS: readonly MotivoPausa[] = ['manual', 'limite_diario', 'erro_meta', 'autorizacao', 'optout']

function ehStatus(v: string): v is StatusCampanha {
  return (STATUS as readonly string[]).includes(v)
}

function ehMotivo(v: string): v is MotivoPausa {
  return (MOTIVOS as readonly string[]).includes(v)
}

function data(iso: string | null): Date | null {
  if (!iso) return null
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? null : d
}

export function lerEstadoCampanha(row: {
  status: string; scheduled_at: string | null; motivo_pausa?: string | null; retomar_em?: string | null
}): EstadoCampanha | null {
  if (!ehStatus(row.status)) return null
  switch (row.status) {
    case 'agendada': {
      const agendadaPara = data(row.scheduled_at)
      return agendadaPara ? { status: 'agendada', agendadaPara } : { status: 'rascunho' }
    }
    case 'pausada': {
      const motivo = row.motivo_pausa && ehMotivo(row.motivo_pausa) ? row.motivo_pausa : null
      return { status: 'pausada', motivo, retomarEm: data(row.retomar_em ?? null) }
    }
    default:
      return { status: row.status }
  }
}

export type Disparo = { ok: true } | { ok: false; motivo: string }

export function podeDisparar(estado: EstadoCampanha, agora: Date): Disparo {
  switch (estado.status) {
    case 'rascunho':
    case 'pausada':
      return { ok: true }
    case 'agendada':
      return estado.agendadaPara.getTime() <= agora.getTime()
        ? { ok: true }
        : { ok: false, motivo: `Campanha agendada para ${formatarDataHora(estado.agendadaPara)}; o envio começa sozinho.` }
    case 'enviando':
      return { ok: false, motivo: 'A campanha já está enviando.' }
    case 'concluida':
    case 'cancelada':
      return { ok: false, motivo: `Campanha ${estado.status} não pode ser disparada.` }
  }
}

function partesEmSaoPaulo(instante: Date) {
  const partes = new Intl.DateTimeFormat('en-US', {
    timeZone: FUSO_CAMPANHAS, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(instante)
  const n = (tipo: Intl.DateTimeFormatPartTypes) => Number(partes.find(p => p.type === tipo)?.value)
  return { ano: n('year'), mes: n('month'), dia: n('day'), hora: n('hour'), minuto: n('minute'), segundo: n('second') }
}

function deslocamentoMs(instante: Date): number {
  const p = partesEmSaoPaulo(instante)
  const comoUtc = Date.UTC(p.ano, p.mes - 1, p.dia, p.hora, p.minuto, p.segundo)
  return comoUtc - Math.floor(instante.getTime() / 1000) * 1000
}

export function inicioDoDiaSaoPaulo(agora: Date): Date {
  const p = partesEmSaoPaulo(agora)
  const meiaNoiteComoUtc = Date.UTC(p.ano, p.mes - 1, p.dia)
  return new Date(meiaNoiteComoUtc - deslocamentoMs(new Date(meiaNoiteComoUtc)))
}

export function proximaMeiaNoiteSaoPaulo(agora: Date): Date {
  const inicio = inicioDoDiaSaoPaulo(agora)
  // 26 h passa da meia-noite seguinte mesmo num dia de 25 h (horário de verão)
  return inicioDoDiaSaoPaulo(new Date(inicio.getTime() + 26 * 3600_000))
}

export type DecisaoLote =
  | { tipo: 'concluida' }
  | { tipo: 'limite_diario'; retomarEm: Date }
  | { tipo: 'enviar'; quantidade: number }

export function decidirLote(p: {
  pendentes: number; lote: number; limiteDiario: number; enviadosHojeNaUnidade: number; agora: Date
}): DecisaoLote {
  if (p.pendentes <= 0) return { tipo: 'concluida' }
  const restante = p.limiteDiario - p.enviadosHojeNaUnidade
  if (restante <= 0) return { tipo: 'limite_diario', retomarEm: proximaMeiaNoiteSaoPaulo(p.agora) }
  return { tipo: 'enviar', quantidade: Math.max(0, Math.min(p.lote, restante, p.pendentes)) }
}

type Contagem = { enviados: number; falhas: number }

export type ResultadoLote =
  | ({ tipo: 'concluida' } & Contagem)
  | ({ tipo: 'continua'; pendentes: number } & Contagem)
  | ({ tipo: 'limite_diario'; retomarEm: Date } & Contagem)
  | ({ tipo: 'pausada'; motivo: 'erro_meta' | 'autorizacao'; detalhe: string } & Contagem)
  | { tipo: 'ocupada' }
  | { tipo: 'ignorada'; status: string }

export type AtualizacaoCampanha = {
  status: 'enviando' | 'pausada' | 'concluida'
  motivo_pausa: MotivoPausa | null
  retomar_em: string | null
  completed_at?: string
}

export function atualizacaoAposLote(r: ResultadoLote, agora: Date): AtualizacaoCampanha | null {
  switch (r.tipo) {
    case 'concluida':
      return { status: 'concluida', motivo_pausa: null, retomar_em: null, completed_at: agora.toISOString() }
    case 'continua':
      return { status: 'enviando', motivo_pausa: null, retomar_em: null }
    case 'limite_diario':
      return { status: 'pausada', motivo_pausa: 'limite_diario', retomar_em: r.retomarEm.toISOString() }
    case 'pausada':
      return { status: 'pausada', motivo_pausa: r.motivo, retomar_em: null }
    case 'ocupada':
    case 'ignorada':
      return null
  }
}

export function formatarDataHora(d: Date): string {
  return d.toLocaleString('pt-BR', {
    timeZone: FUSO_CAMPANHAS, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

function formatarHora(d: Date): string {
  return d.toLocaleTimeString('pt-BR', { timeZone: FUSO_CAMPANHAS, hour: '2-digit', minute: '2-digit' })
}

const MOTIVO_TEXTO: Record<MotivoPausa, string> = {
  manual: 'Pausada manualmente',
  limite_diario: 'Limite diário atingido',
  erro_meta: 'Pausada por erro no envio',
  autorizacao: 'Pausada: verifique o token do WhatsApp',
  optout: 'Pausada: muitos pedidos para sair',
}

export function descreverStatus(
  estado: EstadoCampanha, progresso: { enviados: number; total: number }, agora: Date,
): string {
  switch (estado.status) {
    case 'rascunho': return 'Rascunho'
    case 'agendada': return `Agendada para ${formatarDataHora(estado.agendadaPara)}`
    case 'enviando': return `Enviando (${progresso.enviados} de ${progresso.total})`
    case 'concluida': return 'Concluída'
    case 'cancelada': return 'Cancelada'
    case 'pausada': {
      if (estado.motivo !== 'limite_diario' || !estado.retomarEm) {
        return estado.motivo ? MOTIVO_TEXTO[estado.motivo] : 'Pausada'
      }
      const amanha = inicioDoDiaSaoPaulo(new Date(inicioDoDiaSaoPaulo(agora).getTime() + 26 * 3600_000))
      const mesmoDia = inicioDoDiaSaoPaulo(estado.retomarEm).getTime() === amanha.getTime()
      return mesmoDia
        ? `Limite diário atingido · retoma amanhã às ${formatarHora(estado.retomarEm)}`
        : `Limite diário atingido · retoma em ${formatarDataHora(estado.retomarEm)}`
    }
  }
}
