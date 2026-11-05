import type { CampoLead, CamposDoLead, StatusLead } from '@/types/database'
import { formatarValor } from './campos.ts'

// Exportação de leads para CSV (GET /api/leads/exportar): filtros da URL e
// montagem das linhas. Regras puras, testadas em tests/exportacao.test.mjs.

export type FiltroStatus = StatusLead | 'nao_perdido' | 'todos'

export interface FiltrosExportacao {
  funnel_id:       string | null
  stage_ids:       string[]
  responsavel_ids: string[]
  tag_ids:         string[]
  cidade:          string | null
  status:          FiltroStatus
  /** Só quem já é cliente (is_converted), como a tela Clientes */
  clientes:        boolean
  /** Inclui os arquivados (migração 132); padrão: fora, como no funil */
  arquivados:      boolean
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const STATUS: readonly FiltroStatus[] = ['aberto', 'ganho', 'perdido', 'nao_perdido', 'todos']

function listaDeIds(valor: string | null): string[] | null {
  if (!valor) return []
  const ids = valor.split(',').filter(Boolean)
  return ids.every(id => UUID.test(id)) && ids.length <= 200 ? ids : null
}

/** Filtros da query string; null se algum valor for inválido. */
export function lerFiltrosExportacao(params: URLSearchParams): FiltrosExportacao | null {
  const funil = params.get('funnel_id')
  const stageIds = listaDeIds(params.get('stage_ids'))
  const responsavelIds = listaDeIds(params.get('responsavel_ids'))
  const tagIds = listaDeIds(params.get('tag_ids'))
  const status = (params.get('status') ?? 'todos') as FiltroStatus
  const cidade = params.get('cidade')?.trim() ?? ''
  if (funil !== null && !UUID.test(funil)) return null
  if (!stageIds || !responsavelIds || !tagIds || !STATUS.includes(status) || cidade.length > 100) return null
  return {
    funnel_id:       funil,
    stage_ids:       stageIds,
    responsavel_ids: responsavelIds,
    tag_ids:         tagIds,
    cidade:          cidade || null,
    status,
    clientes:        params.get('clientes') === '1',
    arquivados:      params.get('arquivados') === '1',
  }
}

/** Endereço do download com os filtros (só os preenchidos). */
export function urlExportacao(f: Partial<FiltrosExportacao>): string {
  const p = new URLSearchParams()
  if (f.funnel_id) p.set('funnel_id', f.funnel_id)
  if (f.stage_ids?.length) p.set('stage_ids', f.stage_ids.join(','))
  if (f.responsavel_ids?.length) p.set('responsavel_ids', f.responsavel_ids.join(','))
  if (f.tag_ids?.length) p.set('tag_ids', f.tag_ids.join(','))
  if (f.cidade?.trim()) p.set('cidade', f.cidade.trim())
  if (f.status && f.status !== 'todos') p.set('status', f.status)
  if (f.clientes) p.set('clientes', '1')
  if (f.arquivados) p.set('arquivados', '1')
  const qs = p.toString()
  return '/api/leads/exportar' + (qs ? '?' + qs : '')
}

export const SELECT_EXPORTACAO =
  'id, nome, sobrenome, telefone, email, origem, cidade, funnel_id, stage_id, status, motivo_perda_id, motivo_perda,'
  + ' is_converted, responsavel_id, campos, created_at, arquivado, arquivado_motivo'

export interface LeadExportado {
  id:              string
  nome:            string
  sobrenome:       string | null
  telefone:        string | null
  email:           string | null
  origem:          string | null
  cidade:          string | null
  funnel_id:       string | null
  stage_id:        string | null
  status:          StatusLead
  motivo_perda_id: string | null
  motivo_perda:    string | null
  is_converted:    boolean
  responsavel_id:  string | null
  campos:          CamposDoLead | null
  created_at:      string
  arquivado:       boolean
  arquivado_motivo: string | null
}

export interface ContextoExportacao {
  campos:        readonly CampoLead[]
  funis:         ReadonlyMap<string, string>
  etapas:        ReadonlyMap<string, string>
  motivos:       ReadonlyMap<string, string>
  responsaveis:  ReadonlyMap<string, string>
  tagsPorLead:   ReadonlyMap<string, readonly string[]>
}

const STATUS_TEXTO: Record<StatusLead, string> = { aberto: 'Aberto', ganho: 'Ganho', perdido: 'Perdido' }

export function cabecalhoExportacao(campos: readonly CampoLead[]): string[] {
  return [
    'Nome', 'Telefone', 'E-mail', 'Origem', 'Cidade', 'Funil', 'Etapa', 'Status', 'Motivo de perda', 'Cliente',
    'Responsável', 'Tags', ...campos.map(c => c.rotulo), 'Criado em', 'Arquivado',
  ]
}

const DATA_SP = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric' })

/** Instante → dd/mm/aaaa no horário de Brasília. */
export function dataBR(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : DATA_SP.format(d)
}

function motivoDePerda(lead: LeadExportado, motivos: ReadonlyMap<string, string>): string {
  if (lead.status !== 'perdido') return ''
  const nome = lead.motivo_perda_id ? motivos.get(lead.motivo_perda_id) : undefined
  const detalhe = lead.motivo_perda?.trim() ?? ''
  if (nome && detalhe) return `${nome}: ${detalhe}`
  return nome ?? detalhe
}

export function linhaExportacao(lead: LeadExportado, ctx: ContextoExportacao): string[] {
  const doLead = (mapa: ReadonlyMap<string, string>, id: string | null) => (id ? mapa.get(id) ?? '' : '')
  return [
    [lead.nome, lead.sobrenome].filter(Boolean).join(' '),
    lead.telefone ?? '',
    lead.email ?? '',
    lead.origem ?? '',
    lead.cidade ?? '',
    doLead(ctx.funis, lead.funnel_id),
    doLead(ctx.etapas, lead.stage_id),
    STATUS_TEXTO[lead.status] ?? lead.status,
    motivoDePerda(lead, ctx.motivos),
    lead.is_converted ? 'Sim' : 'Não',
    doLead(ctx.responsaveis, lead.responsavel_id),
    (ctx.tagsPorLead.get(lead.id) ?? []).join(', '),
    ...ctx.campos.map(c => formatarValor(c, lead.campos?.[c.chave])),
    dataBR(lead.created_at),
    lead.arquivado ? (lead.arquivado_motivo?.trim() || 'Sim') : '',
  ]
}
