'use client'

import React, { useState, useMemo } from 'react'
import type { Profile } from '@/types/database'

// ─── Types ────────────────────────────────────────────────────────────────────

interface LeadRow   { id: string; stage_id: string | null; created_at: string }
interface QuoteRow  { id: string; status: string; total_calculado: number | null; criado_em: string; aceito_em: string | null }
interface StageRow  { id: string; nome: string; cor: string; ordem: number; funnel_id: string; funnel: { id: string; nome: string } | null }

interface Props {
  currentUser: Profile
  leads:       LeadRow[]
  quotes:      QuoteRow[]
  stages:      StageRow[]
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

function inPeriod(iso: string, cut: Date | null) {
  return cut ? new Date(iso) >= cut : true
}

// ─── Subcomponents ───────────────────────────────────────────────────────────

function KpiCard({ label, value, sub, valueColor, subColor, icon, chipColor, gradient, borderColor }: {
  label: string; value: string | number; sub?: string
  valueColor?: string; subColor?: string
  icon: React.ReactNode; chipColor: string; gradient: string; borderColor: string
}) {
  return (
    <div style={{ background: gradient, border: `1px solid ${borderColor}`, borderRadius: '18px', padding: '18px' }}>
      <div style={{ width: '38px', height: '38px', borderRadius: '11px', background: chipColor, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '12px' }}>
        {icon}
      </div>
      <p style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '0.05em', color: '#5B6B7B', margin: 0 }}>{label.toUpperCase()}</p>
      <p style={{ fontSize: '30px', fontWeight: 800, margin: '4px 0', letterSpacing: '-0.02em', color: valueColor ?? 'var(--color-ink)' }}>{value}</p>
      {sub && <p style={{ fontSize: '12px', fontWeight: 700, color: subColor ?? 'var(--color-muted)', margin: 0 }}>{sub}</p>}
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

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function DashboardClient({ currentUser, leads, quotes, stages }: Props) {
  const [period, setPeriod] = useState<Period>('30d')

  const cut = useMemo(() => cutoff(period), [period])

  // ── Quotes filtrados pelo período ─────────────────────────────────────────
  const filteredQuotes = useMemo(() =>
    quotes.filter(q => inPeriod(q.criado_em, cut)),
    [quotes, cut]
  )

  const filteredLeads = useMemo(() =>
    leads.filter(l => inPeriod(l.created_at, cut)),
    [leads, cut]
  )

  // ── KPIs ──────────────────────────────────────────────────────────────────
  const kpis = useMemo(() => {
    const aceitos   = filteredQuotes.filter(q => q.status === 'aceito')
    const enviados  = filteredQuotes.filter(q => ['enviado', 'visualizado', 'aceito', 'recusado'].includes(q.status))
    const totalAceito = aceitos.reduce((s, q) => s + (q.total_calculado ?? 0), 0)
    const ticketMed = aceitos.length > 0 ? totalAceito / aceitos.length : 0
    const taxaConv  = enviados.length > 0 ? Math.round((aceitos.length / enviados.length) * 100) : 0

    return {
      leadsAtivos:  leads.length,          // total always (não filtrado por período)
      novosLeads:   filteredLeads.length,
      aceitos:      aceitos.length,
      totalAceito,
      ticketMedio:  ticketMed,
      taxaConv,
      enviados:     enviados.length,
    }
  }, [filteredQuotes, filteredLeads, leads])

  // ── Funil de orçamentos ───────────────────────────────────────────────────
  const quoteFunnel = useMemo(() => {
    const all = filteredQuotes
    return [
      { label: 'Criados',     count: all.length,                                                             color: '#8A98A6' },
      { label: 'Enviados',    count: all.filter(q => ['enviado','visualizado','aceito','recusado'].includes(q.status)).length, color: '#0098DA' },
      { label: 'Visualizados',count: all.filter(q => ['visualizado','aceito','recusado'].includes(q.status)).length,           color: '#54B3E6' },
      { label: 'Aceitos',     count: all.filter(q => q.status === 'aceito').length,                          color: '#4EB46B' },
      { label: 'Recusados',   count: all.filter(q => q.status === 'recusado').length,                        color: '#E5484D' },
    ]
  }, [filteredQuotes])

  // ── Leads por funil/stage ──────────────────────────────────────────────────
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

  // ── Status distribuição ───────────────────────────────────────────────────
  const statusDist = useMemo(() => {
    const map: Record<string, number> = {}
    for (const q of filteredQuotes) map[q.status] = (map[q.status] ?? 0) + 1
    const total = filteredQuotes.length
    return [
      { label: 'Rascunho',     key: 'rascunho',     color: '#8A98A6', count: map['rascunho']     ?? 0 },
      { label: 'Enviado',      key: 'enviado',      color: '#0098DA', count: map['enviado']      ?? 0 },
      { label: 'Visualizado',  key: 'visualizado',  color: '#54B3E6', count: map['visualizado']  ?? 0 },
      { label: 'Aceito',       key: 'aceito',       color: '#4EB46B', count: map['aceito']       ?? 0 },
      { label: 'Recusado',     key: 'recusado',     color: '#E5484D', count: map['recusado']     ?? 0 },
    ].filter(s => s.count > 0).map(s => ({ ...s, pct: total > 0 ? Math.round(s.count / total * 100) : 0 }))
  }, [filteredQuotes])

  return (
    <div className="flex flex-col flex-1 overflow-hidden">

      {/* Header */}
      <header className="bg-white px-6 py-4 shrink-0 flex items-center justify-between" style={{ borderBottom: '1px solid var(--color-border)' }}>
        <div>
          <h1 className="text-base font-semibold" style={{ color: 'var(--color-ink)' }}>
            Olá, {currentUser.full_name?.split(' ')[0] ?? 'bem-vindo'}
          </h1>
          <p className="text-xs mt-0.5" style={{ color: 'var(--color-muted)' }}>Visão geral do funil comercial</p>
        </div>
        <div className="flex items-center gap-1 rounded-xl p-1" style={{ background: 'var(--color-track)' }}>
          {(Object.keys(PERIOD_LABELS) as Period[]).map(p => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`text-xs font-medium px-3 py-1.5 rounded-lg transition-colors ${
                period === p ? 'bg-white shadow-sm' : 'hover:opacity-80'
              }`}
              style={{ color: period === p ? 'var(--color-ink)' : 'var(--color-muted)' }}
            >
              {PERIOD_LABELS[p]}
            </button>
          ))}
        </div>
      </header>

      <main className="flex-1 overflow-auto p-6 space-y-6">

        {/* ── KPIs ── */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <KpiCard
            label="Contatos ativos"
            value={kpis.leadsAtivos}
            sub={`+${kpis.novosLeads} no período`}
            subColor="#3E9D5A"
            gradient="linear-gradient(160deg,#EAF6FC,#F4FAFE)"
            borderColor="#D7EBF7"
            chipColor="#0098DA"
            icon={<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="9" cy="8" r="3.2"/><path d="M3 20a6 6 0 0 1 12 0M16 11a3 3 0 0 0 0-6M21 20a5 5 0 0 0-4-4.9"/></svg>}
          />
          <KpiCard
            label="Orçamentos aceitos"
            value={kpis.aceitos}
            sub={`de ${kpis.enviados} enviados`}
            gradient="linear-gradient(160deg,#E9F7EE,#F4FBF6)"
            borderColor="#CFEBD9"
            chipColor="#4EB46B"
            icon={<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="m9 14 2 2 4-4"/></svg>}
          />
          <KpiCard
            label="Receita gerada"
            value={kpis.totalAceito > 0 ? fmtBRL.format(kpis.totalAceito) : '—'}
            sub={kpis.aceitos > 0 ? `ticket médio ${fmtBRL.format(kpis.ticketMedio)}` : undefined}
            valueColor="#2E8E4C"
            gradient="linear-gradient(160deg,#E9F7EE,#F4FBF6)"
            borderColor="#CFEBD9"
            chipColor="#4EB46B"
            icon={<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="5" width="20" height="14" rx="2.5"/><circle cx="12" cy="12" r="2.6"/><path d="M2 10h2M20 10h2"/></svg>}
          />
          <KpiCard
            label="Taxa de conversão"
            value={`${kpis.taxaConv}%`}
            sub="aceitos / enviados"
            valueColor={kpis.taxaConv >= 50 ? '#2E8E4C' : kpis.taxaConv >= 25 ? '#D17F0E' : '#E5484D'}
            gradient="linear-gradient(160deg,#FEF4E6,#FFF9F0)"
            borderColor="#F7E2C2"
            chipColor="#F39313"
            icon={<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/></svg>}
          />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

          {/* ── Funil de orçamentos ── */}
          <div className="bg-white rounded-2xl p-5" style={{ border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-sm)' }}>
            <h2 className="text-sm font-semibold mb-4" style={{ color: 'var(--color-ink)' }}>Funil de Orçamentos</h2>
            {filteredQuotes.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-8">Nenhum orçamento no período</p>
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
                          <span className="text-xs font-medium text-gray-700">{step.label}</span>
                          {convRate !== null && (
                            <span className="text-[10px] text-gray-400">↓ {convRate}%</span>
                          )}
                        </div>
                        <span className="text-xs font-bold" style={{ color: step.color }}>{step.count}</span>
                      </div>
                      <div className="rounded-full overflow-hidden" style={{ background: 'var(--color-track)', height: '10px' }}>
                        <div
                          className="h-full rounded-full transition-all"
                          style={{ width: max > 0 ? `${Math.round(step.count / max * 100)}%` : '0%', backgroundColor: step.color }}
                        />
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* ── Status dos orçamentos — donut ── */}
          <div className="bg-white rounded-2xl p-5" style={{ border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-sm)' }}>
            <h2 className="text-sm font-semibold mb-4" style={{ color: 'var(--color-ink)' }}>Distribuição de Status</h2>
            {statusDist.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-8">Nenhum orçamento no período</p>
            ) : (() => {
              const total = filteredQuotes.length
              // build conic-gradient stops
              let acc = 0
              const stops = statusDist.map(s => {
                const from = acc
                acc += s.pct
                return `${s.color} ${from}% ${acc}%`
              })
              const conicGrad = `conic-gradient(${stops.join(', ')})`
              return (
                <div style={{ display: 'flex', alignItems: 'center', gap: '22px' }}>
                  <div style={{ position: 'relative', width: '140px', height: '140px', flexShrink: 0, borderRadius: '50%', background: conicGrad }}>
                    <div style={{ position: 'absolute', inset: '26px', background: '#fff', borderRadius: '50%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                      <span style={{ fontSize: '24px', fontWeight: 800, lineHeight: 1 }}>{total}</span>
                      <span style={{ fontSize: '11px', color: '#8A98A6' }}>total</span>
                    </div>
                  </div>
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '11px' }}>
                    {statusDist.map(s => (
                      <div key={s.key} style={{ display: 'flex', alignItems: 'center', gap: '9px', fontSize: '13px' }}>
                        <div style={{ width: '9px', height: '9px', borderRadius: '3px', background: s.color, flexShrink: 0 }} />
                        <span style={{ flex: 1, fontWeight: 600 }}>{s.label}</span>
                        <span style={{ fontWeight: 700 }}>{s.count}</span>
                        <span style={{ color: '#8A98A6', width: '36px', textAlign: 'right' }}>{s.pct}%</span>
                      </div>
                    ))}
                  </div>
                </div>
              )
            })()}
          </div>
        </div>

        {/* ── Leads por funil ── */}
        <div className="bg-white rounded-2xl p-5" style={{ border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-sm)' }}>
          <h2 className="text-sm font-semibold mb-4" style={{ color: 'var(--color-ink)' }}>Contatos por Funil</h2>
          {funnelData.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-8">Nenhum funil configurado</p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
              {funnelData.map(f => {
                const total = f.stages.reduce((s, x) => s + x.count, 0)
                const max   = Math.max(...f.stages.map(s => s.count), 1)
                return (
                  <div key={f.nome}>
                    <div className="flex items-center justify-between mb-3">
                      <p className="text-xs font-semibold text-gray-700">{f.nome}</p>
                      <span className="text-xs font-bold text-gray-500">{total} contatos</span>
                    </div>
                    <div className="space-y-2">
                      {f.stages.map(stage => (
                        <div key={stage.id} className="flex items-center gap-2.5">
                          <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: stage.cor || '#9ca3af' }} />
                          <span className="text-xs text-gray-600 truncate flex-1 min-w-0">{stage.nome}</span>
                          <MiniBar value={stage.count} max={max} color={stage.cor || '#9ca3af'} />
                          <span className="text-xs font-semibold text-gray-800 w-5 text-right shrink-0">{stage.count}</span>
                        </div>
                      ))}
                      {f.stages.every(s => s.count === 0) && (
                        <p className="text-xs text-gray-400 text-center py-2">Nenhum contato neste funil</p>
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
