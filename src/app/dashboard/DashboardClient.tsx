'use client'

import React, { useState, useMemo } from 'react'
import type { Profile, SalesGoal } from '@/types/database'
import { displayName } from '@/types/database'

// ─── Types ────────────────────────────────────────────────────────────────────

interface LeadRow     { id: string; stage_id: string | null; created_at: string; origem: string | null; motivo_perda: string | null }
interface QuoteRow    { id: string; status: string; total_calculado: number | null; criado_em: string; aceito_em: string | null; responsavel_id: string | null; motivo_recusa: string | null }
interface StageRow    { id: string; nome: string; cor: string; ordem: number; funnel_id: string; funnel: { id: string; nome: string } | null }
interface TaskRow     { id: string; concluida_em: string | null; data_vencimento: string | null; responsavel_id: string | null }
interface ConvRow     { id: string; lead_id: string | null; unread_count: number; last_message_at: string | null; last_message_direction: string | null; status: string; assigned_to: string | null; queue_id: string | null; resolved_at: string | null }
interface MsgRow      { id: string; conversation_id: string; direction: string; created_at: string; sent_by: string | null }
interface ProfileRow  { id: string; full_name: string; apelido: string | null; perfil?: string }
interface BillingRow  { category: string; cost_usd: number; billable: boolean }
interface QueueRow    { id: string; nome: string; cor: string }
interface AgentStatRow { agent_id: string; open_count: number; resolved_today: number; avg_response_minutes: number | null }
interface StageHistoryRow { id: string; lead_id: string; de_stage_id: string | null; para_stage_id: string; criado_em: string }

interface Props {
  currentUser:   Profile
  leads:         LeadRow[]
  quotes:        QuoteRow[]
  stages:        StageRow[]
  tasks:         TaskRow[]
  conversations: ConvRow[]
  messages:      MsgRow[]
  profiles:      ProfileRow[]
  billing:       BillingRow[]
  queues:        QueueRow[]
  agentStats:    AgentStatRow[]
  todayISO:      string
  salesGoals:    SalesGoal[]
  stageHistory:  StageHistoryRow[]
}

type Period = '7d' | '30d' | '90d' | 'all'
const PERIOD_LABELS: Record<Period, string> = { '7d': '7d', '30d': '30d', '90d': '90d', all: 'Tudo' }

// ─── Helpers ─────────────────────────────────────────────────────────────────

const fmtBRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })
const fmtBRL2 = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2, maximumFractionDigits: 2 })
const USD_BRL = 5.90

function cutoff(period: Period): Date | null {
  if (period === 'all') return null
  const d = new Date()
  d.setDate(d.getDate() - parseInt(period))
  return d
}

function inPeriod(iso: string | null, cut: Date | null) {
  if (!iso) return false
  return cut ? new Date(iso) >= cut : true
}

function initials(name: string | null): string {
  if (!name) return '?'
  return name.trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase()
}

function avatarColor(id: string): string {
  const colors = ['#3E9849', '#1E86C0', '#F39313', '#8B5CF6', '#EC4899', '#14B8A6']
  let hash = 0
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) | 0
  return colors[Math.abs(hash) % colors.length]
}

// ─── Compact subcomponents ───────────────────────────────────────────────────

const card = { background: '#fff', border: '1px solid #e5e5e5', borderRadius: 10, padding: '12px 14px' } as const
const sectionGap = 20

function Section({ title, children, right }: { title: string; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div style={{ marginTop: sectionGap }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, borderBottom: '1px solid #e0ddd2', paddingBottom: 6 }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: '#555', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{title}</span>
        {right}
      </div>
      {children}
    </div>
  )
}

function Stat({ label, value, color, sub, tooltip }: { label: string; value: string | number; color?: string; sub?: string; tooltip?: string }) {
  return (
    <div style={card} title={tooltip}>
      <p style={{ fontSize: 10, fontWeight: 700, color: '#999', margin: 0, textTransform: 'uppercase', letterSpacing: '0.03em' }}>{label}</p>
      <p style={{ fontSize: 20, fontWeight: 800, margin: '2px 0 0', color: color ?? '#222', lineHeight: 1.1 }}>{value}</p>
      {sub && <p style={{ fontSize: 10, color: '#999', margin: '2px 0 0', fontWeight: 600 }}>{sub}</p>}
    </div>
  )
}

function Bar({ value, max, color, h }: { value: number; max: number; color: string; h?: number }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0
  return (
    <div className="flex-1 rounded-full overflow-hidden" style={{ background: '#f0ede4', height: h ?? 7 }}>
      <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: color, transition: 'width .2s' }} />
    </div>
  )
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function DashboardClient({ currentUser, leads, quotes, stages, tasks, conversations, messages, profiles, billing, queues, agentStats, todayISO, salesGoals: initialGoals, stageHistory }: Props) {
  const [period, setPeriod] = useState<Period>('30d')
  const cut = useMemo(() => cutoff(period), [period])

  const [salesGoals, setSalesGoals] = useState<SalesGoal[]>(initialGoals)
  const [showMetaModal, setShowMetaModal] = useState(false)
  const [metaMonth, setMetaMonth] = useState(() => {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
  })
  const [metaTarget, setMetaTarget] = useState('')
  const [metaSaving, setMetaSaving] = useState(false)

  async function saveMeta() {
    if (!metaTarget || metaSaving) return
    setMetaSaving(true)
    try {
      const res = await fetch('/api/sales-goals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ month: metaMonth, target: parseFloat(metaTarget) }),
      })
      if (res.ok) {
        const saved = await res.json()
        setSalesGoals(prev => {
          const filtered = prev.filter(g => g.month !== saved.month)
          return [saved, ...filtered].sort((a, b) => b.month.localeCompare(a.month))
        })
        setShowMetaModal(false)
        setMetaTarget('')
      }
    } finally {
      setMetaSaving(false)
    }
  }

  const filteredQuotes = useMemo(() => quotes.filter(q => inPeriod(q.criado_em, cut)), [quotes, cut])
  const filteredLeads  = useMemo(() => leads.filter(l => inPeriod(l.created_at, cut)), [leads, cut])

  // ── KPIs comerciais
  const kpis = useMemo(() => {
    const aceitos   = filteredQuotes.filter(q => q.status === 'aceito')
    const recusados = filteredQuotes.filter(q => q.status === 'recusado')
    const enviados  = filteredQuotes.filter(q => ['enviado', 'visualizado', 'aceito', 'recusado', 'em_negociacao'].includes(q.status))
    const andamento = filteredQuotes.filter(q => ['enviado', 'visualizado', 'em_negociacao'].includes(q.status))
    const totalAceito    = aceitos.reduce((s, q) => s + (q.total_calculado ?? 0), 0)
    const totalRecusado  = recusados.reduce((s, q) => s + (q.total_calculado ?? 0), 0)
    const totalAndamento = andamento.reduce((s, q) => s + (q.total_calculado ?? 0), 0)
    const ticketMed = aceitos.length > 0 ? totalAceito / aceitos.length : 0
    const taxaConv  = enviados.length > 0 ? Math.round((aceitos.length / enviados.length) * 100) : 0

    const cycles: number[] = []
    for (const q of aceitos) {
      if (q.aceito_em && q.criado_em) {
        const diff = (new Date(q.aceito_em).getTime() - new Date(q.criado_em).getTime()) / (1000 * 60 * 60 * 24)
        if (diff > 0) cycles.push(diff)
      }
    }
    const cicloMedio = cycles.length > 0 ? Math.round(cycles.reduce((s, c) => s + c, 0) / cycles.length) : null

    const motivosMap: Record<string, number> = {}
    for (const q of recusados) {
      const m = q.motivo_recusa?.trim()
      if (m) motivosMap[m] = (motivosMap[m] ?? 0) + 1
    }
    const principalMotivo = Object.entries(motivosMap).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null

    return { leadsAtivos: leads.length, novosLeads: filteredLeads.length, aceitos: aceitos.length, totalAceito, totalRecusado, totalAndamento, ticketMedio: ticketMed, taxaConv, enviados: enviados.length, cicloMedio, principalMotivo }
  }, [filteredQuotes, filteredLeads, leads])

  // ── Motivos recusa
  const motivosRecusa = useMemo(() => {
    const map: Record<string, number> = {}
    for (const q of filteredQuotes) { if (q.status !== 'recusado') continue; const m = q.motivo_recusa?.trim() || 'Não informado'; map[m] = (map[m] ?? 0) + 1 }
    return Object.entries(map).map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count).slice(0, 8)
  }, [filteredQuotes])

  // ── Motivos perda leads
  const motivosPerda = useMemo(() => {
    const map: Record<string, number> = {}
    for (const l of filteredLeads) { const m = l.motivo_perda?.trim(); if (m) map[m] = (map[m] ?? 0) + 1 }
    return Object.entries(map).map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count).slice(0, 8)
  }, [filteredLeads])

  // ── Conversão por atendente
  const convPorAtendente = useMemo(() => {
    const map: Record<string, { ganhos: number; andamento: number; perdas: number; aceitos: number; total: number }> = {}
    for (const q of filteredQuotes) {
      if (!q.responsavel_id || !['enviado', 'visualizado', 'aceito', 'recusado', 'em_negociacao'].includes(q.status)) continue
      if (!map[q.responsavel_id]) map[q.responsavel_id] = { ganhos: 0, andamento: 0, perdas: 0, aceitos: 0, total: 0 }
      const e = map[q.responsavel_id]; e.total++; const v = q.total_calculado ?? 0
      if (q.status === 'aceito') { e.ganhos += v; e.aceitos++ } else if (q.status === 'recusado') { e.perdas += v } else { e.andamento += v }
    }
    return Object.entries(map).map(([id, d]) => {
      const p = profiles.find(pr => pr.id === id)
      return { id, nome: p ? displayName(p) : 'Desconhecido', ...d, taxa: d.total > 0 ? Math.round((d.aceitos / d.total) * 100) : 0 }
    }).sort((a, b) => b.ganhos - a.ganhos)
  }, [filteredQuotes, profiles])

  // ── Msgs por atendente
  const msgsPorAtendente = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const m of messages) { if (m.direction !== 'outbound' || !m.sent_by) continue; if (cut && new Date(m.created_at) < cut) continue; counts[m.sent_by] = (counts[m.sent_by] ?? 0) + 1 }
    return Object.entries(counts).map(([id, count]) => { const p = profiles.find(pr => pr.id === id); return { name: p ? displayName(p) : '?', count } }).sort((a, b) => b.count - a.count).slice(0, 8)
  }, [messages, profiles, cut])

  // ── Ganho vs Meta
  const ganhoVsMeta = useMemo(() => {
    const months: { month: string; label: string; ganho: number; meta: number }[] = []
    const now = new Date()
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
      const ms = d.toISOString().slice(0, 7)
      const label = d.toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '')
      const ganho = quotes.filter(q => q.status === 'aceito' && q.aceito_em?.startsWith(ms)).reduce((s, q) => s + (q.total_calculado ?? 0), 0)
      const goal = salesGoals.find(g => g.month.startsWith(ms))
      months.push({ month: ms, label, ganho, meta: goal?.target ?? 0 })
    }
    return months
  }, [quotes, salesGoals])

  // ── Atendimento KPIs
  const atenKpis = useMemo(() => {
    const open = conversations.filter(c => c.status !== 'resolved')
    return { open: open.length, waiting: open.filter(c => !c.assigned_to).length, resolvedToday: conversations.filter(c => c.status === 'resolved' && c.resolved_at?.startsWith(todayISO)).length }
  }, [conversations, todayISO])

  // ── Tempo médio resposta
  const avgResponseMin = useMemo(() => {
    const byConv: Record<string, MsgRow[]> = {}
    for (const m of messages) { (byConv[m.conversation_id] ??= []).push(m) }
    const times: number[] = []
    for (const msgs of Object.values(byConv)) {
      const sorted = [...msgs].sort((a, b) => a.created_at.localeCompare(b.created_at))
      for (let i = 0; i < sorted.length - 1; i++) {
        if (sorted[i].direction === 'inbound' && sorted[i + 1].direction === 'outbound') {
          const diff = new Date(sorted[i + 1].created_at).getTime() - new Date(sorted[i].created_at).getTime()
          if (diff > 0 && diff < 86400000 && (!cut || new Date(sorted[i].created_at) >= cut)) times.push(diff / 60000)
        }
      }
    }
    return times.length > 0 ? Math.round(times.reduce((s, t) => s + t, 0) / times.length) : null
  }, [messages, cut])

  // ── WA billing
  const waBilling = useMemo(() => {
    const mk = billing.filter(b => b.category === 'marketing')
    const ub = billing.filter(b => b.category === 'utility' && b.billable)
    const uf = billing.filter(b => b.category === 'utility' && !b.billable)
    const au = billing.filter(b => b.category === 'authentication' && b.billable)
    const sv = billing.filter(b => b.category === 'service')
    const totalUsd = billing.reduce((s, b) => s + (b.cost_usd ?? 0), 0)
    return {
      totalBrl: totalUsd * USD_BRL, marketingCount: mk.length, marketingBrl: mk.reduce((s, b) => s + (b.cost_usd ?? 0), 0) * USD_BRL,
      utilityBilledCount: ub.length, utilityBilledBrl: ub.reduce((s, b) => s + (b.cost_usd ?? 0), 0) * USD_BRL, utilityFreeCount: uf.length,
      authCount: au.length, authBrl: au.reduce((s, b) => s + (b.cost_usd ?? 0), 0) * USD_BRL, serviceCount: sv.length, totalMsgs: billing.length,
    }
  }, [billing])

  // ── Queue stats
  const queueStats = useMemo(() => queues.map(q => {
    const c = conversations.filter(c => c.queue_id === q.id && c.status !== 'resolved')
    return { queue: q, open: c.length, waiting: c.filter(c => !c.assigned_to).length }
  }), [conversations, queues])

  // ── Agent rows
  const agentRows = useMemo(() => profiles.filter(p => p.perfil === 'atendente').map(p => {
    const s = agentStats.find(a => a.agent_id === p.id)
    return { profile: p, open: s?.open_count ?? 0, resolved: s?.resolved_today ?? 0, avgMin: s?.avg_response_minutes ?? null }
  }).sort((a, b) => b.open - a.open), [profiles, agentStats])

  // ── Tasks
  const taskStats = useMemo(() => {
    const now = new Date().toISOString().slice(0, 10)
    const pending = tasks.filter(t => !t.concluida_em)
    return { pending: pending.length, overdue: pending.filter(t => t.data_vencimento && t.data_vencimento < now).length }
  }, [tasks])

  // ── Leads por origem
  const leadsByOrigem = useMemo(() => {
    const c: Record<string, number> = {}
    for (const l of filteredLeads) { const k = l.origem?.trim() || 'Não informada'; c[k] = (c[k] ?? 0) + 1 }
    return Object.entries(c).map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count).slice(0, 8)
  }, [filteredLeads])

  // ── Quote funnel
  const quoteFunnel = useMemo(() => {
    const a = filteredQuotes
    return [
      { label: 'Criados', count: a.length, color: '#9AA79C' },
      { label: 'Enviados', count: a.filter(q => ['enviado','visualizado','aceito','recusado','em_negociacao'].includes(q.status)).length, color: '#1E86C0' },
      { label: 'Visualizados', count: a.filter(q => ['visualizado','aceito','recusado'].includes(q.status)).length, color: '#64AEDC' },
      { label: 'Aceitos', count: a.filter(q => q.status === 'aceito').length, color: '#3E9849' },
      { label: 'Recusados', count: a.filter(q => q.status === 'recusado').length, color: '#C05B3A' },
    ]
  }, [filteredQuotes])

  // ── Funnel data
  const funnelData = useMemo(() => {
    const byF: Record<string, { nome: string; stages: { id: string; nome: string; cor: string; count: number }[] }> = {}
    for (const s of stages) {
      const fId = s.funnel_id; if (!byF[fId]) byF[fId] = { nome: s.funnel?.nome ?? 'Funil', stages: [] }
      byF[fId].stages.push({ id: s.id, nome: s.nome, cor: s.cor, count: leads.filter(l => l.stage_id === s.id).length })
    }
    return Object.values(byF)
  }, [stages, leads])

  // ── Tempo médio por etapa
  const avgTimePerStage = useMemo(() => {
    const stageMap = new Map(stages.map(s => [s.id, s]))
    const byLead = new Map<string, StageHistoryRow[]>()
    for (const h of stageHistory) {
      const arr = byLead.get(h.lead_id) ?? []
      arr.push(h)
      byLead.set(h.lead_id, arr)
    }

    const durations: Record<string, number[]> = {}
    for (const [, entries] of byLead) {
      const sorted = entries.sort((a, b) => new Date(a.criado_em).getTime() - new Date(b.criado_em).getTime())
      for (let i = 0; i < sorted.length; i++) {
        const stageId = sorted[i].de_stage_id
        if (!stageId) continue
        const enteredAt = i > 0 ? new Date(sorted[i - 1].criado_em).getTime() : null
        if (enteredAt === null) continue
        const leftAt = new Date(sorted[i].criado_em).getTime()
        const hours = (leftAt - enteredAt) / (1000 * 60 * 60)
        if (hours >= 0) {
          if (!durations[stageId]) durations[stageId] = []
          durations[stageId].push(hours)
        }
      }
    }

    const result: { id: string; nome: string; cor: string; avgHours: number; count: number; funnelName: string }[] = []
    for (const s of stages) {
      const arr = durations[s.id]
      if (!arr || arr.length === 0) continue
      const avg = arr.reduce((a, b) => a + b, 0) / arr.length
      result.push({ id: s.id, nome: s.nome, cor: s.cor, avgHours: avg, count: arr.length, funnelName: s.funnel?.nome ?? 'Funil' })
    }
    return result
  }, [stageHistory, stages])

  // ── Status dist
  const statusDist = useMemo(() => {
    const m: Record<string, number> = {}
    for (const q of filteredQuotes) m[q.status] = (m[q.status] ?? 0) + 1
    const t = filteredQuotes.length
    return [
      { label: 'Rascunho', key: 'rascunho', color: '#B9B4A2', count: m['rascunho'] ?? 0 },
      { label: 'Enviado', key: 'enviado', color: '#1E86C0', count: m['enviado'] ?? 0 },
      { label: 'Visualizado', key: 'visualizado', color: '#64AEDC', count: m['visualizado'] ?? 0 },
      { label: 'Aceito', key: 'aceito', color: '#3E9849', count: m['aceito'] ?? 0 },
      { label: 'Recusado', key: 'recusado', color: '#C05B3A', count: m['recusado'] ?? 0 },
      { label: 'Negociação', key: 'em_negociacao', color: '#F39313', count: m['em_negociacao'] ?? 0 },
      { label: 'Expirado', key: 'expirado', color: '#6B7280', count: m['expirado'] ?? 0 },
    ].filter(s => s.count > 0).map(s => ({ ...s, pct: t > 0 ? Math.round(s.count / t * 100) : 0 }))
  }, [filteredQuotes])

  const fmtTime = (min: number | null) => { if (min === null) return '—'; if (min < 60) return `${min}min`; const h = Math.floor(min / 60); const m = min % 60; return m > 0 ? `${h}h${m}m` : `${h}h` }
  const barMax = Math.max(...ganhoVsMeta.map(m => Math.max(m.ganho, m.meta)), 1)

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      {/* Header */}
      <header className="bg-white shrink-0 flex items-center justify-between" style={{ padding: '10px 20px', borderBottom: '1px solid #e0ddd2' }}>
        <div>
          <h1 style={{ fontSize: 15, fontWeight: 800, color: '#25402C', margin: 0 }}>Dashboard</h1>
          <p style={{ fontSize: 10, fontWeight: 600, color: '#999', margin: 0 }}>Visão geral · {currentUser.full_name?.split(' ')[0]}</p>
        </div>
        <div className="flex items-center gap-0.5" style={{ background: '#f0ede4', borderRadius: 6, padding: 2 }}>
          {(Object.keys(PERIOD_LABELS) as Period[]).map(p => (
            <button key={p} onClick={() => setPeriod(p)} style={{
              fontSize: 10, fontWeight: period === p ? 700 : 600, padding: '4px 10px', borderRadius: 5,
              background: period === p ? '#25402C' : 'transparent', color: period === p ? '#fff' : '#888', border: 'none', cursor: 'pointer',
            }}>{PERIOD_LABELS[p]}</button>
          ))}
        </div>
      </header>

      <main className="flex-1 overflow-auto" style={{ background: '#f7f5ef', padding: '12px 16px 24px' }}>

        {/* ── COMERCIAL ── */}
        <Section title="Comercial">
          <div className="grid grid-cols-3 gap-3 mb-3">
            <div style={{ ...card, background: '#f0faf1' }}>
              <p style={{ fontSize: 9, fontWeight: 700, color: '#999', margin: 0, textTransform: 'uppercase' }}>Ganhos</p>
              <p style={{ fontSize: 22, fontWeight: 800, color: '#2d7a36', margin: '1px 0 0', lineHeight: 1.1 }}>{kpis.totalAceito > 0 ? fmtBRL.format(kpis.totalAceito) : 'R$ 0'}</p>
              <p style={{ fontSize: 9, color: '#888', margin: '1px 0 0' }}>{kpis.aceitos} aceito{kpis.aceitos !== 1 ? 's' : ''}</p>
            </div>
            <div style={{ ...card, background: '#fef2f0' }}>
              <p style={{ fontSize: 9, fontWeight: 700, color: '#999', margin: 0, textTransform: 'uppercase' }}>Perdas</p>
              <p style={{ fontSize: 22, fontWeight: 800, color: '#C05B3A', margin: '1px 0 0', lineHeight: 1.1 }}>{kpis.totalRecusado > 0 ? fmtBRL.format(kpis.totalRecusado) : 'R$ 0'}</p>
              <p style={{ fontSize: 9, color: '#888', margin: '1px 0 0' }}>recusados</p>
            </div>
            <div style={{ ...card, background: '#fef8ed' }}>
              <p style={{ fontSize: 9, fontWeight: 700, color: '#999', margin: 0, textTransform: 'uppercase' }}>Andamento</p>
              <p style={{ fontSize: 22, fontWeight: 800, color: '#b5720e', margin: '1px 0 0', lineHeight: 1.1 }}>{kpis.totalAndamento > 0 ? fmtBRL.format(kpis.totalAndamento) : 'R$ 0'}</p>
              <p style={{ fontSize: 9, color: '#888', margin: '1px 0 0' }}>em negociação</p>
            </div>
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Stat label="Ticket médio" value={kpis.ticketMedio > 0 ? fmtBRL.format(kpis.ticketMedio) : '—'} />
            <Stat label="Taxa conversão" value={`${kpis.taxaConv}%`} color={kpis.taxaConv >= 50 ? '#2d7a36' : kpis.taxaConv >= 25 ? '#b5720e' : '#C05B3A'} sub={`${kpis.aceitos}/${kpis.enviados}`} />
            <Stat label="Motivo perda" value={kpis.principalMotivo ?? '—'} />
            <Stat label="Ciclo médio" value={kpis.cicloMedio !== null ? `${kpis.cicloMedio}d` : '—'} sub="criação → aceite" />
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mt-3">
            <Stat label="Contatos ativos" value={kpis.leadsAtivos} sub={`+${kpis.novosLeads} período`} />
            <Stat label="Aceitos" value={kpis.aceitos} sub={`de ${kpis.enviados} enviados`} />
            <Stat label="Tarefas" value={taskStats.pending} sub={taskStats.overdue > 0 ? `${taskStats.overdue} vencida${taskStats.overdue > 1 ? 's' : ''}` : 'em dia'} color={taskStats.overdue > 0 ? '#C05B3A' : undefined} />
            <Stat label="Receita total" value={kpis.totalAceito > 0 ? fmtBRL.format(kpis.totalAceito) : '—'} color="#2d7a36" />
          </div>
        </Section>

        {/* ── METAS ── */}
        <Section title="Metas" right={
          <button onClick={() => setShowMetaModal(true)} style={{ fontSize: 10, fontWeight: 700, padding: '3px 10px', borderRadius: 5, border: '1px solid #ddd', background: '#fff', color: '#555', cursor: 'pointer' }}>+ Meta</button>
        }>
          {showMetaModal && (
            <div style={{ position: 'fixed', inset: 0, zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.35)' }} onClick={() => setShowMetaModal(false)}>
              <div style={{ background: '#fff', borderRadius: 12, padding: 20, width: 320 }} onClick={e => e.stopPropagation()}>
                <h3 style={{ fontSize: 13, fontWeight: 700, color: '#333', marginBottom: 14 }}>Definir Meta</h3>
                <label style={{ display: 'block', fontSize: 10, fontWeight: 700, color: '#888', marginBottom: 4 }}>Mês</label>
                <select value={metaMonth} onChange={e => setMetaMonth(e.target.value)} style={{ width: '100%', padding: '6px 8px', borderRadius: 6, border: '1px solid #ddd', fontSize: 11, marginBottom: 12, background: '#fff' }}>
                  {Array.from({ length: 12 }, (_, i) => { const d = new Date(); d.setMonth(d.getMonth() + i - 2); const v = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`; return <option key={v} value={v}>{d.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })}</option> })}
                </select>
                <label style={{ display: 'block', fontSize: 10, fontWeight: 700, color: '#888', marginBottom: 4 }}>Valor (R$)</label>
                <input type="number" min="0" step="100" value={metaTarget} onChange={e => setMetaTarget(e.target.value)} placeholder="50000" style={{ width: '100%', padding: '6px 8px', borderRadius: 6, border: '1px solid #ddd', fontSize: 11, marginBottom: 14 }} />
                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                  <button onClick={() => setShowMetaModal(false)} style={{ padding: '5px 12px', borderRadius: 6, border: '1px solid #ddd', background: '#fff', fontSize: 11, fontWeight: 600, color: '#888', cursor: 'pointer' }}>Cancelar</button>
                  <button onClick={saveMeta} disabled={metaSaving || !metaTarget} style={{ padding: '5px 12px', borderRadius: 6, border: 'none', background: '#25402C', fontSize: 11, fontWeight: 600, color: '#fff', cursor: 'pointer', opacity: metaSaving || !metaTarget ? 0.5 : 1 }}>{metaSaving ? 'Salvando...' : 'Salvar'}</button>
                </div>
              </div>
            </div>
          )}
          <div style={card}>
            {ganhoVsMeta.every(m => m.ganho === 0 && m.meta === 0) ? (
              <p style={{ fontSize: 11, color: '#999', textAlign: 'center', padding: '16px 0' }}>Sem dados de metas ou ganhos</p>
            ) : (
              <>
                <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, height: 140, padding: '0 4px' }}>
                  {ganhoVsMeta.map(m => {
                    const gH = barMax > 0 ? (m.ganho / barMax) * 120 : 0
                    const mH = barMax > 0 ? (m.meta / barMax) * 120 : 0
                    return (
                      <div key={m.month} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
                        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 120 }}>
                          <div title={`Ganho: ${fmtBRL2.format(m.ganho)}`} style={{ width: 16, height: Math.max(gH, 2), background: '#3E9849', borderRadius: '3px 3px 0 0' }} />
                          <div title={`Meta: ${fmtBRL2.format(m.meta)}`} style={{ width: 16, height: Math.max(mH, 2), background: m.meta > 0 ? '#D1D5DB' : 'transparent', borderRadius: '3px 3px 0 0', border: m.meta > 0 ? '1px dashed #aaa' : 'none' }} />
                        </div>
                        <span style={{ fontSize: 9, fontWeight: 700, color: '#888', textTransform: 'capitalize' }}>{m.label}</span>
                      </div>
                    )
                  })}
                </div>
                <div style={{ display: 'flex', gap: 14, justifyContent: 'center', marginTop: 8 }}>
                  <span style={{ fontSize: 9, color: '#888', display: 'flex', alignItems: 'center', gap: 4 }}><span style={{ width: 8, height: 8, borderRadius: 2, background: '#3E9849', display: 'inline-block' }} />Ganho</span>
                  <span style={{ fontSize: 9, color: '#888', display: 'flex', alignItems: 'center', gap: 4 }}><span style={{ width: 8, height: 8, borderRadius: 2, background: '#D1D5DB', border: '1px dashed #aaa', display: 'inline-block' }} />Meta</span>
                </div>
              </>
            )}
          </div>
        </Section>

        {/* ── MOTIVOS DE PERDA ── */}
        <Section title="Motivos de Perda">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <div style={card}>
              <p style={{ fontSize: 10, fontWeight: 700, color: '#888', margin: '0 0 8px', textTransform: 'uppercase' }}>Orçamentos recusados</p>
              {motivosRecusa.length === 0 ? <p style={{ fontSize: 10, color: '#bbb', textAlign: 'center', padding: 12 }}>Sem dados</p> : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                  {motivosRecusa.map(o => (
                    <div key={o.label} className="flex items-center gap-2">
                      <span style={{ fontSize: 10, fontWeight: 600, color: '#555', width: 100, flexShrink: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={o.label}>{o.label}</span>
                      <Bar value={o.count} max={motivosRecusa[0].count} color="#C05B3A" />
                      <span style={{ fontSize: 10, fontWeight: 700, color: '#444', width: 20, textAlign: 'right', flexShrink: 0 }}>{o.count}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div style={card}>
              <p style={{ fontSize: 10, fontWeight: 700, color: '#888', margin: '0 0 8px', textTransform: 'uppercase' }}>Leads perdidos</p>
              {motivosPerda.length === 0 ? <p style={{ fontSize: 10, color: '#bbb', textAlign: 'center', padding: 12 }}>Sem dados</p> : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                  {motivosPerda.map(o => (
                    <div key={o.label} className="flex items-center gap-2">
                      <span style={{ fontSize: 10, fontWeight: 600, color: '#555', width: 100, flexShrink: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={o.label}>{o.label}</span>
                      <Bar value={o.count} max={motivosPerda[0].count} color="#DC2626" />
                      <span style={{ fontSize: 10, fontWeight: 700, color: '#444', width: 20, textAlign: 'right', flexShrink: 0 }}>{o.count}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </Section>

        {/* ── CONVERSÃO POR ATENDENTE ── */}
        <Section title="Conversão por Atendente">
          <div style={{ ...card, overflowX: 'auto', padding: convPorAtendente.length > 0 ? '0' : '12px 14px' }}>
            {convPorAtendente.length === 0 ? (
              <p style={{ fontSize: 10, color: '#bbb', textAlign: 'center', padding: 12 }}>Sem dados no período</p>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid #e5e5e5' }}>
                    <th style={{ textAlign: 'left', padding: '7px 10px', fontWeight: 700, color: '#888', fontSize: 9, textTransform: 'uppercase' }}>Atendente</th>
                    <th style={{ textAlign: 'right', padding: '7px 8px', fontWeight: 700, color: '#888', fontSize: 9, textTransform: 'uppercase' }}>Ganhos</th>
                    <th style={{ textAlign: 'right', padding: '7px 8px', fontWeight: 700, color: '#888', fontSize: 9, textTransform: 'uppercase' }}>Andamento</th>
                    <th style={{ textAlign: 'right', padding: '7px 8px', fontWeight: 700, color: '#888', fontSize: 9, textTransform: 'uppercase' }}>Perdas</th>
                    <th style={{ textAlign: 'right', padding: '7px 10px', fontWeight: 700, color: '#888', fontSize: 9, textTransform: 'uppercase' }}>Taxa</th>
                  </tr>
                </thead>
                <tbody>
                  {convPorAtendente.map(a => (
                    <tr key={a.id} style={{ borderBottom: '1px solid #f3f1ea' }}>
                      <td style={{ padding: '6px 10px', fontWeight: 600, color: '#333' }}>
                        <div className="flex items-center gap-2">
                          <div style={{ width: 22, height: 22, borderRadius: '50%', background: avatarColor(a.id), color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 8, fontWeight: 700, flexShrink: 0 }}>{initials(a.nome)}</div>
                          <span style={{ fontSize: 11 }}>{a.nome}</span>
                        </div>
                      </td>
                      <td style={{ padding: '6px 8px', textAlign: 'right', fontWeight: 700, color: '#2d7a36', fontSize: 11 }}>{fmtBRL.format(a.ganhos)}</td>
                      <td style={{ padding: '6px 8px', textAlign: 'right', fontWeight: 600, color: '#b5720e', fontSize: 11 }}>{fmtBRL.format(a.andamento)}</td>
                      <td style={{ padding: '6px 8px', textAlign: 'right', fontWeight: 600, color: '#C05B3A', fontSize: 11 }}>{fmtBRL.format(a.perdas)}</td>
                      <td style={{ padding: '6px 10px', textAlign: 'right' }}>
                        <span style={{ padding: '1px 6px', borderRadius: 4, fontWeight: 700, fontSize: 10, background: a.taxa >= 50 ? '#e6f4e6' : a.taxa >= 25 ? '#fef3e2' : '#fee2e2', color: a.taxa >= 50 ? '#2d7a36' : a.taxa >= 25 ? '#b5720e' : '#C05B3A' }}>{a.taxa}%</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </Section>

        {/* ── ATENDIMENTO ── */}
        <Section title="Atendimento">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-3">
            <Stat label="Abertas" value={atenKpis.open} />
            <Stat label="Sem agente" value={atenKpis.waiting} color={atenKpis.waiting > 0 ? '#F39313' : '#999'} tooltip="Filas sem auto-assign ou aguardando 1º contato" />
            <Stat label="Resolvidas hoje" value={atenKpis.resolvedToday} />
            <Stat label="Tempo resposta" value={fmtTime(avgResponseMin)} color={avgResponseMin !== null && avgResponseMin <= 15 ? '#2d7a36' : avgResponseMin !== null && avgResponseMin <= 60 ? '#b5720e' : '#C05B3A'} sub="1ª resposta WA" />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {/* Msgs por atendente */}
            <div style={card}>
              <p style={{ fontSize: 10, fontWeight: 700, color: '#888', margin: '0 0 8px', textTransform: 'uppercase' }}>Mensagens por atendente</p>
              {msgsPorAtendente.length === 0 ? <p style={{ fontSize: 10, color: '#bbb', textAlign: 'center', padding: 12 }}>Sem dados</p> : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {msgsPorAtendente.map((a, i) => (
                    <div key={a.name} className="flex items-center gap-2">
                      <span style={{ fontSize: 10, fontWeight: 700, color: i === 0 ? '#2d7a36' : '#999', width: 14, textAlign: 'right', flexShrink: 0 }}>{i + 1}</span>
                      <span style={{ fontSize: 10, fontWeight: 600, color: '#555', width: 80, flexShrink: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.name}</span>
                      <Bar value={a.count} max={msgsPorAtendente[0].count} color={i === 0 ? '#3E9849' : '#bbb'} />
                      <span style={{ fontSize: 10, fontWeight: 700, color: '#444', width: 24, textAlign: 'right', flexShrink: 0 }}>{a.count}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Carga por agente */}
            <div style={card}>
              <p style={{ fontSize: 10, fontWeight: 700, color: '#888', margin: '0 0 8px', textTransform: 'uppercase' }}>Carga por agente</p>
              {agentRows.length === 0 ? <p style={{ fontSize: 10, color: '#bbb', textAlign: 'center', padding: 12 }}>Sem atendentes</p> : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                  {agentRows.map(({ profile: p, open, resolved, avgMin }) => (
                    <div key={p.id} className="flex items-center gap-2">
                      <div style={{ width: 20, height: 20, borderRadius: '50%', background: avatarColor(p.id), color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 8, fontWeight: 700, flexShrink: 0 }}>{initials(p.full_name)}</div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div className="flex items-center justify-between" style={{ marginBottom: 1 }}>
                          <span style={{ fontSize: 10, fontWeight: 600, color: '#444', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{displayName(p)}</span>
                          <div className="flex gap-1.5 shrink-0 ml-1">
                            <span style={{ fontSize: 9, color: '#2d7a36', fontWeight: 700 }}>{open}</span>
                            <span style={{ fontSize: 9, color: '#999' }}>{resolved}r</span>
                            {avgMin !== null && <span style={{ fontSize: 9, color: '#bbb' }}>{Math.round(avgMin)}m</span>}
                          </div>
                        </div>
                        <div style={{ height: 4, background: '#f0ede4', borderRadius: 99, overflow: 'hidden' }}>
                          <div style={{ height: '100%', background: open >= 8 ? '#C05B3A' : open >= 5 ? '#F39313' : '#3E9849', borderRadius: 99, width: `${Math.min(100, open / 10 * 100)}%` }} />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 mt-3">
            {/* Conversas por fila */}
            <div style={card}>
              <p style={{ fontSize: 10, fontWeight: 700, color: '#888', margin: '0 0 8px', textTransform: 'uppercase' }}>Conversas por fila</p>
              {queueStats.length === 0 ? <p style={{ fontSize: 10, color: '#bbb', textAlign: 'center', padding: 12 }}>Sem filas</p> : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {queueStats.sort((a, b) => b.open - a.open).map(({ queue, open, waiting }) => (
                    <div key={queue.id} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 0', borderBottom: '1px solid #f5f3ed' }}>
                      <div style={{ width: 8, height: 8, borderRadius: '50%', background: queue.cor, flexShrink: 0 }} />
                      <span style={{ fontSize: 11, fontWeight: 600, color: '#444', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{queue.nome}</span>
                      <span style={{ fontSize: 11, fontWeight: 700, color: '#444', minWidth: 20, textAlign: 'right' }}>{open}</span>
                      <span style={{ fontSize: 9, color: '#999', flexShrink: 0 }}>abertas</span>
                      {waiting > 0 && (
                        <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 5, background: '#FEF3C7', color: '#D97706', flexShrink: 0 }}>{waiting} sem agente</span>
                      )}
                      <div style={{ width: 50, height: 5, background: '#f0ede4', borderRadius: 99, overflow: 'hidden', flexShrink: 0 }}>
                        <div style={{ height: '100%', background: queue.cor, borderRadius: 99, width: `${Math.min(100, open / Math.max(1, Math.max(...queueStats.map(q => q.open))) * 100)}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Leads por origem */}
            <div style={card}>
              <p style={{ fontSize: 10, fontWeight: 700, color: '#888', margin: '0 0 8px', textTransform: 'uppercase' }}>Leads por origem</p>
              {leadsByOrigem.length === 0 ? <p style={{ fontSize: 10, color: '#bbb', textAlign: 'center', padding: 12 }}>Sem dados</p> : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {leadsByOrigem.map(o => (
                    <div key={o.label} className="flex items-center gap-2">
                      <span style={{ fontSize: 10, fontWeight: 600, color: '#555', width: 90, flexShrink: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{o.label}</span>
                      <Bar value={o.count} max={leadsByOrigem[0].count} color="#1E86C0" />
                      <span style={{ fontSize: 10, fontWeight: 700, color: '#444', width: 20, textAlign: 'right', flexShrink: 0 }}>{o.count}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </Section>

        {/* ── OPERACIONAL ── */}
        <Section title="Operacional">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {/* Funil orçamentos */}
            <div style={card}>
              <p style={{ fontSize: 10, fontWeight: 700, color: '#888', margin: '0 0 8px', textTransform: 'uppercase' }}>Funil de orçamentos</p>
              {filteredQuotes.length === 0 ? <p style={{ fontSize: 10, color: '#bbb', textAlign: 'center', padding: 12 }}>Sem dados</p> : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                  {quoteFunnel.map((step, i) => {
                    const max = quoteFunnel[0].count
                    const prev = i > 0 ? quoteFunnel[i - 1].count : null
                    const rate = prev && prev > 0 ? Math.round(step.count / prev * 100) : null
                    return (
                      <div key={step.label}>
                        <div className="flex items-center justify-between" style={{ marginBottom: 2 }}>
                          <div className="flex items-center gap-1.5">
                            <span style={{ fontSize: 10, fontWeight: 600, color: '#555' }}>{step.label}</span>
                            {rate !== null && <span style={{ fontSize: 8, color: '#bbb' }}>↓{rate}%</span>}
                          </div>
                          <span style={{ fontSize: 10, fontWeight: 700, color: step.color }}>{step.count}</span>
                        </div>
                        <Bar value={step.count} max={max} color={step.color} h={6} />
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            {/* Distribuição status */}
            <div style={card}>
              <p style={{ fontSize: 10, fontWeight: 700, color: '#888', margin: '0 0 8px', textTransform: 'uppercase' }}>Status orçamentos</p>
              {statusDist.length === 0 ? <p style={{ fontSize: 10, color: '#bbb', textAlign: 'center', padding: 12 }}>Sem dados</p> : (() => {
                const total = filteredQuotes.length
                let acc = 0
                const stops = statusDist.map(s => { const from = acc; acc += s.pct; return `${s.color} ${from}% ${acc}%` })
                return (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                    <div style={{ position: 'relative', width: 100, height: 100, flexShrink: 0, borderRadius: '50%', background: `conic-gradient(${stops.join(', ')})` }}>
                      <div style={{ position: 'absolute', inset: 20, background: '#fff', borderRadius: '50%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                        <span style={{ fontSize: 16, fontWeight: 800, lineHeight: 1 }}>{total}</span>
                      </div>
                    </div>
                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
                      {statusDist.map(s => (
                        <div key={s.key} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 10 }}>
                          <div style={{ width: 6, height: 6, borderRadius: 2, background: s.color, flexShrink: 0 }} />
                          <span style={{ flex: 1, fontWeight: 600, color: '#555' }}>{s.label}</span>
                          <span style={{ fontWeight: 700, color: '#444' }}>{s.count}</span>
                          <span style={{ color: '#bbb', width: 26, textAlign: 'right' }}>{s.pct}%</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )
              })()}
            </div>
          </div>

          {/* WA billing */}
          <div style={{ ...card, marginTop: 12 }}>
            <div className="flex items-center justify-between" style={{ marginBottom: 10 }}>
              <p style={{ fontSize: 10, fontWeight: 700, color: '#888', margin: 0, textTransform: 'uppercase' }}>WhatsApp — custo do mês</p>
              <span style={{ fontSize: 18, fontWeight: 800, color: '#333' }}>{waBilling.totalBrl.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</span>
            </div>
            {waBilling.totalMsgs === 0 ? (
              <p style={{ fontSize: 10, color: '#bbb', textAlign: 'center', padding: 8 }}>Nenhuma mensagem este mês</p>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid #e5e5e5' }}>
                    <th style={{ textAlign: 'left', padding: '4px 0', fontWeight: 700, color: '#aaa', fontSize: 9, textTransform: 'uppercase' }}>Categoria</th>
                    <th style={{ textAlign: 'right', padding: '4px 0', fontWeight: 700, color: '#aaa', fontSize: 9, textTransform: 'uppercase', width: 50 }}>Qtd</th>
                    <th style={{ textAlign: 'right', padding: '4px 0', fontWeight: 700, color: '#aaa', fontSize: 9, textTransform: 'uppercase', width: 80 }}>Custo</th>
                  </tr>
                </thead>
                <tbody>
                  {waBilling.marketingCount > 0 && (
                    <tr style={{ borderBottom: '1px solid #f5f3ed' }}>
                      <td style={{ padding: '5px 0', display: 'flex', alignItems: 'center', gap: 6 }}><div style={{ width: 6, height: 6, borderRadius: '50%', background: '#C05B3A' }} /><span style={{ fontWeight: 600, color: '#444' }}>Marketing</span></td>
                      <td style={{ padding: '5px 0', textAlign: 'right', color: '#666' }}>{waBilling.marketingCount}</td>
                      <td style={{ padding: '5px 0', textAlign: 'right', fontWeight: 700, color: '#C05B3A' }}>{waBilling.marketingBrl.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</td>
                    </tr>
                  )}
                  {waBilling.utilityBilledCount > 0 && (
                    <tr style={{ borderBottom: '1px solid #f5f3ed' }}>
                      <td style={{ padding: '5px 0', display: 'flex', alignItems: 'center', gap: 6 }}><div style={{ width: 6, height: 6, borderRadius: '50%', background: '#F39313' }} /><span style={{ fontWeight: 600, color: '#444' }}>Utility</span></td>
                      <td style={{ padding: '5px 0', textAlign: 'right', color: '#666' }}>{waBilling.utilityBilledCount}</td>
                      <td style={{ padding: '5px 0', textAlign: 'right', fontWeight: 700, color: '#F39313' }}>{waBilling.utilityBilledBrl.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</td>
                    </tr>
                  )}
                  {waBilling.utilityFreeCount > 0 && (
                    <tr style={{ borderBottom: '1px solid #f5f3ed' }}>
                      <td style={{ padding: '5px 0', display: 'flex', alignItems: 'center', gap: 6 }}><div style={{ width: 6, height: 6, borderRadius: '50%', background: '#3E9849' }} /><span style={{ fontWeight: 600, color: '#444' }}>Utility gratuito</span></td>
                      <td style={{ padding: '5px 0', textAlign: 'right', color: '#666' }}>{waBilling.utilityFreeCount}</td>
                      <td style={{ padding: '5px 0', textAlign: 'right', fontWeight: 600, color: '#3E9849' }}>R$ 0,00</td>
                    </tr>
                  )}
                  {waBilling.authCount > 0 && (
                    <tr style={{ borderBottom: '1px solid #f5f3ed' }}>
                      <td style={{ padding: '5px 0', display: 'flex', alignItems: 'center', gap: 6 }}><div style={{ width: 6, height: 6, borderRadius: '50%', background: '#8B5CF6' }} /><span style={{ fontWeight: 600, color: '#444' }}>Authentication</span></td>
                      <td style={{ padding: '5px 0', textAlign: 'right', color: '#666' }}>{waBilling.authCount}</td>
                      <td style={{ padding: '5px 0', textAlign: 'right', fontWeight: 700, color: '#8B5CF6' }}>{waBilling.authBrl.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</td>
                    </tr>
                  )}
                  {waBilling.serviceCount > 0 && (
                    <tr style={{ borderBottom: '1px solid #f5f3ed' }}>
                      <td style={{ padding: '5px 0', display: 'flex', alignItems: 'center', gap: 6 }}><div style={{ width: 6, height: 6, borderRadius: '50%', background: '#9AA79C' }} /><span style={{ fontWeight: 600, color: '#444' }}>Service</span></td>
                      <td style={{ padding: '5px 0', textAlign: 'right', color: '#666' }}>{waBilling.serviceCount}</td>
                      <td style={{ padding: '5px 0', textAlign: 'right', color: '#999' }}>gratuito</td>
                    </tr>
                  )}
                </tbody>
              </table>
            )}
            <p style={{ fontSize: 9, color: '#bbb', margin: '6px 0 0', textAlign: 'right' }}>Câmbio: R$ {USD_BRL.toFixed(2)}/USD · {waBilling.totalMsgs} mensagens</p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3" style={{ marginTop: 12 }}>
            {/* Contatos por funil */}
            <div style={card}>
              <p style={{ fontSize: 10, fontWeight: 700, color: '#888', margin: '0 0 8px', textTransform: 'uppercase' }}>Contatos por funil</p>
              {funnelData.length === 0 ? <p style={{ fontSize: 10, color: '#bbb', textAlign: 'center', padding: 12 }}>Sem funis</p> : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {funnelData.map(f => {
                    const total = f.stages.reduce((s, x) => s + x.count, 0)
                    const max = Math.max(...f.stages.map(s => s.count), 1)
                    return (
                      <div key={f.nome}>
                        <div className="flex items-center justify-between" style={{ marginBottom: 4 }}>
                          <span style={{ fontSize: 10, fontWeight: 700, color: '#555' }}>{f.nome}</span>
                          <span style={{ fontSize: 9, fontWeight: 700, color: '#999' }}>{total}</span>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                          {f.stages.map(s => (
                            <div key={s.id} className="flex items-center gap-1.5">
                              <div style={{ width: 5, height: 5, borderRadius: '50%', background: s.cor || '#bbb', flexShrink: 0 }} />
                              <span style={{ fontSize: 9, color: '#888', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.nome}</span>
                              <Bar value={s.count} max={max} color={s.cor || '#bbb'} h={5} />
                              <span style={{ fontSize: 9, fontWeight: 700, color: '#555', width: 16, textAlign: 'right', flexShrink: 0 }}>{s.count}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            {/* Tempo médio por etapa */}
            <div style={card}>
              <p style={{ fontSize: 10, fontWeight: 700, color: '#888', margin: '0 0 8px', textTransform: 'uppercase' }}>Tempo médio por etapa</p>
              {avgTimePerStage.length === 0 ? <p style={{ fontSize: 10, color: '#bbb', textAlign: 'center', padding: 12 }}>Sem dados de movimentação</p> : (() => {
                const maxH = Math.max(...avgTimePerStage.map(s => s.avgHours), 1)
                const fmtDuration = (h: number) => {
                  if (h < 1) return `${Math.round(h * 60)}min`
                  if (h < 24) return `${h.toFixed(1)}h`
                  const d = h / 24
                  return d < 2 ? `${d.toFixed(1)} dia` : `${d.toFixed(1)} dias`
                }
                const grouped = avgTimePerStage.reduce<Record<string, typeof avgTimePerStage>>((acc, s) => {
                  if (!acc[s.funnelName]) acc[s.funnelName] = []
                  acc[s.funnelName].push(s)
                  return acc
                }, {})
                return (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {Object.entries(grouped).map(([fName, items]) => (
                      <div key={fName}>
                        <span style={{ fontSize: 10, fontWeight: 700, color: '#555', marginBottom: 4, display: 'block' }}>{fName}</span>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                          {items.map(s => (
                            <div key={s.id} className="flex items-center gap-1.5">
                              <div style={{ width: 5, height: 5, borderRadius: '50%', background: s.cor || '#bbb', flexShrink: 0 }} />
                              <span style={{ fontSize: 9, color: '#888', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.nome}</span>
                              <Bar value={s.avgHours} max={maxH} color={s.cor || '#bbb'} h={5} />
                              <span style={{ fontSize: 9, fontWeight: 700, color: '#555', minWidth: 40, textAlign: 'right', flexShrink: 0 }}>{fmtDuration(s.avgHours)}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )
              })()}
            </div>
          </div>
        </Section>

      </main>
    </div>
  )
}
