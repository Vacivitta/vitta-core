'use client'

import { useState, useEffect, useRef, useMemo } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { Profile } from '@/types/database'
import { displayName } from '@/types/database'
import type { SupervisaoConvRow, QueueRow, AgentStatRow } from './page'
import CampanhasClient from '@/app/campanhas/CampanhasClient'
import type { CampaignRow, TemplateRow, FunnelStageRow } from '@/app/campanhas/page'

// ── Types ─────────────────────────────────────────────────────────────────────

interface WaMessage {
  id: string; direction: 'inbound' | 'outbound'; content: string | null
  created_at: string; sent_by: string | null
}

interface WaNote {
  id: string; content: string; author_id: string; created_at: string; author_name?: string
}

interface ChatItem {
  kind: 'message' | 'note'; id: string; created_at: string
  message?: WaMessage; note?: WaNote
}

interface Props {
  currentUser: Profile
  initialConversations: SupervisaoConvRow[]
  initialQueues: QueueRow[]
  profiles: Profile[]
  billing: { category: string; cost_usd: number; billable: boolean }[]
  agentStats: AgentStatRow[]
  todayISO: string
  campaigns: CampaignRow[]
  templates: TemplateRow[]
  stages: FunnelStageRow[]
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtTime(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  const now = new Date()
  const diffMin = Math.floor((now.getTime() - d.getTime()) / 60000)
  if (diffMin < 60) return `${diffMin}min atrás`
  if (diffMin < 1440) return `${Math.floor(diffMin / 60)}h atrás`
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })
}

function initials(name: string | null): string {
  if (!name) return '?'
  return name.trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase()
}

function avatarColor(id: string): string {
  const colors = ['#3E9849', '#3E9849', '#F39313', '#8B5CF6', '#EC4899', '#14B8A6']
  let hash = 0
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) | 0
  return colors[Math.abs(hash) % colors.length]
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function SupervisaoClient({ currentUser, initialConversations, initialQueues, profiles, billing, agentStats, todayISO, campaigns, templates, stages }: Props) {
  const supabase = createClient()

  const [conversations, setConversations] = useState<SupervisaoConvRow[]>(initialConversations)
  const [selectedId,    setSelectedId]    = useState<string | null>(null)
  const [chatItems,     setChatItems]     = useState<ChatItem[]>([])
  const [loadingMsgs,   setLoadingMsgs]   = useState(false)
  const [noteInput,     setNoteInput]     = useState('')
  const [sendingNote,   setSendingNote]   = useState(false)
  const [search,        setSearch]        = useState('')
  const [queueFilter,   setQueueFilter]   = useState<string>('all')
  const [statusFilter,  setStatusFilter]  = useState<string>('open')
  const [view,          setView]          = useState<'dashboard' | 'conversas' | 'campanhas'>('dashboard')

  const msgsEndRef   = useRef<HTMLDivElement>(null)
  const noteInputRef = useRef<HTMLTextAreaElement>(null)

  const selectedConv = conversations.find(c => c.id === selectedId) ?? null

  // ── KPIs ──────────────────────────────────────────────────────────────────
  const USD_BRL = 5.90 // taxa de referência — atualizar conforme câmbio

  const kpis = useMemo(() => {
    const open          = conversations.filter(c => c.status !== 'resolved')
    const waiting       = open.filter(c => !c.assigned_to)
    const resolvedToday = conversations.filter(c => c.status === 'resolved' && c.resolved_at?.startsWith(todayISO))

    const marketing       = billing.filter(b => b.category === 'marketing')
    const utilityBilled   = billing.filter(b => b.category === 'utility' && b.billable)
    const utilityFree     = billing.filter(b => b.category === 'utility' && !b.billable)
    const authentication  = billing.filter(b => b.category === 'authentication' && b.billable)
    const service         = billing.filter(b => b.category === 'service')

    const totalUsd = billing.reduce((s, b) => s + (b.cost_usd ?? 0), 0)

    return {
      open:          open.length,
      waiting:       waiting.length,
      resolvedToday: resolvedToday.length,

      totalBrl:            totalUsd * USD_BRL,
      marketingCount:      marketing.length,
      marketingBrl:        marketing.reduce((s, b) => s + (b.cost_usd ?? 0), 0) * USD_BRL,
      utilityBilledCount:  utilityBilled.length,
      utilityBilledBrl:    utilityBilled.reduce((s, b) => s + (b.cost_usd ?? 0), 0) * USD_BRL,
      utilityFreeCount:    utilityFree.length,
      authCount:           authentication.length,
      authBrl:             authentication.reduce((s, b) => s + (b.cost_usd ?? 0), 0) * USD_BRL,
      serviceCount:        service.length,
      totalMsgs:           billing.length,
    }
  }, [conversations, billing, todayISO])

  // ── Per-queue stats ────────────────────────────────────────────────────────
  const queueStats = useMemo(() => {
    return initialQueues.map(q => {
      const convs = conversations.filter(c => c.queue_id === q.id && c.status !== 'resolved')
      return { queue: q, open: convs.length, waiting: convs.filter(c => !c.assigned_to).length }
    })
  }, [conversations, initialQueues])

  // ── Agent stats merged with profiles ─────────────────────────────────────
  const agentRows = useMemo(() => {
    return profiles
      .filter(p => p.perfil === 'atendente')
      .map(p => {
        const stats = agentStats.find(s => s.agent_id === p.id)
        return {
          profile:  p,
          open:     stats?.open_count ?? 0,
          resolved: stats?.resolved_today ?? 0,
          avgMin:   stats?.avg_response_minutes ?? null,
        }
      })
      .sort((a, b) => b.open - a.open)
  }, [profiles, agentStats])

  // ── Realtime: conversas ────────────────────────────────────────────────────
  useEffect(() => {
    const ch = supabase.channel('supervisao_convs')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'wa_conversations' },
        payload => {
          if (payload.eventType === 'INSERT') {
            setConversations(prev => [payload.new as SupervisaoConvRow, ...prev])
          } else if (payload.eventType === 'UPDATE') {
            setConversations(prev => prev.map(c => c.id === payload.new.id ? payload.new as SupervisaoConvRow : c))
          } else if (payload.eventType === 'DELETE') {
            setConversations(prev => prev.filter(c => c.id !== payload.old.id))
          }
        }
      )
      .subscribe()
    return () => { void supabase.removeChannel(ch) }
  }, [supabase])

  // ── Load chat (messages + internal notes) ─────────────────────────────────
  useEffect(() => {
    if (!selectedId) { setChatItems([]); return }
    setLoadingMsgs(true)
    void Promise.all([
      supabase.from('wa_messages')
        .select('id,direction,content,created_at,sent_by')
        .eq('conversation_id', selectedId).order('created_at').limit(100),
      supabase.from('wa_internal_notes')
        .select('id,content,author_id,created_at')
        .eq('conversation_id', selectedId).order('created_at'),
    ]).then(([{ data: msgs }, { data: notes }]) => {
      const items: ChatItem[] = [
        ...(msgs ?? []).map(m => ({ kind: 'message' as const, id: m.id, created_at: m.created_at, message: m as WaMessage })),
        ...(notes ?? []).map(n => ({
          kind: 'note' as const, id: n.id, created_at: n.created_at,
          note: { ...n, author_name: profiles.find(p => p.id === n.author_id) ? displayName(profiles.find(p => p.id === n.author_id)!) : 'Agente' } as WaNote,
        })),
      ]
      items.sort((a, b) => a.created_at.localeCompare(b.created_at))
      setChatItems(items)
      setLoadingMsgs(false)
    })
  }, [selectedId]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Realtime: mensagens e notas do chat selecionado ────────────────────────
  useEffect(() => {
    if (!selectedId) return
    const ch = supabase.channel(`supervisao_chat_${selectedId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'wa_messages', filter: `conversation_id=eq.${selectedId}` },
        payload => {
          const msg = payload.new as WaMessage
          setChatItems(prev => prev.some(i => i.id === msg.id) ? prev : [...prev, { kind: 'message', id: msg.id, created_at: msg.created_at, message: msg }])
        })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'wa_internal_notes', filter: `conversation_id=eq.${selectedId}` },
        payload => {
          const n = payload.new as WaNote
          const authorName = profiles.find(p => p.id === n.author_id) ? displayName(profiles.find(p => p.id === n.author_id)!) : 'Agente'
          const item: ChatItem = { kind: 'note', id: n.id, created_at: n.created_at, note: { ...n, author_name: authorName } }
          setChatItems(prev => prev.some(i => i.id === n.id) ? prev : [...prev, item])
        })
      .subscribe()
    return () => { void supabase.removeChannel(ch) }
  }, [selectedId, supabase, profiles])

  useEffect(() => {
    msgsEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [chatItems.length])

  // ── Filtered conversations ─────────────────────────────────────────────────
  const filtered = useMemo(() => {
    return conversations.filter(c => {
      if (statusFilter !== 'all' && c.status !== statusFilter) return false
      if (queueFilter !== 'all' && c.queue_id !== queueFilter) return false
      if (search) {
        const q = search.toLowerCase()
        const name = (c.wa_contact_name ?? '').toLowerCase()
        return name.includes(q) || c.wa_phone.includes(q)
      }
      return true
    })
  }, [conversations, statusFilter, queueFilter, search])

  // ── Actions ───────────────────────────────────────────────────────────────

  async function handleAssume() {
    if (!selectedId) return
    await supabase.from('wa_conversations').update({ assigned_to: currentUser.id }).eq('id', selectedId)
    setConversations(prev => prev.map(c => c.id === selectedId ? { ...c, assigned_to: currentUser.id } : c))
    // Nota automática
    void fetch('/api/whatsapp/notes', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conversation_id: selectedId, content: `${displayName(currentUser)} assumiu o atendimento` }),
    })
  }

  async function handleSendNote() {
    if (!selectedId || !noteInput.trim() || sendingNote) return
    const text = noteInput.trim()
    setNoteInput('')
    setSendingNote(true)
    try {
      await fetch('/api/whatsapp/notes', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversation_id: selectedId, content: text }),
      })
    } finally {
      setSendingNote(false)
      noteInputRef.current?.focus()
    }
  }

  function handleNoteKey(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void handleSendNote() }
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  function agentName(id: string | null): string {
    if (!id) return 'Sem agente'
    const p = profiles.find(pr => pr.id === id)
    return p ? displayName(p) : 'Agente'
  }

  function queueLabel(id: string | null): string {
    if (!id) return 'Sem fila'
    return initialQueues.find(q => q.id === id)?.nome ?? '—'
  }

  function queueColor(id: string | null): string {
    if (!id) return '#9AA79C'
    return initialQueues.find(q => q.id === id)?.cor ?? '#9AA79C'
  }

  const isAssignedToMe = selectedConv?.assigned_to === currentUser.id

  // ── Styles ────────────────────────────────────────────────────────────────
  const S = {
    ink:     '#25402C',
    muted:   '#9AA79C',
    border:  '#EBE7DA',
    surface: '#F4FAFE',
    card:    { background: '#fff', border: '1px solid #EBE7DA', borderRadius: 14, padding: '16px 18px' } as React.CSSProperties,
    kpiCard: { background: '#fff', border: '1px solid #EBE7DA', borderRadius: 14, padding: '16px 18px', flex: 1 } as React.CSSProperties,
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>

      {/* ── Top nav ── */}
      <header style={{ background: '#fff', borderBottom: '1px solid #EBE7DA', padding: '12px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
        <div>
          <h1 style={{ fontSize: 16, fontWeight: 800, color: S.ink, margin: 0 }}>Dashboard de Atendimento</h1>
          <p style={{ fontSize: 12, color: S.muted, margin: '2px 0 0' }}>Tempo real · atualização automática</p>
        </div>
        <div style={{ display: 'flex', gap: 4, background: '#F1EFE5', borderRadius: 10, padding: 4 }}>
          {([['dashboard', 'Painel'], ['conversas', 'Conversas'], ['campanhas', 'Campanhas']] as const).map(([v, label]) => (
            <button key={v} onClick={() => setView(v)}
              style={{ padding: '6px 16px', fontSize: 12, fontWeight: 600, borderRadius: 7, border: 'none', cursor: 'pointer', background: view === v ? '#fff' : 'transparent', color: view === v ? S.ink : S.muted, boxShadow: view === v ? '0 1px 4px rgba(14,44,61,.08)' : 'none' }}>
              {label}
            </button>
          ))}
        </div>
      </header>

      {/* ════ DASHBOARD VIEW ════ */}
      {view === 'dashboard' && (
        <div style={{ flex: 1, overflowY: 'auto', padding: '24px' }}>

          {/* KPIs */}
          <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
            <div style={{ ...S.kpiCard, borderTop: '3px solid #3E9849' }}>
              <p style={{ fontSize: 11, fontWeight: 700, color: S.muted, margin: '0 0 6px', textTransform: 'uppercase', letterSpacing: '.06em' }}>Em aberto</p>
              <p style={{ fontSize: 32, fontWeight: 800, color: '#3E9849', margin: 0, letterSpacing: '-0.03em' }}>{kpis.open}</p>
            </div>
            <div style={{ ...S.kpiCard, borderTop: `3px solid ${kpis.waiting > 0 ? '#F39313' : '#EBE7DA'}` }}>
              <p style={{ fontSize: 11, fontWeight: 700, color: S.muted, margin: '0 0 6px', textTransform: 'uppercase', letterSpacing: '.06em' }}>Sem agente</p>
              <p style={{ fontSize: 32, fontWeight: 800, color: kpis.waiting > 0 ? '#F39313' : S.muted, margin: 0, letterSpacing: '-0.03em' }}>{kpis.waiting}</p>
            </div>
            <div style={{ ...S.kpiCard, borderTop: '3px solid #3E9849' }}>
              <p style={{ fontSize: 11, fontWeight: 700, color: S.muted, margin: '0 0 6px', textTransform: 'uppercase', letterSpacing: '.06em' }}>Resolvidos hoje</p>
              <p style={{ fontSize: 32, fontWeight: 800, color: '#3E9849', margin: 0, letterSpacing: '-0.03em' }}>{kpis.resolvedToday}</p>
            </div>

            {/* WhatsApp billing — por mensagem (Meta pós-jul 2025) */}
            <div style={{ ...S.kpiCard, minWidth: 260, borderTop: `3px solid ${kpis.totalBrl > 500 ? '#C05B3A' : kpis.totalBrl > 200 ? '#F39313' : '#25D366'}` }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                <p style={{ fontSize: 11, fontWeight: 700, color: S.muted, margin: 0, textTransform: 'uppercase', letterSpacing: '.06em' }}>WhatsApp — custo do mês</p>
                <span style={{ fontSize: 10, color: S.muted }}>{kpis.totalMsgs} msgs</span>
              </div>
              <p style={{ fontSize: 28, fontWeight: 800, color: S.ink, margin: '0 0 10px', letterSpacing: '-0.03em' }}>
                {kpis.totalBrl.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                {kpis.marketingCount > 0 && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <div style={{ width: 7, height: 7, borderRadius: '50%', background: '#C05B3A' }} />
                      <span style={{ fontSize: 11, color: S.ink }}>Marketing</span>
                      <span style={{ fontSize: 10, color: S.muted }}>{kpis.marketingCount} msgs</span>
                    </div>
                    <span style={{ fontSize: 11, fontWeight: 700, color: '#C05B3A' }}>
                      {kpis.marketingBrl.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                    </span>
                  </div>
                )}
                {kpis.utilityBilledCount > 0 && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <div style={{ width: 7, height: 7, borderRadius: '50%', background: '#F39313' }} />
                      <span style={{ fontSize: 11, color: S.ink }}>Utility cobrado</span>
                      <span style={{ fontSize: 10, color: S.muted }}>{kpis.utilityBilledCount} msgs</span>
                    </div>
                    <span style={{ fontSize: 11, fontWeight: 700, color: '#F39313' }}>
                      {kpis.utilityBilledBrl.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                    </span>
                  </div>
                )}
                {kpis.utilityFreeCount > 0 && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <div style={{ width: 7, height: 7, borderRadius: '50%', background: '#3E9849' }} />
                      <span style={{ fontSize: 11, color: S.ink }}>Utility gratuito</span>
                      <span style={{ fontSize: 10, color: S.muted }}>{kpis.utilityFreeCount} msgs</span>
                    </div>
                    <span style={{ fontSize: 11, fontWeight: 700, color: '#3E9849' }}>R$ 0,00</span>
                  </div>
                )}
                {kpis.authCount > 0 && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <div style={{ width: 7, height: 7, borderRadius: '50%', background: '#8B5CF6' }} />
                      <span style={{ fontSize: 11, color: S.ink }}>Authentication</span>
                      <span style={{ fontSize: 10, color: S.muted }}>{kpis.authCount} msgs</span>
                    </div>
                    <span style={{ fontSize: 11, fontWeight: 700, color: '#8B5CF6' }}>
                      {kpis.authBrl.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                    </span>
                  </div>
                )}
                {kpis.serviceCount > 0 && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <div style={{ width: 7, height: 7, borderRadius: '50%', background: '#9AA79C' }} />
                      <span style={{ fontSize: 11, color: S.muted }}>Service (atendimento)</span>
                      <span style={{ fontSize: 10, color: S.muted }}>{kpis.serviceCount} msgs</span>
                    </div>
                    <span style={{ fontSize: 11, color: S.muted }}>gratuito</span>
                  </div>
                )}
                {kpis.totalMsgs === 0 && (
                  <p style={{ fontSize: 11, color: S.muted, margin: 0 }}>Nenhuma mensagem registrada este mês</p>
                )}
              </div>
              <p style={{ fontSize: 10, color: S.muted, margin: '8px 0 0' }}>Câmbio referência: R$ {USD_BRL.toFixed(2)}/USD</p>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>

            {/* Filas */}
            <div style={S.card}>
              <h2 style={{ fontSize: 13, fontWeight: 700, color: S.ink, margin: '0 0 14px' }}>Conversas por fila</h2>
              {queueStats.length === 0 ? (
                <p style={{ fontSize: 12, color: S.muted, textAlign: 'center', padding: '16px 0' }}>Nenhuma fila configurada</p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {queueStats.sort((a, b) => b.open - a.open).map(({ queue, open, waiting }) => (
                    <div key={queue.id} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div style={{ width: 10, height: 10, borderRadius: '50%', background: queue.cor, flexShrink: 0 }} />
                      <span style={{ flex: 1, fontSize: 13, color: S.ink, fontWeight: 500 }}>{queue.nome}</span>
                      <span style={{ fontSize: 12, color: S.muted }}>{open} abertas</span>
                      {waiting > 0 && (
                        <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 7px', borderRadius: 99, background: '#FEF3E2', color: '#C17A0A' }}>{waiting} sem agente</span>
                      )}
                      <div style={{ width: 60, height: 6, background: '#F0F3F6', borderRadius: 99, overflow: 'hidden' }}>
                        <div style={{ height: '100%', background: queue.cor, borderRadius: 99, width: `${Math.min(100, open / Math.max(1, Math.max(...queueStats.map(q => q.open))) * 100)}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Agentes */}
            <div style={S.card}>
              <h2 style={{ fontSize: 13, fontWeight: 700, color: S.ink, margin: '0 0 14px' }}>Carga por agente</h2>
              {agentRows.length === 0 ? (
                <p style={{ fontSize: 12, color: S.muted, textAlign: 'center', padding: '16px 0' }}>Nenhum atendente cadastrado</p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {agentRows.map(({ profile: p, open, resolved, avgMin }) => (
                    <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div style={{ width: 30, height: 30, borderRadius: '50%', background: avatarColor(p.id), color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, flexShrink: 0 }}>
                        {initials(p.full_name)}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 3 }}>
                          <span style={{ fontSize: 12, fontWeight: 600, color: S.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{displayName(p)}</span>
                          <div style={{ display: 'flex', gap: 6, flexShrink: 0, marginLeft: 6 }}>
                            <span style={{ fontSize: 11, color: '#3E9849', fontWeight: 700 }}>{open} aberta{open !== 1 ? 's' : ''}</span>
                            <span style={{ fontSize: 11, color: '#3E9849' }}>{resolved} hoje</span>
                            {avgMin !== null && (
                              <span style={{ fontSize: 11, color: S.muted }} title="Tempo médio de resposta">{Math.round(avgMin)}min</span>
                            )}
                          </div>
                        </div>
                        <div style={{ height: 5, background: '#F0F3F6', borderRadius: 99, overflow: 'hidden' }}>
                          <div style={{ height: '100%', background: open >= 8 ? '#C05B3A' : open >= 5 ? '#F39313' : '#3E9849', borderRadius: 99, width: `${Math.min(100, open / 10 * 100)}%`, transition: 'width .3s' }} />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ════ CONVERSAS VIEW ════ */}
      {view === 'conversas' && (
        <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>

          {/* ── Lista ── */}
          <div style={{ width: 310, flexShrink: 0, borderRight: '1px solid #EBE7DA', display: 'flex', flexDirection: 'column', background: S.surface }}>
            {/* Filtros */}
            <div style={{ padding: '10px 12px', borderBottom: '1px solid #EBE7DA', display: 'flex', flexDirection: 'column', gap: 7 }}>
              <input
                placeholder="Buscar conversa..."
                value={search} onChange={e => setSearch(e.target.value)}
                style={{ width: '100%', padding: '7px 10px', fontSize: 12, border: '1px solid #EBE7DA', borderRadius: 8, outline: 'none', boxSizing: 'border-box', background: '#fff', color: S.ink }}
              />
              <div style={{ display: 'flex', gap: 5 }}>
                <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
                  style={{ flex: 1, padding: '5px 8px', fontSize: 11, border: '1px solid #EBE7DA', borderRadius: 7, background: '#fff', color: S.ink, cursor: 'pointer' }}>
                  <option value="all">Todos os status</option>
                  <option value="open">Em aberto</option>
                  <option value="pending">Pendente</option>
                  <option value="resolved">Resolvido</option>
                </select>
                <select value={queueFilter} onChange={e => setQueueFilter(e.target.value)}
                  style={{ flex: 1, padding: '5px 8px', fontSize: 11, border: '1px solid #EBE7DA', borderRadius: 7, background: '#fff', color: S.ink, cursor: 'pointer' }}>
                  <option value="all">Todas as filas</option>
                  {initialQueues.map(q => <option key={q.id} value={q.id}>{q.nome}</option>)}
                </select>
              </div>
            </div>

            {/* Lista de conversas */}
            <div style={{ flex: 1, overflowY: 'auto' }}>
              {filtered.length === 0 ? (
                <p style={{ textAlign: 'center', color: S.muted, fontSize: 12, padding: '32px 16px' }}>Nenhuma conversa encontrada</p>
              ) : filtered.map(conv => {
                const isSelected = conv.id === selectedId
                return (
                  <button key={conv.id} onClick={() => setSelectedId(conv.id)}
                    style={{ width: '100%', textAlign: 'left', padding: '10px 12px', borderBottom: '1px solid #F1EFE5', background: isSelected ? '#E8F4E6' : 'transparent', borderLeft: isSelected ? '3px solid #3E9849' : '3px solid transparent', cursor: 'pointer', display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                    <div style={{ width: 34, height: 34, borderRadius: '50%', background: avatarColor(conv.id), color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, flexShrink: 0 }}>
                      {initials(conv.wa_contact_name)}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontSize: 12, fontWeight: 700, color: S.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 140 }}>
                          {conv.wa_contact_name ?? conv.wa_phone}
                        </span>
                        <span style={{ fontSize: 10, color: S.muted, flexShrink: 0 }}>{fmtTime(conv.last_message_at)}</span>
                      </div>
                      <div style={{ display: 'flex', gap: 4, marginTop: 3, flexWrap: 'wrap' }}>
                        <span style={{ fontSize: 10, fontWeight: 600, padding: '1px 6px', borderRadius: 99, background: `${queueColor(conv.queue_id)}20`, color: queueColor(conv.queue_id) }}>
                          {queueLabel(conv.queue_id)}
                        </span>
                        <span style={{ fontSize: 10, color: S.muted }}>{agentName(conv.assigned_to)}</span>
                      </div>
                    </div>
                    {conv.unread_count > 0 && (
                      <div style={{ width: 18, height: 18, borderRadius: '50%', background: '#25D366', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 700, flexShrink: 0 }}>
                        {conv.unread_count > 9 ? '9+' : conv.unread_count}
                      </div>
                    )}
                  </button>
                )
              })}
            </div>
          </div>

          {/* ── Chat ── */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            {!selectedConv ? (
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: S.muted, background: '#FBFAF4' }}>
                <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ marginBottom: 12, opacity: .4 }}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
                <p style={{ fontSize: 13, fontWeight: 600, color: '#71856F', margin: 0 }}>Selecione uma conversa</p>
                <p style={{ fontSize: 12, margin: '4px 0 0' }}>Supervisão em tempo real</p>
              </div>
            ) : (
              <>
                {/* Header */}
                <div style={{ background: '#fff', borderBottom: '1px solid #EBE7DA', padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
                  <div style={{ width: 36, height: 36, borderRadius: '50%', background: avatarColor(selectedConv.id), color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700, flexShrink: 0 }}>
                    {initials(selectedConv.wa_contact_name)}
                  </div>
                  <div style={{ flex: 1 }}>
                    <p style={{ fontSize: 14, fontWeight: 700, color: S.ink, margin: 0 }}>{selectedConv.wa_contact_name ?? selectedConv.wa_phone}</p>
                    <p style={{ fontSize: 11, color: S.muted, margin: '1px 0 0' }}>
                      {queueLabel(selectedConv.queue_id)} · {agentName(selectedConv.assigned_to)}
                    </p>
                  </div>

                  {/* Badge do agente atual */}
                  {isAssignedToMe && (
                    <span style={{ fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 99, background: '#E8F4E6', color: '#3E9849' }}>
                      Você está atendendo
                    </span>
                  )}

                  {/* Botão Assumir */}
                  {!isAssignedToMe && selectedConv.status !== 'resolved' && (
                    <button onClick={() => void handleAssume()}
                      style={{ padding: '6px 14px', fontSize: 12, fontWeight: 700, border: 'none', borderRadius: 9, cursor: 'pointer', background: '#25402C', color: '#fff', flexShrink: 0 }}>
                      Assumir conversa
                    </button>
                  )}
                </div>

                {/* Messages + Notes */}
                <div style={{ flex: 1, overflowY: 'auto', padding: '16px', background: '#ECE5DD', display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {loadingMsgs ? (
                    <div style={{ textAlign: 'center', color: S.muted, fontSize: 12, paddingTop: 32 }}>Carregando mensagens...</div>
                  ) : chatItems.length === 0 ? (
                    <div style={{ textAlign: 'center', color: S.muted, fontSize: 12, paddingTop: 32 }}>Nenhuma mensagem registrada</div>
                  ) : chatItems.map(item => {
                    if (item.kind === 'note') {
                      const note = item.note!
                      return (
                        <div key={item.id} style={{ display: 'flex', justifyContent: 'center' }}>
                          <div style={{
                            maxWidth: '80%', padding: '8px 14px', borderRadius: 10,
                            background: '#FFF8D6', border: '1px dashed #E6C84A',
                            fontSize: 12, color: '#5A4800', lineHeight: 1.45,
                          }}>
                            <p style={{ margin: '0 0 3px', fontWeight: 700, fontSize: 11, color: '#927000' }}>
                              Nota interna · {note.author_name}
                            </p>
                            <p style={{ margin: 0 }}>{note.content}</p>
                            <p style={{ fontSize: 10, color: '#A89040', margin: '4px 0 0', textAlign: 'right' }}>
                              {new Date(note.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                            </p>
                          </div>
                        </div>
                      )
                    }
                    const msg = item.message!
                    const isOut = msg.direction === 'outbound'
                    return (
                      <div key={item.id} style={{ display: 'flex', justifyContent: isOut ? 'flex-end' : 'flex-start' }}>
                        <div style={{
                          maxWidth: '72%', padding: '8px 12px', borderRadius: isOut ? '12px 2px 12px 12px' : '2px 12px 12px 12px',
                          background: isOut ? '#D9FDD3' : '#fff', fontSize: 13, color: S.ink, lineHeight: 1.4,
                          boxShadow: '0 1px 2px rgba(0,0,0,.08)',
                        }}>
                          <p style={{ margin: 0 }}>{msg.content ?? '[mídia]'}</p>
                          <p style={{ fontSize: 10, color: S.muted, margin: '4px 0 0', textAlign: 'right' }}>
                            {new Date(msg.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                          </p>
                        </div>
                      </div>
                    )
                  })}
                  <div ref={msgsEndRef} />
                </div>

                {/* Nota interna input — sempre visível para supervisores */}
                {selectedConv.status !== 'resolved' && (
                  <div style={{ background: '#FFF8D6', borderTop: '1px solid #E6C84A', padding: '10px 14px', flexShrink: 0, display: 'flex', gap: 8, alignItems: 'flex-end' }}>
                    <div style={{ flex: 1 }}>
                      <p style={{ fontSize: 10, fontWeight: 700, color: '#927000', margin: '0 0 5px', textTransform: 'uppercase', letterSpacing: '.05em' }}>
                        Nota interna (visivel apenas para a equipe)
                      </p>
                      <textarea
                        ref={noteInputRef}
                        value={noteInput}
                        onChange={e => setNoteInput(e.target.value)}
                        onKeyDown={handleNoteKey}
                        placeholder="Escreva uma orientação para o atendente... (Enter para enviar)"
                        rows={2}
                        style={{
                          width: '100%', resize: 'none', border: '1px solid #E6C84A', borderRadius: 9,
                          padding: '8px 11px', fontSize: 13, outline: 'none', fontFamily: 'inherit',
                          boxSizing: 'border-box', background: '#fff', color: S.ink,
                        }}
                      />
                    </div>
                    <button
                      onClick={() => void handleSendNote()}
                      disabled={!noteInput.trim() || sendingNote}
                      style={{
                        padding: '9px 16px', fontSize: 12, fontWeight: 700, border: 'none', borderRadius: 9,
                        cursor: noteInput.trim() && !sendingNote ? 'pointer' : 'default',
                        background: noteInput.trim() && !sendingNote ? '#D4A800' : '#E8E0B8',
                        color: noteInput.trim() && !sendingNote ? '#fff' : '#B0A060',
                        flexShrink: 0, marginBottom: 1,
                      }}>
                      {sendingNote ? '...' : 'Enviar'}
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {/* ════ CAMPANHAS VIEW ════ */}
      {view === 'campanhas' && (
        <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          <CampanhasClient
            currentUser={currentUser}
            initialCampaigns={campaigns}
            templates={templates}
            stages={stages}
            embedded
          />
        </div>
      )}
    </div>
  )
}
