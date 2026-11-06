'use client'

import { useState, useEffect, useMemo, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { Profile }  from '@/types/database'
import type { CampaignRow, TemplateRow, FunnelStageRow } from './page'
import { formatarTelefone, normalizarTelefone, normalizarWaPhone, variantesTelefone } from '@/lib/telefone'
import { decodificarArquivo, ehPlanilhaExcel, lerCsv, registroVazio } from '@/lib/csv'
import {
  descreverStatus, formatarDataHora, lerEstadoCampanha, podeDisparar,
  type DestinatarioNovo, type PedidoCampanha, type ResultadoLote,
} from '@/lib/whatsapp/campanha-regras'

// ── Types ─────────────────────────────────────────────────────────────────────

interface LeadAudience {
  id: string; nome: string; sobrenome: string | null
  telefone: string | null; wa_optin_at: string | null; wa_optout_at: string | null
}

interface XlsContact {
  nome: string
  telefone: string
  raw: string        // linha original para debug
}

interface Props {
  currentUser:       Profile
  initialCampaigns:  CampaignRow[]
  templates:         TemplateRow[]
  stages:            FunnelStageRow[]
  embedded?:         boolean   // true quando renderizado dentro de outra página
}

type WizardStep = 1 | 2 | 3

type ResultadoResumo =
  | Exclude<ResultadoLote, { tipo: 'limite_diario' }>
  | (Omit<Extract<ResultadoLote, { tipo: 'limite_diario' }>, 'retomarEm'> & { retomarEm: string })

function mensagemDoLote(r: ResultadoResumo | null): string {
  if (!r) return 'Envio iniciado; continua sozinho a cada minuto.'
  switch (r.tipo) {
    case 'continua':      return `${r.enviados} enviadas agora; o restante continua sozinho a cada minuto.`
    case 'concluida':     return `${r.enviados} enviadas · campanha concluída.`
    case 'limite_diario': return `Limite diário do número atingido; retoma em ${formatarDataHora(new Date(r.retomarEm))}.`
    case 'pausada':       return `Pausada: ${r.detalhe}`
    case 'ocupada':       return 'Envio em andamento; continua sozinho a cada minuto.'
    case 'ignorada':      return `Campanha ${r.status}.`
  }
}
const STATUS_COLOR: Record<string, { bg: string; text: string }> = {
  rascunho:  { bg: '#F1EFE5', text: '#71856F' },
  agendada:  { bg: '#EDE9FE', text: '#6D28D9' },
  enviando:  { bg: '#E8F4E6', text: '#3E9849' },
  pausada:   { bg: '#FEF3E2', text: '#C17A0A' },
  concluida: { bg: '#DCFCE7', text: '#166534' },
  cancelada: { bg: '#FEE2E2', text: '#B91C1C' },
}

const USD_BRL = 5.90

const SEM_LEADS: LeadAudience[] = []

function fmtBrl(usd: number) {
  return (usd * USD_BRL).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function CampanhasClient({ currentUser, initialCampaigns, templates, stages, embedded = false }: Props) {
  const supabase = createClient()

  const [campaigns, setCampaigns] = useState<CampaignRow[]>(initialCampaigns)
  const [showWizard, setShowWizard] = useState(false)

  // Realtime
  useEffect(() => {
    const ch = supabase.channel('campanhas_list')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'wa_campaigns', filter: `unit_id=eq.${currentUser.unit_id}` }, payload => {
        if (payload.eventType === 'INSERT') setCampaigns(p => [payload.new as CampaignRow, ...p])
        else if (payload.eventType === 'UPDATE') setCampaigns(p => p.map(c => c.id === payload.new.id ? payload.new as CampaignRow : c))
        else if (payload.eventType === 'DELETE') setCampaigns(p => p.filter(c => c.id !== payload.old.id))
      }).subscribe()
    return () => { void supabase.removeChannel(ch) }
  }, [supabase, currentUser.unit_id])

  const S = {
    ink: '#25402C', muted: '#9AA79C', border: '#EBE7DA',
    card: { background: '#fff', border: '1px solid #EBE7DA', borderRadius: 14, padding: '18px 20px' } as React.CSSProperties,
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Header — oculto quando embutido dentro de outra página */}
      {!embedded && (
        <header style={{ background: '#fff', borderBottom: '1px solid #EBE7DA', padding: '14px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
          <div>
            <h1 style={{ fontSize: 16, fontWeight: 800, color: S.ink, margin: 0 }}>Campanhas WhatsApp</h1>
            <p style={{ fontSize: 12, color: S.muted, margin: '2px 0 0' }}>Disparos em massa com rastreamento de custo e consentimento</p>
          </div>
          <button onClick={() => setShowWizard(true)}
            style={{ padding: '9px 20px', fontSize: 13, fontWeight: 700, background: '#25402C', color: '#fff', border: 'none', borderRadius: 11, cursor: 'pointer' }}>
            + Nova campanha
          </button>
        </header>
      )}

      {/* Lista */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 24 }}>
        {embedded && (
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
            <button onClick={() => setShowWizard(true)}
              style={{ padding: '9px 20px', fontSize: 13, fontWeight: 700, background: '#25402C', color: '#fff', border: 'none', borderRadius: 11, cursor: 'pointer' }}>
              + Nova campanha
            </button>
          </div>
        )}
        {campaigns.length === 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', paddingTop: 80, gap: 12 }}>
            <svg width="48" height="48" fill="none" stroke="#C8D6E0" viewBox="0 0 24 24" strokeWidth="1.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
            <p style={{ fontSize: 14, fontWeight: 600, color: '#71856F', margin: 0 }}>Nenhuma campanha ainda</p>
            <p style={{ fontSize: 12, color: S.muted, margin: 0 }}>Crie sua primeira campanha para disparar mensagens em massa</p>
            <button onClick={() => setShowWizard(true)}
              style={{ marginTop: 8, padding: '9px 20px', fontSize: 13, fontWeight: 700, background: '#25402C', color: '#fff', border: 'none', borderRadius: 11, cursor: 'pointer' }}>
              + Nova campanha
            </button>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {campaigns.map(c => (
              <CampaignCard key={c.id} c={c}
                onUpdate={updated => setCampaigns(p => p.map(x => x.id === updated.id ? updated : x))} />
            ))}
          </div>
        )}
      </div>

      {/* Wizard modal */}
      {showWizard && (
        <CampaignWizard
          currentUser={currentUser}
          templates={templates}
          stages={stages}
          onClose={() => setShowWizard(false)}
          onCreated={c => { setCampaigns(p => [c, ...p]); setShowWizard(false) }}
        />
      )}
    </div>
  )
}

// ── Campaign Card ─────────────────────────────────────────────────────────────

function CampaignCard({ c, onUpdate }: { c: CampaignRow; onUpdate: (c: CampaignRow) => void }) {
  const [acting, setActing] = useState(false)
  const [actionMsg, setActionMsg] = useState('')

  const sc = STATUS_COLOR[c.status] ?? STATUS_COLOR.rascunho
  const sentPct = c.total_recipients > 0 ? Math.round(c.sent_count / c.total_recipients * 100) : 0
  const optoutPct = c.sent_count > 0 ? (c.optout_count / c.sent_count * 100).toFixed(1) : '0'

  const estado = lerEstadoCampanha(c)
  const agora = new Date()
  const canDispatch = !!estado && podeDisparar(estado, agora).ok
  const canPause    = estado?.status === 'enviando' || (estado?.status === 'pausada' && estado.motivo === 'limite_diario')
  const canCancel   = ['rascunho', 'agendada', 'pausada', 'enviando'].includes(c.status)
  const statusTexto = estado
    ? descreverStatus(estado, { enviados: c.sent_count, total: c.total_recipients }, agora)
    : c.status

  async function handleDispatch() {
    setActing(true); setActionMsg('Iniciando envio...')
    const res = await fetch('/api/whatsapp/campaign-process', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ campaign_id: c.id }),
    })
    const data = await res.json() as { resultado?: ResultadoResumo | null; error?: string }
    setActing(false)
    if (!res.ok) { setActionMsg(data.error ?? 'Erro ao disparar'); return }
    setActionMsg(mensagemDoLote(data.resultado ?? null))
  }

  async function handleAction(action: 'pause' | 'cancel') {
    setActing(true)
    const res = await fetch('/api/whatsapp/campaign-process', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ campaign_id: c.id, action }),
    })
    const data = await res.json() as { status?: string; motivo_pausa?: string | null; retomar_em?: string | null; error?: string }
    if (res.ok && data.status) {
      onUpdate({ ...c, status: data.status, motivo_pausa: data.motivo_pausa ?? null, retomar_em: data.retomar_em ?? null })
    } else if (!res.ok) {
      setActionMsg(data.error ?? 'Erro ao alterar a campanha')
    }
    setActing(false)
  }

  return (
    <div style={{ background: '#fff', border: '1px solid #EBE7DA', borderRadius: 14, padding: '16px 20px' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 12 }}>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <span style={{ fontSize: 14, fontWeight: 700, color: '#25402C' }}>{c.nome}</span>
            <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 99, background: sc.bg, color: sc.text }}>
              {statusTexto}
            </span>
            <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 99, background: '#F1EFE5', color: '#71856F' }}>
              {c.template_category === 'marketing' ? 'Marketing' : 'Utility'}
            </span>
          </div>
          <p style={{ fontSize: 12, color: '#9AA79C', margin: 0 }}>
            {c.template_nome ?? 'Template não definido'}
            {c.scheduled_at && c.status !== 'agendada' && ` · Agendada para ${formatarDataHora(new Date(c.scheduled_at))}`}
            {` · Limite de ${c.daily_limit} envios por dia neste número`}
          </p>
        </div>
        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          <p style={{ fontSize: 16, fontWeight: 800, color: '#25402C', margin: 0, letterSpacing: '-0.02em' }}>
            {fmtBrl(c.actual_cost_usd > 0 ? c.actual_cost_usd : c.estimated_cost_usd)}
          </p>
          <p style={{ fontSize: 10, color: '#9AA79C', margin: '2px 0 0' }}>
            {c.actual_cost_usd > 0 ? 'custo real' : 'estimado'}
          </p>
        </div>
      </div>

      {/* Métricas */}
      <div style={{ display: 'flex', gap: 16, marginBottom: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        {[
          { label: 'Destinatários', val: c.total_recipients },
          { label: 'Enviadas',      val: c.sent_count },
          { label: 'Entregues',     val: c.delivered_count },
          { label: 'Lidas',         val: c.read_count },
          { label: 'Responderam',   val: c.replied_count },
          { label: 'Bloquearam',    val: c.optout_count, warn: c.optout_count > 0 },
        ].map(m => (
          <div key={m.label}>
            <p style={{ fontSize: 11, color: m.warn ? '#C01C1C' : '#9AA79C', margin: 0 }}>{m.label}</p>
            <p style={{ fontSize: 15, fontWeight: 700, color: m.warn ? '#C01C1C' : '#25402C', margin: '1px 0 0', letterSpacing: '-0.02em' }}>{m.val}</p>
          </div>
        ))}
        {/* Taxas de conversão */}
        {c.sent_count > 0 && (
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            {c.read_count > 0 && (
              <span style={{ fontSize: 11, fontWeight: 600, padding: '3px 9px', borderRadius: 8, background: '#E8F4E6', color: '#0065A0' }}>
                {Math.round(c.read_count / c.sent_count * 100)}% leitura
              </span>
            )}
            {c.replied_count > 0 && (
              <span style={{ fontSize: 11, fontWeight: 600, padding: '3px 9px', borderRadius: 8, background: '#DCFCE7', color: '#166534' }}>
                {Math.round(c.replied_count / c.sent_count * 100)}% resposta
              </span>
            )}
            {parseFloat(optoutPct) >= 3 && (
              <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 8, background: '#FEE2E2', color: '#B91C1C' }}>
                {optoutPct}% bloquearam
              </span>
            )}
          </div>
        )}
      </div>

      {/* Barra de progresso de envio */}
      {(c.status === 'enviando' || c.status === 'concluida') && c.total_recipients > 0 && (
        <div style={{ height: 4, background: '#F0F3F6', borderRadius: 99, overflow: 'hidden', marginBottom: 10 }}>
          <div style={{ height: '100%', width: `${sentPct}%`, background: c.status === 'concluida' ? '#3E9849' : '#3E9849', borderRadius: 99, transition: 'width .5s' }} />
        </div>
      )}

      {/* Botões de ação */}
      {(canDispatch || canPause || canCancel) && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8 }}>
          {canDispatch && (
            <button onClick={() => void handleDispatch()} disabled={acting}
              style={{ padding: '7px 16px', fontSize: 12, fontWeight: 700, border: 'none', borderRadius: 9,
                cursor: acting ? 'default' : 'pointer', background: acting ? '#EBE7DA' : '#3E9849',
                color: acting ? '#9AA79C' : '#fff' }}>
              {acting ? 'Processando...' : c.status === 'pausada' ? '▶ Retomar envio' : '▶ Disparar agora'}
            </button>
          )}
          {canPause && (
            <button onClick={() => void handleAction('pause')} disabled={acting}
              style={{ padding: '7px 14px', fontSize: 12, fontWeight: 600, border: '1px solid #EBE7DA', borderRadius: 9,
                cursor: 'pointer', background: '#fff', color: '#71856F' }}>
              {c.status === 'pausada' ? '⏸ Não retomar sozinha' : '⏸ Pausar'}
            </button>
          )}
          {canCancel && (
            <button onClick={() => void handleAction('cancel')} disabled={acting}
              style={{ padding: '7px 14px', fontSize: 12, fontWeight: 600, border: '1px solid #FEE2E2', borderRadius: 9,
                cursor: 'pointer', background: '#fff', color: '#B91C1C' }}>
              Cancelar
            </button>
          )}
          {actionMsg && <span style={{ fontSize: 11, color: '#71856F', marginLeft: 4 }}>{actionMsg}</span>}
        </div>
      )}
    </div>
  )
}

// ── Wizard ────────────────────────────────────────────────────────────────────

function CampaignWizard({ currentUser, templates, stages, onClose, onCreated }: {
  currentUser: Profile; templates: TemplateRow[]; stages: FunnelStageRow[]
  onClose: () => void; onCreated: (c: CampaignRow) => void
}) {
  const supabase = createClient()
  const [step, setStep] = useState<WizardStep>(1)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // Step 1 — Audiência
  const [nome, setNome] = useState('')
  const [audienceSource, setAudienceSource] = useState<'crm' | 'xls'>('crm')

  // CRM source
  const [filterStage, setFilterStage] = useState('')
  const [filterFunnel, setFilterFunnel] = useState('')
  const [filterTag, setFilterTag] = useState('')
  const [unitTags, setUnitTags] = useState<Array<{ id: string; name: string }>>([])
  // Última audiência buscada e os filtros com que foi buscada
  const [audiencia, setAudiencia] = useState<{ chave: string; leads: LeadAudience[] } | null>(null)
  const chaveAudiencia = [filterTag, filterStage, filterFunnel].join('|')
  const audienceRaw = audiencia?.leads ?? SEM_LEADS
  const loadingAudience = audiencia?.chave !== chaveAudiencia
  const [includeNoOptin, setIncludeNoOptin] = useState(false)

  // XLS source
  const [xlsContacts, setXlsContacts] = useState<XlsContact[]>([])
  const [xlsError, setXlsError] = useState('')
  const [xlsParsing, setXlsParsing] = useState(false)

  // Step 2 — Template
  const [templateId, setTemplateId] = useState('')

  // Step 3 — Revisão
  const [scheduleFor, setScheduleFor] = useState('')
  const [dailyLimit, setDailyLimit] = useState(250)
  const [cswMap, setCswMap] = useState<Record<string, boolean>>({})

  const funnels = useMemo(() => {
    const seen = new Set<string>()
    return stages.filter(s => s.funnel && !seen.has(s.funnel_id) && seen.add(s.funnel_id)).map(s => s.funnel!)
  }, [stages])

  const selectedTemplate = templates.find(t => t.id === templateId)
  const isMarketing = selectedTemplate?.category !== 'utility'

  // Audiência filtrada por opt-in/opt-out (CRM) ou XLS
  const audience = useMemo(() => {
    if (audienceSource === 'xls') return [] // XLS usa xlsContacts diretamente
    return audienceRaw
      .filter(l => !l.wa_optout_at)
      .filter(l => includeNoOptin ? true : !!l.wa_optin_at)
      .flatMap(l => {
        const norm = normalizarTelefone(l.telefone)
        return norm ? [{ ...l, norm }] : []
      })
  }, [audienceRaw, includeNoOptin, audienceSource])

  const activeAudienceCount = audienceSource === 'xls' ? xlsContacts.length : audience.length
  const withOptin    = audience.filter(l => !!l.wa_optin_at).length
  const withoutOptin = audience.filter(l => !l.wa_optin_at).length
  const optoutExcluded = audienceRaw.filter(l => !!l.wa_optout_at).length

  // Custo estimado
  const costEstimate = useMemo(() => {
    if (!selectedTemplate) return { freeCount: 0, paidCount: 0, totalUsd: 0 }
    if (audienceSource === 'xls') {
      // XLS: sem CSW — tudo cobrado na categoria do template
      return isMarketing
        ? { freeCount: 0, paidCount: xlsContacts.length, totalUsd: xlsContacts.length * 0.0625 }
        : { freeCount: 0, paidCount: xlsContacts.length, totalUsd: xlsContacts.length * 0.0068 }
    }
    if (isMarketing) {
      return { freeCount: 0, paidCount: audience.length, totalUsd: audience.length * 0.0625 }
    }
    const freeCount = audience.filter(l => cswMap[l.norm]).length
    const paidCount = audience.length - freeCount
    return { freeCount, paidCount, totalUsd: paidCount * 0.0068 }
  }, [audience, xlsContacts, selectedTemplate, isMarketing, cswMap, audienceSource])

  const limiteValido = Number.isInteger(dailyLimit) && dailyLimit >= 1
  const diasDeEnvio = limiteValido ? Math.ceil(activeAudienceCount / dailyLimit) : 0

  const buscarAudiencia = useCallback(async (): Promise<LeadAudience[]> => {
    if (!currentUser.unit_id) return []
    const colunas = 'id, nome, sobrenome, telefone, wa_optin_at, wa_optout_at'
    // !inner: só os leads com a tag (lead_tags, migração 127)
    let q = filterTag
      ? supabase.from('leads').select(`${colunas}, lead_tags!inner(tag_id)`).eq('lead_tags.tag_id', filterTag)
      : supabase.from('leads').select(colunas)
    // Arquivados (spam, engano, fornecedor...; migração 132) não recebem campanha
    q = q.neq('status', 'perdido').eq('arquivado', false).eq('unit_id', currentUser.unit_id)
    if (filterStage)  q = q.eq('stage_id', filterStage)
    if (filterFunnel) q = q.eq('funnel_id', filterFunnel)
    const { data } = await q.limit(500)
    return (data ?? []) as LeadAudience[]
  }, [supabase, currentUser.unit_id, filterTag, filterStage, filterFunnel])

  // Os filtros só existem no passo 1: busca ao abrir e a cada filtro; resposta
  // de um filtro anterior que chegue depois é descartada
  useEffect(() => {
    let atual = true
    void buscarAudiencia().then(leads => { if (atual) setAudiencia({ chave: chaveAudiencia, leads }) })
    return () => { atual = false }
  }, [buscarAudiencia, chaveAudiencia])

  useEffect(() => {
    if (!currentUser.unit_id) return
    void supabase.from('wa_tags').select('id,name').eq('unit_id', currentUser.unit_id).eq('tipo', 'lead').order('name')
      .then(({ data }) => setUnitTags(data ?? []))
  }, [supabase, currentUser.unit_id])

  // wa_phone é o wa_id da Meta (celular às vezes sem o 9): compara pelas variantes
  const buscarCsw = useCallback(async (): Promise<Record<string, boolean> | null> => {
    if (!currentUser.unit_id) return null
    const variantes = [...new Set(audience.flatMap(l => variantesTelefone(l.norm)))]
    if (variantes.length === 0) return null
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
    const map: Record<string, boolean> = {}
    for (let i = 0; i < variantes.length; i += 200) {
      const { data } = await supabase
        .from('wa_conversations')
        .select('wa_phone')
        .eq('unit_id', currentUser.unit_id)
        .in('wa_phone', variantes.slice(i, i + 200))
        .gte('last_message_at', cutoff)
      for (const row of data ?? []) {
        const norm = normalizarWaPhone(row.wa_phone)
        if (norm) map[norm] = true
      }
    }
    return map
  }, [supabase, currentUser.unit_id, audience])

  // Verifica CSW (janela 24h) para templates Utility ao chegar no step 3
  useEffect(() => {
    if (step !== 3 || isMarketing || audience.length === 0) return
    let atual = true
    void buscarCsw().then(map => { if (atual && map) setCswMap(map) })
    return () => { atual = false }
  }, [step, isMarketing, audience.length, buscarCsw])

  async function handleCreate() {
    if (!nome.trim())              { setError('Informe o nome da campanha.'); return }
    if (!selectedTemplate)         { setError('Selecione um template.'); return }
    if (activeAudienceCount === 0) { setError('Nenhum destinatário válido.'); return }
    if (!limiteValido) { setError('Informe um limite diário de pelo menos 1 envio.'); return }
    // datetime-local vem sem fuso; new Date() lê no fuso do navegador
    const agendadaPara = scheduleFor ? new Date(scheduleFor) : null
    if (agendadaPara && (Number.isNaN(agendadaPara.getTime()) || agendadaPara.getTime() < Date.now())) {
      setError('Escolha uma data de agendamento no futuro.'); return
    }

    // Total e custo da campanha o banco soma dos destinatários
    const destinatarios: DestinatarioNovo[] = audienceSource === 'xls'
      ? xlsContacts.map(c => ({
          lead_id:   null,
          phone:     c.telefone,
          nome:      c.nome,
          has_optin: true,
          in_csw:    false,
          cost_usd:  isMarketing ? 0.0625 : 0.0068,
        }))
      : audience.map(l => ({
          lead_id:   l.id,
          phone:     l.norm,
          nome:      [l.nome, l.sobrenome].filter(Boolean).join(' '),
          has_optin: !!l.wa_optin_at,
          in_csw:    !isMarketing && (cswMap[l.norm] ?? false),
          cost_usd:  isMarketing ? 0.0625 : cswMap[l.norm] ? 0 : 0.0068,
        }))
    const pedido: PedidoCampanha = {
      nome:          nome.trim(),
      template_id:   selectedTemplate.id,
      agendada_para: agendadaPara?.toISOString() ?? null,
      limite_diario: dailyLimit,
      destinatarios,
    }

    setSaving(true); setError('')
    try {
      const res = await fetch('/api/whatsapp/campaign-create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(pedido),
      })
      const json = await res.json().catch(() => null) as { campanha?: CampaignRow; error?: string } | null
      if (!res.ok || !json?.campanha) {
        setError(json?.error ?? 'Erro ao criar campanha. Tente novamente.')
        setSaving(false)
        return
      }
      onCreated(json.campanha)
    } catch {
      setError('Erro ao criar campanha. Tente novamente.')
      setSaving(false)
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  const STEPS = ['Audiência', 'Template', 'Revisão']

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(14,44,61,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 500 }}>
      <div style={{ background: '#fff', borderRadius: 20, width: 620, maxWidth: '95vw', maxHeight: '90vh', display: 'flex', flexDirection: 'column', boxShadow: '0 24px 64px rgba(0,0,0,0.22)' }}>
        {/* Header */}
        <div style={{ padding: '20px 24px 0', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
            <h2 style={{ fontSize: 16, fontWeight: 800, color: '#25402C', margin: 0 }}>Nova campanha</h2>
            <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9AA79C', fontSize: 20, lineHeight: 1, padding: 0 }}>×</button>
          </div>
          {/* Progress steps */}
          <div style={{ display: 'flex', gap: 0, marginBottom: 24 }}>
            {STEPS.map((s, i) => {
              const idx = i + 1
              const active = step === idx
              const done   = step > idx
              return (
                <div key={s} style={{ flex: 1, display: 'flex', alignItems: 'center' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <div style={{ width: 22, height: 22, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700,
                      background: done ? '#3E9849' : active ? '#25402C' : '#F1EFE5',
                      color: done || active ? '#fff' : '#9AA79C', flexShrink: 0 }}>
                      {done ? '✓' : idx}
                    </div>
                    <span style={{ fontSize: 12, fontWeight: active ? 700 : 500, color: active ? '#25402C' : done ? '#3E9849' : '#9AA79C' }}>{s}</span>
                  </div>
                  {i < STEPS.length - 1 && <div style={{ flex: 1, height: 1, background: done ? '#3E9849' : '#EBE7DA', margin: '0 8px' }} />}
                </div>
              )
            })}
          </div>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '0 24px' }}>

          {/* ── Step 1: Audiência ── */}
          {step === 1 && (
            <div style={{ paddingBottom: 8 }}>
              <div style={{ marginBottom: 14 }}>
                <Label>Nome da campanha</Label>
                <input value={nome} onChange={e => setNome(e.target.value)} placeholder="Ex: Campanha de vacinação junho"
                  style={inputSt} />
              </div>

              {/* Seletor de source */}
              <div style={{ display: 'flex', gap: 6, marginBottom: 16, background: '#F1EFE5', borderRadius: 10, padding: 4 }}>
                {(['crm', 'xls'] as const).map(src => (
                  <button key={src} onClick={() => setAudienceSource(src)}
                    style={{ flex: 1, padding: '7px 0', fontSize: 12, fontWeight: 700, border: 'none', borderRadius: 8, cursor: 'pointer',
                      background: audienceSource === src ? '#fff' : 'transparent',
                      color: audienceSource === src ? '#25402C' : '#9AA79C',
                      boxShadow: audienceSource === src ? '0 1px 4px rgba(0,0,0,0.10)' : 'none' }}>
                    {src === 'crm' ? 'CRM' : 'Importar XLS'}
                  </button>
                ))}
              </div>

              {/* ── XLS upload ── */}
              {audienceSource === 'xls' && (
                <XlsImporter
                  contacts={xlsContacts}
                  parsing={xlsParsing}
                  error={xlsError}
                  onParse={(contacts, err) => { setXlsContacts(contacts); setXlsError(err) }}
                  onParsing={setXlsParsing}
                />
              )}

              {/* ── CRM filters ── */}
              {audienceSource === 'crm' && (<>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10, marginBottom: 14 }}>
                  <div>
                    <Label>Filtrar por funil</Label>
                    <select value={filterFunnel} onChange={e => { setFilterFunnel(e.target.value); setFilterStage('') }} style={selectSt}>
                      <option value="">Todos os funis</option>
                      {funnels.map(f => <option key={f.id} value={f.id}>{f.nome}</option>)}
                    </select>
                  </div>
                  <div>
                    <Label>Filtrar por estágio</Label>
                    <select value={filterStage} onChange={e => setFilterStage(e.target.value)} style={selectSt}>
                      <option value="">Todos os estágios</option>
                      {stages.filter(s => !filterFunnel || s.funnel_id === filterFunnel).map(s => (
                        <option key={s.id} value={s.id}>{s.nome}</option>
                      ))}
                    </select>
                  </div>
                  {unitTags.length > 0 && (
                    <div>
                      <Label>Filtrar por tag do cliente</Label>
                      <select value={filterTag} onChange={e => setFilterTag(e.target.value)} style={selectSt}>
                        <option value="">Todas as tags</option>
                        {unitTags.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                      </select>
                    </div>
                  )}
                </div>

                <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14, cursor: 'pointer' }}>
                  <input type="checkbox" checked={includeNoOptin} onChange={e => setIncludeNoOptin(e.target.checked)}
                    style={{ accentColor: '#3E9849', width: 14, height: 14 }} />
                  <span style={{ fontSize: 12, color: '#71856F' }}>Incluir contatos sem Autorização WA confirmada</span>
                </label>

                {loadingAudience ? (
                  <p style={{ fontSize: 12, color: '#9AA79C', textAlign: 'center', padding: '20px 0' }}>Carregando contatos...</p>
                ) : (
                  <div style={{ border: '1px solid #EBE7DA', borderRadius: 12, overflow: 'hidden' }}>
                    <div style={{ padding: '12px 14px', background: '#FBFAF4', display: 'flex', gap: 20, flexWrap: 'wrap' }}>
                      <Stat label="Selecionados" val={audience.length} color="#25402C" />
                      <Stat label="Autorizados WA" val={withOptin} color="#166534" />
                      {withoutOptin > 0 && <Stat label="Sem autorização" val={withoutOptin} color="#C17A0A" />}
                      {optoutExcluded > 0 && <Stat label="Bloqueados" val={optoutExcluded} color="#B91C1C" />}
                    </div>
                    {withoutOptin > 0 && includeNoOptin && (
                      <div style={{ padding: '10px 14px', background: withoutOptin / audience.length > 0.6 ? '#FEE2E2' : '#FEF3E2', borderTop: '1px solid #EBE7DA' }}>
                        <p style={{ fontSize: 12, color: withoutOptin / audience.length > 0.6 ? '#B91C1C' : '#92400E', margin: 0, fontWeight: 600 }}>
                          {withoutOptin / audience.length > 0.6
                            ? `Atenção: ${Math.round(withoutOptin / audience.length * 100)}% da audiência não tem Autorização WA — risco elevado de denúncias`
                            : `${Math.round(withoutOptin / audience.length * 100)}% sem Autorização WA confirmada`}
                        </p>
                      </div>
                    )}
                    <div style={{ maxHeight: 200, overflowY: 'auto' }}>
                      {audience.slice(0, 50).map(l => (
                        <div key={l.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 14px', borderTop: '1px solid #F1EFE5' }}>
                          <span style={{ fontSize: 12, color: '#25402C' }}>{[l.nome, l.sobrenome].filter(Boolean).join(' ')}</span>
                          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                            <span style={{ fontSize: 11, color: '#9AA79C' }}>{formatarTelefone(l.norm)}</span>
                            {l.wa_optin_at
                              ? <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 99, background: '#DCFCE7', color: '#166534' }}>Autorizado WA</span>
                              : <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 99, background: '#FEF3E2', color: '#92400E' }}>Sem autorização</span>}
                          </div>
                        </div>
                      ))}
                      {audience.length > 50 && (
                        <div style={{ padding: '8px 14px', borderTop: '1px solid #F1EFE5', textAlign: 'center' }}>
                          <span style={{ fontSize: 11, color: '#9AA79C' }}>... e mais {audience.length - 50} contatos</span>
                        </div>
                      )}
                      {audience.length === 0 && (
                        <div style={{ padding: '20px 14px', textAlign: 'center' }}>
                          <span style={{ fontSize: 12, color: '#9AA79C' }}>Nenhum contato encontrado com os filtros selecionados</span>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </>)}
            </div>
          )}

          {/* ── Step 2: Template ── */}
          {step === 2 && (
            <div style={{ paddingBottom: 8 }}>
              <Label>Selecione o template</Label>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 6 }}>
                {templates.length === 0 && (
                  <p style={{ fontSize: 12, color: '#9AA79C', textAlign: 'center', padding: '20px 0' }}>
                    Nenhum template ativo. Crie templates em Configurações → Templates WhatsApp.
                  </p>
                )}
                {templates.map(t => {
                  const sel = t.id === templateId
                  const isMkt = t.category !== 'utility'
                  return (
                    <label key={t.id} onClick={() => setTemplateId(t.id)}
                      style={{ display: 'block', padding: '12px 14px', border: `1.5px solid ${sel ? '#3E9849' : '#EBE7DA'}`, borderRadius: 12,
                        background: sel ? '#E8F4E6' : '#fff', cursor: 'pointer', transition: 'all .12s' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                        <span style={{ fontSize: 13, fontWeight: 700, color: '#25402C', flex: 1 }}>{t.name}</span>
                        <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 99,
                          background: isMkt ? '#FEE2E2' : '#DCFCE7', color: isMkt ? '#B91C1C' : '#166534' }}>
                          {isMkt ? `Marketing · R$0,37/msg` : `Utility · até R$0,04/msg`}
                        </span>
                      </div>
                      <p style={{ fontSize: 12, color: '#71856F', margin: 0, lineHeight: 1.4 }}>{t.content}</p>
                    </label>
                  )
                })}
              </div>

              {selectedTemplate && isMarketing && (
                <div style={{ marginTop: 14, padding: '10px 14px', background: '#FEF3E2', border: '1px solid #FECBA1', borderRadius: 10 }}>
                  <p style={{ fontSize: 12, color: '#92400E', margin: 0, fontWeight: 600 }}>Template de Marketing</p>
                  <p style={{ fontSize: 11, color: '#92400E', margin: '4px 0 0' }}>
                    Cobrado a R$0,37 por mensagem entregue, independente de qualquer janela ativa.
                    Certifique-se de que o texto inclui instrução de como o contato pode pedir para sair (ex: "Responda PARAR para não receber mais").
                  </p>
                </div>
              )}
            </div>
          )}

          {/* ── Step 3: Revisão ── */}
          {step === 3 && (
            <div style={{ paddingBottom: 8 }}>
              <div style={{ marginBottom: 14 }}>
                <Label>Limite diário de envios</Label>
                <input type="number" min={1} step={1} value={Number.isNaN(dailyLimit) ? '' : dailyLimit}
                  onChange={e => setDailyLimit(e.target.valueAsNumber)}
                  style={{ ...inputSt, marginTop: 4, width: 140 }} />
                <p style={{ fontSize: 11, color: '#9AA79C', margin: '4px 0 0' }}>
                  Vale para o número de WhatsApp da unidade, somando todas as campanhas no dia (horário de Brasília).
                  Use o limite da sua conta na Meta (250 numa conta nova).
                  Ao atingir, a campanha pausa e retoma sozinha à meia-noite.
                  {limiteValido && diasDeEnvio > 1 && ` Com ${activeAudienceCount} destinatários, o envio leva pelo menos ${diasDeEnvio} dias.`}
                </p>
              </div>

              {/* Resumo */}
              <div style={{ border: '1px solid #EBE7DA', borderRadius: 12, overflow: 'hidden', marginBottom: 16 }}>
                <div style={{ padding: '12px 16px', background: '#FBFAF4', borderBottom: '1px solid #EBE7DA' }}>
                  <p style={{ fontSize: 12, fontWeight: 700, color: '#25402C', margin: 0 }}>{nome}</p>
                  <p style={{ fontSize: 11, color: '#9AA79C', margin: '2px 0 0' }}>{selectedTemplate?.name} · {activeAudienceCount} destinatários{audienceSource === 'xls' ? ' (importados XLS)' : ''}</p>
                </div>
                <div style={{ padding: '14px 16px' }}>
                  <p style={{ fontSize: 11, fontWeight: 700, color: '#9AA79C', margin: '0 0 10px', textTransform: 'uppercase', letterSpacing: '.06em' }}>Custo estimado</p>
                  {isMarketing ? (
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                      <span style={{ fontSize: 12, color: '#25402C' }}>Marketing · {activeAudienceCount} mensagens × R$0,37</span>
                      <span style={{ fontSize: 13, fontWeight: 700, color: '#B91C1C' }}>{fmtBrl(costEstimate.totalUsd)}</span>
                    </div>
                  ) : (
                    <>
                      {costEstimate.freeCount > 0 && (
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                          <span style={{ fontSize: 12, color: '#25402C' }}>Utility gratuito (janela aberta) · {costEstimate.freeCount} msgs</span>
                          <span style={{ fontSize: 13, fontWeight: 700, color: '#166534' }}>R$ 0,00</span>
                        </div>
                      )}
                      {costEstimate.paidCount > 0 && (
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                          <span style={{ fontSize: 12, color: '#25402C' }}>Utility cobrado · {costEstimate.paidCount} msgs × R$0,04</span>
                          <span style={{ fontSize: 13, fontWeight: 700, color: '#F39313' }}>{fmtBrl(costEstimate.totalUsd)}</span>
                        </div>
                      )}
                    </>
                  )}
                  <div style={{ borderTop: '1px solid #EBE7DA', marginTop: 8, paddingTop: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: 13, fontWeight: 700, color: '#25402C' }}>Total estimado</span>
                    <span style={{ fontSize: 16, fontWeight: 800, color: '#25402C', letterSpacing: '-0.02em' }}>{fmtBrl(costEstimate.totalUsd)}</span>
                  </div>
                </div>
              </div>

              {/* Agendamento */}
              <div style={{ marginBottom: 14 }}>
                <Label>Agendar envio (opcional)</Label>
                <input type="datetime-local" value={scheduleFor} onChange={e => setScheduleFor(e.target.value)}
                  style={{ ...inputSt, marginTop: 4 }} />
                <p style={{ fontSize: 11, color: '#9AA79C', margin: '4px 0 0' }}>
                  No seu horário local. O envio começa sozinho na hora marcada.
                  Deixe em branco para salvar como rascunho e disparar manualmente.
                </p>
              </div>

              {/* Opt-in warning */}
              {withoutOptin > 0 && includeNoOptin && (
                <div style={{ padding: '10px 14px', background: '#FEF3E2', border: '1px solid #FECBA1', borderRadius: 10, marginBottom: 14 }}>
                  <p style={{ fontSize: 12, fontWeight: 700, color: '#92400E', margin: 0 }}>
                    {withoutOptin} contato(s) sem Autorização WA confirmada incluídos.
                  </p>
                  <p style={{ fontSize: 11, color: '#92400E', margin: '4px 0 0' }}>
                    Ao confirmar, você declara ter obtido consentimento desses contatos por outro meio.
                  </p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{ padding: '16px 24px', borderTop: '1px solid #EBE7DA', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
          <div>
            {error && <p style={{ fontSize: 12, color: '#B91C1C', margin: 0 }}>{error}</p>}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            {step > 1 && (
              <button onClick={() => { setStep(s => (s - 1) as WizardStep); setError('') }}
                style={{ padding: '9px 18px', fontSize: 13, fontWeight: 600, border: '1px solid #EBE7DA', borderRadius: 10, cursor: 'pointer', background: '#fff', color: '#71856F' }}>
                Voltar
              </button>
            )}
            {step < 3 ? (
              <button
                onClick={() => {
                  if (step === 1 && !nome.trim()) { setError('Informe o nome da campanha.'); return }
                  if (step === 1 && activeAudienceCount === 0) { setError('Selecione ao menos um destinatário.'); return }
                  if (step === 2 && !templateId) { setError('Selecione um template.'); return }
                  setError(''); setStep(s => (s + 1) as WizardStep)
                }}
                style={{ padding: '9px 22px', fontSize: 13, fontWeight: 700, background: '#25402C', color: '#fff', border: 'none', borderRadius: 10, cursor: 'pointer' }}>
                Próximo
              </button>
            ) : (
              <button onClick={() => void handleCreate()} disabled={saving}
                style={{ padding: '9px 22px', fontSize: 13, fontWeight: 700, border: 'none', borderRadius: 10,
                  cursor: saving ? 'default' : 'pointer',
                  background: saving ? '#EBE7DA' : '#3E9849',
                  color: saving ? '#9AA79C' : '#fff' }}>
                {saving ? 'Salvando...' : scheduleFor ? 'Agendar campanha' : 'Criar rascunho'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Helpers UI ────────────────────────────────────────────────────────────────

function Label({ children }: { children: React.ReactNode }) {
  return <p style={{ fontSize: 12, fontWeight: 700, color: '#71856F', margin: '0 0 5px' }}>{children}</p>
}

function Stat({ label, val, color }: { label: string; val: number; color: string }) {
  return (
    <div>
      <p style={{ fontSize: 10, color: '#9AA79C', margin: 0 }}>{label}</p>
      <p style={{ fontSize: 16, fontWeight: 800, color, margin: '1px 0 0', letterSpacing: '-0.02em' }}>{val}</p>
    </div>
  )
}

const inputSt: React.CSSProperties = {
  width: '100%', padding: '9px 12px', fontSize: 13, border: '1px solid #EBE7DA',
  borderRadius: 10, outline: 'none', boxSizing: 'border-box', background: '#fff', color: '#25402C',
}

const selectSt: React.CSSProperties = {
  width: '100%', padding: '8px 10px', fontSize: 12, border: '1px solid #EBE7DA',
  borderRadius: 10, outline: 'none', boxSizing: 'border-box', background: '#fff', color: '#25402C', cursor: 'pointer',
}

// Formato esperado: coluna "nome" e coluna "telefone" (qualquer ordem, cabeçalho na 1ª linha).
// Sem cabeçalho reconhecível, usa as duas primeiras colunas (nome, telefone).

function parseRows(text: string): XlsContact[] {
  const { registros, separador } = lerCsv(text)
  const linhas = registros.filter(r => !registroVazio(r)).map(r => r.map(c => c.trim()))
  if (linhas.length < 2) return []

  const headers = linhas[0].map(h => h.toLowerCase())
  const nomeIdx = headers.findIndex(h => h.includes('nome') || h.includes('name'))
  const telIdx  = headers.findIndex(h => h.includes('tel') || h.includes('fone') || h.includes('celular') || h.includes('whatsapp') || h.includes('phone') || h.includes('número') || h.includes('numero'))

  const results: XlsContact[] = []

  for (let i = 1; i < linhas.length; i++) {
    const cols = linhas[i]
    if (cols.length < 2) continue

    let nome: string
    let rawPhone: string

    if (nomeIdx >= 0 && telIdx >= 0) {
      nome     = cols[nomeIdx] ?? ''
      rawPhone = cols[telIdx]  ?? ''
    } else {
      // Sem header reconhecível — assume col 0 = nome, col 1 = telefone
      nome     = cols[0] ?? ''
      rawPhone = cols[1] ?? ''
    }

    const telefone = normalizarTelefone(rawPhone)
    if (!telefone) continue

    results.push({ nome: nome || 'Contato', telefone, raw: cols.join(separador) })
  }

  return results
}

function XlsImporter({ contacts, parsing, error, onParse, onParsing }: {
  contacts: XlsContact[]; parsing: boolean; error: string
  onParse: (contacts: XlsContact[], error: string) => void
  onParsing: (v: boolean) => void
}) {
  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    // Limpa o input para permitir re-upload do mesmo arquivo
    e.target.value = ''
    if (!file) return
    onParsing(true)
    onParse([], '')

    try {
      const bytes = new Uint8Array(await file.arrayBuffer())
      if (ehPlanilhaExcel(bytes)) {
        onParse([], 'Para arquivos .xlsx, salve como CSV (UTF-8) no Excel e importe novamente. Arquivo → Salvar como → CSV UTF-8.')
        return
      }
      // O "CSV" comum do Excel BR é Windows-1252: lido como UTF-8, os acentos dos nomes viravam "�"
      const rows = parseRows(decodificarArquivo(bytes).texto)
      if (rows.length === 0) {
        onParse([], 'Nenhum contato encontrado. Certifique-se de que o arquivo tem colunas "nome" e "telefone".')
      } else {
        onParse(rows, '')
      }
    } catch {
      onParse([], 'Erro ao processar o arquivo.')
    } finally {
      onParsing(false)
    }
  }

  return (
    <div>
      {/* Drop zone */}
      <label style={{ display: 'block', border: '2px dashed #EBE7DA', borderRadius: 12, padding: '20px 16px', textAlign: 'center', cursor: 'pointer', background: '#FBFAF4', marginBottom: 12 }}>
        <input type="file" accept=".csv,.txt" onChange={e => void handleFile(e)} style={{ display: 'none' }} />
        <svg width="28" height="28" fill="none" stroke="#C8D6E0" strokeWidth="1.5" viewBox="0 0 24 24" style={{ marginBottom: 6 }}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
        <p style={{ fontSize: 13, fontWeight: 700, color: '#25402C', margin: '0 0 4px' }}>
          {parsing ? 'Processando...' : 'Clique para selecionar o arquivo CSV'}
        </p>
        <p style={{ fontSize: 11, color: '#9AA79C', margin: 0 }}>
          CSV com colunas <strong>nome</strong> e <strong>telefone</strong> · separador ; ou ,
        </p>
      </label>

      {/* Modelo de download */}
      <p style={{ fontSize: 11, color: '#9AA79C', margin: '0 0 12px' }}>
        Formato esperado: <code style={{ background: '#F1EFE5', padding: '1px 5px', borderRadius: 4 }}>nome;telefone</code> — uma linha por contato.
        Salve o Excel como "CSV UTF-8" antes de importar.
      </p>

      {/* Erro */}
      {error && (
        <div style={{ padding: '10px 14px', background: '#FEE2E2', borderRadius: 10, marginBottom: 12 }}>
          <p style={{ fontSize: 12, color: '#B91C1C', margin: 0 }}>{error}</p>
        </div>
      )}

      {/* Preview */}
      {contacts.length > 0 && (
        <div style={{ border: '1px solid #EBE7DA', borderRadius: 12, overflow: 'hidden' }}>
          <div style={{ padding: '10px 14px', background: '#FBFAF4', display: 'flex', gap: 16, alignItems: 'center' }}>
            <Stat label="Importados" val={contacts.length} color="#166534" />
            <p style={{ fontSize: 11, color: '#9AA79C', margin: 0, flex: 1 }}>
              Todos marcados como Autorizado WA · leads criados somente se responderem
            </p>
            <button onClick={() => onParse([], '')}
              style={{ fontSize: 11, color: '#B91C1C', background: 'none', border: 'none', cursor: 'pointer' }}>
              Limpar
            </button>
          </div>
          <div style={{ maxHeight: 180, overflowY: 'auto' }}>
            {contacts.slice(0, 50).map((c, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '7px 14px', borderTop: '1px solid #F1EFE5' }}>
                <span style={{ fontSize: 12, color: '#25402C' }}>{c.nome}</span>
                <span style={{ fontSize: 11, color: '#9AA79C' }}>{formatarTelefone(c.telefone)}</span>
              </div>
            ))}
            {contacts.length > 50 && (
              <div style={{ padding: '7px 14px', borderTop: '1px solid #F1EFE5', textAlign: 'center' }}>
                <span style={{ fontSize: 11, color: '#9AA79C' }}>... e mais {contacts.length - 50} contatos</span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
