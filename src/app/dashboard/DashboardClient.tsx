'use client'

import React, { useState, useMemo } from 'react'
import type { Profile } from '@/types/database'
import { displayName } from '@/types/database'

// ─── Types ────────────────────────────────────────────────────────────────────

interface LeadRow     { id: string; stage_id: string | null; created_at: string; origem: string | null }
interface QuoteRow    { id: string; status: string; total_calculado: number | null; criado_em: string; aceito_em: string | null }
interface StageRow    { id: string; nome: string; cor: string; ordem: number; funnel_id: string; funnel: { id: string; nome: string } | null }
interface TaskRow     { id: string; concluida_em: string | null; data_vencimento: string | null; responsavel_id: string | null }
interface ConvRow     { id: string; lead_id: string | null; unread_count: number; last_message_at: string | null; last_message_direction: string | null }
interface MsgRow      { id: string; conversation_id: string; direction: string; created_at: string; sent_by: string | null }
interface ProfileRow  { id: string; full_name: string; apelido: string | null }

interface Props {
  currentUser:   Profile
  leads:         LeadRow[]
  quotes:        QuoteRow[]
  stages:        StageRow[]
  tasks:         TaskRow[]
  conversations: ConvRow[]
  messages:      MsgRow[]
  profiles:      ProfileRow[]
}

type Period = '7d' | '30d' | '90d' | 'all'
const PERIOD_LABELS: Record<Period, string> = { '7d': '7 dias', '30d': '30 dias', '90d': '90 dias', all: 'Tudo' }

// ─── Helpers ─────────────────────────────────────────────────────────────────

const fmtBRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })

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

// ─── Subcomponents ───────────────────────────────────────────────────────────

function KpiCard({ label, value, sub, valueColor, subColor, icon, chipColor }: {
  label: string; value: string | number; sub?: string
  valueColor?: string; subColor?: string
  icon: React.ReactNode; chipColor: string
}) {
  return (
    <div style={{ background: '#fff', border: '1px solid #EBE7DA', borderRadius: '18px', padding: '18px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
        <p style={{ fontSize: '10.5px', fontWeight: 800, letterSpacing: '0.05em', color: '#9AA79C', margin: 0 }}>{label.toUpperCase()}</p>
        <div style={{ width: '30px', height: '30px', borderRadius: '10px', background: chipColor, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {icon}
        </div>
      </div>
      <p style={{ fontSize: '27px', fontWeight: 900, margin: '4px 0', letterSpacing: '-0.02em', color: valueColor ?? '#25402C' }}>{value}</p>
      {sub && <p style={{ fontSize: '11.5px', fontWeight: 700, color: subColor ?? '#9AA79C', margin: 0 }}>{sub}</p>}
    </div>
  )
}

function MiniBar({ value, max, color }: { value: number; max: number; color: string }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0
  return (
    <div className="flex-1 rounded-full overflow-hidden" style={{ background: 'var(--color-track)', height: '10px' }}>
      <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: color }} />
    </div>
  )
}

// ─── Icons ───────────────────────────────────────────────────────────────────

const IcoContacts = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#1E86C0" strokeWidth="2"><circle cx="9" cy="8" r="3.2"/><path d="M3 20a6 6 0 0 1 12 0M16 11a3 3 0 0 0 0-6M21 20a5 5 0 0 0-4-4.9"/></svg>
const IcoQuote = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#3E9849" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="m9 14 2 2 4-4"/></svg>
const IcoMoney = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#3E9849" strokeWidth="2"><rect x="2" y="5" width="20" height="14" rx="2.5"/><circle cx="12" cy="12" r="2.6"/><path d="M2 10h2M20 10h2"/></svg>
const IcoTrend = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#C87F1B" strokeWidth="2"><polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/></svg>
const IcoClock = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#6366F1" strokeWidth="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
const IcoAlert = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#DC2626" strokeWidth="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
const IcoTask = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#F59E0B" strokeWidth="2"><path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/><rect x="9" y="3" width="6" height="4" rx="1"/><path d="m9 12 2 2 4-4"/></svg>
const IcoLost = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#DC2626" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><line x1="9" y1="15" x2="15" y2="15"/></svg>

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function DashboardClient({ currentUser, leads, quotes, stages, tasks, conversations, messages, profiles }: Props) {
  const [period, setPeriod] = useState<Period>('30d')
  const cut = useMemo(() => cutoff(period), [period])

  const filteredQuotes = useMemo(() => quotes.filter(q => inPeriod(q.criado_em, cut)), [quotes, cut])
  const filteredLeads  = useMemo(() => leads.filter(l => inPeriod(l.created_at, cut)), [leads, cut])

  // ── KPIs existentes ──────────────────────────────────────────────────────
  const kpis = useMemo(() => {
    const aceitos   = filteredQuotes.filter(q => q.status === 'aceito')
    const recusados = filteredQuotes.filter(q => q.status === 'recusado')
    const enviados  = filteredQuotes.filter(q => ['enviado', 'visualizado', 'aceito', 'recusado'].includes(q.status))
    const totalAceito   = aceitos.reduce((s, q) => s + (q.total_calculado ?? 0), 0)
    const totalRecusado = recusados.reduce((s, q) => s + (q.total_calculado ?? 0), 0)
    const ticketMed = aceitos.length > 0 ? totalAceito / aceitos.length : 0
    const taxaConv  = enviados.length > 0 ? Math.round((aceitos.length / enviados.length) * 100) : 0

    return {
      leadsAtivos: leads.length, novosLeads: filteredLeads.length,
      aceitos: aceitos.length, totalAceito, totalRecusado,
      ticketMedio: ticketMed, taxaConv, enviados: enviados.length,
    }
  }, [filteredQuotes, filteredLeads, leads])

  // ── Tempo médio de resposta WhatsApp ─────────────────────────────────────
  const avgResponseMin = useMemo(() => {
    const msgsByConv: Record<string, MsgRow[]> = {}
    for (const m of messages) {
      if (!msgsByConv[m.conversation_id]) msgsByConv[m.conversation_id] = []
      msgsByConv[m.conversation_id].push(m)
    }
    const responseTimes: number[] = []
    for (const convMsgs of Object.values(msgsByConv)) {
      const sorted = [...convMsgs].sort((a, b) => a.created_at.localeCompare(b.created_at))
      for (let i = 0; i < sorted.length - 1; i++) {
        if (sorted[i].direction === 'inbound' && sorted[i + 1].direction === 'outbound') {
          const diff = new Date(sorted[i + 1].created_at).getTime() - new Date(sorted[i].created_at).getTime()
          if (diff > 0 && diff < 24 * 60 * 60 * 1000) {
            if (!cut || new Date(sorted[i].created_at) >= cut) {
              responseTimes.push(diff / 60000)
            }
          }
        }
      }
    }
    if (responseTimes.length === 0) return null
    return Math.round(responseTimes.reduce((s, t) => s + t, 0) / responseTimes.length)
  }, [messages, cut])

  // ── Conversas sem resposta ───────────────────────────────────────────────
  const unansweredCount = useMemo(() => {
    return conversations.filter(c =>
      c.last_message_direction === 'inbound' &&
      c.last_message_at &&
      (!cut || new Date(c.last_message_at) >= cut)
    ).length
  }, [conversations, cut])

  // ── Tarefas pendentes e vencidas ─────────────────────────────────────────
  const taskStats = useMemo(() => {
    const now = new Date().toISOString().slice(0, 10)
    const pending = tasks.filter(t => !t.concluida_em)
    const overdue = pending.filter(t => t.data_vencimento && t.data_vencimento < now)
    return { pending: pending.length, overdue: overdue.length }
  }, [tasks])

  // ── Ranking de atendentes ────────────────────────────────────────────────
  const agentRanking = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const m of messages) {
      if (m.direction !== 'outbound' || !m.sent_by) continue
      if (cut && new Date(m.created_at) < cut) continue
      counts[m.sent_by] = (counts[m.sent_by] ?? 0) + 1
    }
    return Object.entries(counts)
      .map(([id, count]) => {
        const p = profiles.find(pr => pr.id === id)
        return { name: p ? displayName(p) : 'Desconhecido', count }
      })
      .sort((a, b) => b.count - a.count)
      .slice(0, 5)
  }, [messages, profiles, cut])

  // ── Leads por origem ─────────────────────────────────────────────────────
  const leadsByOrigem = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const l of filteredLeads) {
      const key = l.origem?.trim() || 'Não informada'
      counts[key] = (counts[key] ?? 0) + 1
    }
    return Object.entries(counts)
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8)
  }, [filteredLeads])

  // ── Funil de orçamentos ──────────────────────────────────────────────────
  const quoteFunnel = useMemo(() => {
    const all = filteredQuotes
    return [
      { label: 'Criados',      count: all.length,                                                                color: '#9AA79C' },
      { label: 'Enviados',     count: all.filter(q => ['enviado','visualizado','aceito','recusado'].includes(q.status)).length, color: '#1E86C0' },
      { label: 'Visualizados', count: all.filter(q => ['visualizado','aceito','recusado'].includes(q.status)).length,           color: '#64AEDC' },
      { label: 'Aceitos',      count: all.filter(q => q.status === 'aceito').length,                              color: '#3E9849' },
      { label: 'Recusados',    count: all.filter(q => q.status === 'recusado').length,                            color: '#C05B3A' },
    ]
  }, [filteredQuotes])

  // ── Leads por funil/stage ────────────────────────────────────────────────
  const funnelData = useMemo(() => {
    const byFunnel: Record<string, { nome: string; stages: { id: string; nome: string; cor: string; count: number }[] }> = {}
    for (const stage of stages) {
      const fId   = stage.funnel_id
      const fNome = stage.funnel?.nome ?? 'Funil'
      if (!byFunnel[fId]) byFunnel[fId] = { nome: fNome, stages: [] }
      const count = leads.filter(l => l.stage_id === stage.id).length
      byFunnel[fId].stages.push({ id: stage.id, nome: stage.nome, cor: stage.cor, count })
    }
    return Object.values(byFunnel)
  }, [stages, leads])

  // ── Distribuição de status ───────────────────────────────────────────────
  const statusDist = useMemo(() => {
    const map: Record<string, number> = {}
    for (const q of filteredQuotes) map[q.status] = (map[q.status] ?? 0) + 1
    const total = filteredQuotes.length
    return [
      { label: 'Rascunho',     key: 'rascunho',     color: '#B9B4A2', count: map['rascunho']     ?? 0 },
      { label: 'Enviado',      key: 'enviado',      color: '#1E86C0', count: map['enviado']      ?? 0 },
      { label: 'Visualizado',  key: 'visualizado',  color: '#64AEDC', count: map['visualizado']  ?? 0 },
      { label: 'Aceito',       key: 'aceito',       color: '#3E9849', count: map['aceito']       ?? 0 },
      { label: 'Recusado',     key: 'recusado',     color: '#C05B3A', count: map['recusado']     ?? 0 },
    ].filter(s => s.count > 0).map(s => ({ ...s, pct: total > 0 ? Math.round(s.count / total * 100) : 0 }))
  }, [filteredQuotes])

  const fmtTime = (min: number | null) => {
    if (min === null) return '—'
    if (min < 60) return `${min}min`
    const h = Math.floor(min / 60)
    const m = min % 60
    return m > 0 ? `${h}h ${m}min` : `${h}h`
  }

  return (
    <div className="flex flex-col flex-1 overflow-hidden">

      {/* Header */}
      <header className="bg-white shrink-0 flex items-center justify-between" style={{ padding: '16px 26px', borderBottom: '1px solid #E9E5D8' }}>
        <div>
          <h1 style={{ fontSize: '19px', fontWeight: 900, color: '#25402C' }}>
            Olá, {currentUser.full_name?.split(' ')[0] ?? 'bem-vindo'}
          </h1>
          <p style={{ fontSize: '11.5px', fontWeight: 600, color: '#9AA79C', marginTop: 2 }}>
            Visão geral do funil comercial
          </p>
        </div>
        <div className="flex items-center gap-1" style={{ background: '#F1EFE5', borderRadius: '999px', padding: '3px' }}>
          {(Object.keys(PERIOD_LABELS) as Period[]).map(p => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className="transition-colors"
              style={{
                fontSize: '12px', fontWeight: period === p ? 800 : 700, padding: '6px 14px', borderRadius: '999px',
                background: period === p ? '#25402C' : 'transparent',
                color: period === p ? '#fff' : '#71856F',
                border: 'none', cursor: 'pointer',
              }}
            >
              {PERIOD_LABELS[p]}
            </button>
          ))}
        </div>
      </header>

      <main className="flex-1 overflow-auto p-6 space-y-6" style={{ background: '#F6F4EC' }}>

        {/* ── KPIs — linha 1 ── */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <KpiCard label="Contatos ativos" value={kpis.leadsAtivos} sub={`+${kpis.novosLeads} no período`} subColor="#35853F" chipColor="#DCEFFA" icon={<IcoContacts />} />
          <KpiCard label="Orçamentos aceitos" value={kpis.aceitos} sub={`de ${kpis.enviados} enviados`} chipColor="#E8F4E6" icon={<IcoQuote />} />
          <KpiCard label="Receita gerada" value={kpis.totalAceito > 0 ? fmtBRL.format(kpis.totalAceito) : '—'} sub={kpis.aceitos > 0 ? `ticket médio ${fmtBRL.format(kpis.ticketMedio)}` : undefined} valueColor="#35853F" chipColor="#E8F4E6" icon={<IcoMoney />} />
          <KpiCard label="Taxa de conversão" value={`${kpis.taxaConv}%`} sub="aceitos / enviados" valueColor={kpis.taxaConv >= 50 ? '#35853F' : kpis.taxaConv >= 25 ? '#C87F1B' : '#C05B3A'} chipColor="#FCF3E4" icon={<IcoTrend />} />
        </div>

        {/* ── KPIs — linha 2 (novos) ── */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <KpiCard label="Tempo médio de resposta" value={fmtTime(avgResponseMin)} sub="1ª resposta WhatsApp" valueColor={avgResponseMin !== null && avgResponseMin <= 15 ? '#35853F' : avgResponseMin !== null && avgResponseMin <= 60 ? '#C87F1B' : '#C05B3A'} chipColor="#EDE9FE" icon={<IcoClock />} />
          <KpiCard label="Sem resposta" value={unansweredCount} sub="conversas aguardando" valueColor={unansweredCount > 5 ? '#DC2626' : unansweredCount > 0 ? '#C87F1B' : '#35853F'} chipColor="#FEE2E2" icon={<IcoAlert />} />
          <KpiCard label="Tarefas pendentes" value={taskStats.pending} sub={taskStats.overdue > 0 ? `${taskStats.overdue} vencida${taskStats.overdue > 1 ? 's' : ''}` : 'nenhuma vencida'} subColor={taskStats.overdue > 0 ? '#DC2626' : '#9AA79C'} chipColor="#FEF3C7" icon={<IcoTask />} />
          <KpiCard label="Receita recusada" value={kpis.totalRecusado > 0 ? fmtBRL.format(kpis.totalRecusado) : '—'} sub="oportunidades perdidas" valueColor={kpis.totalRecusado > 0 ? '#DC2626' : '#9AA79C'} chipColor="#FEE2E2" icon={<IcoLost />} />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

          {/* ── Funil de orçamentos ── */}
          <div className="bg-white rounded-2xl p-5" style={{ border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-sm)' }}>
            <h2 className="text-sm font-semibold mb-4" style={{ color: 'var(--color-ink)' }}>Funil de Orçamentos</h2>
            {filteredQuotes.length === 0 ? (
              <p className="text-sm text-[#9AA79C] text-center py-8">Nenhum orçamento no período</p>
            ) : (
              <div className="space-y-3">
                {quoteFunnel.map((step, i) => {
                  const max = quoteFunnel[0].count
                  const prev = i > 0 ? quoteFunnel[i - 1].count : null
                  const convRate = prev && prev > 0 ? Math.round(step.count / prev * 100) : null
                  return (
                    <div key={step.label}>
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-medium text-[#35543B]">{step.label}</span>
                          {convRate !== null && <span className="text-[10px] text-[#9AA79C]">↓ {convRate}%</span>}
                        </div>
                        <span className="text-xs font-bold" style={{ color: step.color }}>{step.count}</span>
                      </div>
                      <div className="rounded-full overflow-hidden" style={{ background: 'var(--color-track)', height: '10px' }}>
                        <div className="h-full rounded-full transition-all" style={{ width: max > 0 ? `${Math.round(step.count / max * 100)}%` : '0%', backgroundColor: step.color }} />
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* ── Distribuição de status — donut ── */}
          <div className="bg-white rounded-2xl p-5" style={{ border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-sm)' }}>
            <h2 className="text-sm font-semibold mb-4" style={{ color: 'var(--color-ink)' }}>Distribuição de Status</h2>
            {statusDist.length === 0 ? (
              <p className="text-sm text-[#9AA79C] text-center py-8">Nenhum orçamento no período</p>
            ) : (() => {
              const total = filteredQuotes.length
              let acc = 0
              const stops = statusDist.map(s => { const from = acc; acc += s.pct; return `${s.color} ${from}% ${acc}%` })
              const conicGrad = `conic-gradient(${stops.join(', ')})`
              return (
                <div style={{ display: 'flex', alignItems: 'center', gap: '22px' }}>
                  <div style={{ position: 'relative', width: '140px', height: '140px', flexShrink: 0, borderRadius: '50%', background: conicGrad }}>
                    <div style={{ position: 'absolute', inset: '26px', background: '#fff', borderRadius: '50%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                      <span style={{ fontSize: '24px', fontWeight: 800, lineHeight: 1 }}>{total}</span>
                      <span style={{ fontSize: '11px', color: '#9AA79C' }}>total</span>
                    </div>
                  </div>
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '11px' }}>
                    {statusDist.map(s => (
                      <div key={s.key} style={{ display: 'flex', alignItems: 'center', gap: '9px', fontSize: '13px' }}>
                        <div style={{ width: '9px', height: '9px', borderRadius: '3px', background: s.color, flexShrink: 0 }} />
                        <span style={{ flex: 1, fontWeight: 600 }}>{s.label}</span>
                        <span style={{ fontWeight: 700 }}>{s.count}</span>
                        <span style={{ color: '#9AA79C', width: '36px', textAlign: 'right' }}>{s.pct}%</span>
                      </div>
                    ))}
                  </div>
                </div>
              )
            })()}
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

          {/* ── Ranking de atendentes ── */}
          <div className="bg-white rounded-2xl p-5" style={{ border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-sm)' }}>
            <h2 className="text-sm font-semibold mb-4" style={{ color: 'var(--color-ink)' }}>Ranking de Atendentes</h2>
            {agentRanking.length === 0 ? (
              <p className="text-sm text-[#9AA79C] text-center py-8">Nenhuma mensagem enviada no período</p>
            ) : (
              <div className="space-y-3">
                {agentRanking.map((agent, i) => {
                  const max = agentRanking[0].count
                  return (
                    <div key={agent.name} className="flex items-center gap-3">
                      <div style={{
                        width: 26, height: 26, borderRadius: '50%', flexShrink: 0,
                        background: i === 0 ? '#E8F4E6' : '#F1EFE5',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 11, fontWeight: 800,
                        color: i === 0 ? '#3E9849' : '#9AA79C',
                      }}>
                        {i + 1}
                      </div>
                      <span className="text-xs font-semibold text-[#35543B] flex-shrink-0 w-24 truncate">{agent.name}</span>
                      <MiniBar value={agent.count} max={max} color={i === 0 ? '#3E9849' : '#9AA79C'} />
                      <span className="text-xs font-bold text-[#25402C] w-8 text-right shrink-0">{agent.count}</span>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* ── Leads por origem ── */}
          <div className="bg-white rounded-2xl p-5" style={{ border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-sm)' }}>
            <h2 className="text-sm font-semibold mb-4" style={{ color: 'var(--color-ink)' }}>Leads por Origem</h2>
            {leadsByOrigem.length === 0 ? (
              <p className="text-sm text-[#9AA79C] text-center py-8">Nenhum lead no período</p>
            ) : (
              <div className="space-y-3">
                {leadsByOrigem.map(o => {
                  const max = leadsByOrigem[0].count
                  return (
                    <div key={o.label} className="flex items-center gap-3">
                      <span className="text-xs font-semibold text-[#35543B] flex-shrink-0 w-28 truncate">{o.label}</span>
                      <MiniBar value={o.count} max={max} color="#1E86C0" />
                      <span className="text-xs font-bold text-[#25402C] w-8 text-right shrink-0">{o.count}</span>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>

        {/* ── Contatos por funil ── */}
        <div className="bg-white rounded-2xl p-5" style={{ border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-sm)' }}>
          <h2 className="text-sm font-semibold mb-4" style={{ color: 'var(--color-ink)' }}>Contatos por Funil</h2>
          {funnelData.length === 0 ? (
            <p className="text-sm text-[#9AA79C] text-center py-8">Nenhum funil configurado</p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
              {funnelData.map(f => {
                const total = f.stages.reduce((s, x) => s + x.count, 0)
                const max   = Math.max(...f.stages.map(s => s.count), 1)
                return (
                  <div key={f.nome}>
                    <div className="flex items-center justify-between mb-3">
                      <p className="text-xs font-semibold text-[#35543B]">{f.nome}</p>
                      <span className="text-xs font-bold text-[#71856F]">{total} contatos</span>
                    </div>
                    <div className="space-y-2">
                      {f.stages.map(stage => (
                        <div key={stage.id} className="flex items-center gap-2.5">
                          <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: stage.cor || '#9ca3af' }} />
                          <span className="text-xs text-[#71856F] truncate flex-1 min-w-0">{stage.nome}</span>
                          <MiniBar value={stage.count} max={max} color={stage.cor || '#9ca3af'} />
                          <span className="text-xs font-semibold text-[#25402C] w-5 text-right shrink-0">{stage.count}</span>
                        </div>
                      ))}
                      {f.stages.every(s => s.count === 0) && (
                        <p className="text-xs text-[#9AA79C] text-center py-2">Nenhum contato neste funil</p>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

      </main>
    </div>
  )
}
