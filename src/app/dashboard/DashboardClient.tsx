'use client'

import { useState, useMemo } from 'react'
import type { Profile } from '@/types/database'

// ─── Types ────────────────────────────────────────────────────────────────────

interface LeadRow   { id: string; stage_id: string | null; criado_em: string }
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

function KpiCard({ label, value, sub, color = 'text-gray-900' }: {
  label: string; value: string | number; sub?: string; color?: string
}) {
  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-5 shadow-sm">
      <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-2">{label}</p>
      <p className={`text-2xl font-bold ${color}`}>{value}</p>
      {sub && <p className="text-xs text-gray-400 mt-1">{sub}</p>}
    </div>
  )
}

function MiniBar({ value, max, color }: { value: number; max: number; color: string }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0
  return (
    <div className="flex-1 bg-gray-100 rounded-full h-2 overflow-hidden">
      <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: color || '#6366f1' }} />
    </div>
  )
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function DashboardClient({ leads, quotes, stages }: Props) {
  const [period, setPeriod] = useState<Period>('30d')

  const cut = useMemo(() => cutoff(period), [period])

  // ── Quotes filtrados pelo período ─────────────────────────────────────────
  const filteredQuotes = useMemo(() =>
    quotes.filter(q => inPeriod(q.criado_em, cut)),
    [quotes, cut]
  )

  const filteredLeads = useMemo(() =>
    leads.filter(l => inPeriod(l.criado_em, cut)),
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
      { label: 'Criados',     count: all.length,                                                             color: '#6b7280' },
      { label: 'Enviados',    count: all.filter(q => ['enviado','visualizado','aceito','recusado'].includes(q.status)).length, color: '#3b82f6' },
      { label: 'Visualizados',count: all.filter(q => ['visualizado','aceito','recusado'].includes(q.status)).length,           color: '#8b5cf6' },
      { label: 'Aceitos',     count: all.filter(q => q.status === 'aceito').length,                          color: '#10b981' },
      { label: 'Recusados',   count: all.filter(q => q.status === 'recusado').length,                        color: '#ef4444' },
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
      { label: 'Rascunho',     key: 'rascunho',     color: '#9ca3af', count: map['rascunho']     ?? 0 },
      { label: 'Enviado',      key: 'enviado',      color: '#3b82f6', count: map['enviado']      ?? 0 },
      { label: 'Visualizado',  key: 'visualizado',  color: '#8b5cf6', count: map['visualizado']  ?? 0 },
      { label: 'Aceito',       key: 'aceito',       color: '#10b981', count: map['aceito']       ?? 0 },
      { label: 'Recusado',     key: 'recusado',     color: '#ef4444', count: map['recusado']     ?? 0 },
    ].filter(s => s.count > 0).map(s => ({ ...s, pct: total > 0 ? Math.round(s.count / total * 100) : 0 }))
  }, [filteredQuotes])

  return (
    <div className="flex flex-col flex-1 overflow-hidden">

      {/* Header */}
      <header className="bg-white border-b border-gray-200 px-6 py-4 shrink-0 flex items-center justify-between">
        <div>
          <h1 className="text-base font-semibold text-gray-900">Dashboard</h1>
          <p className="text-xs text-gray-400 mt-0.5">Visão geral do funil comercial</p>
        </div>
        <div className="flex items-center gap-1 bg-gray-100 rounded-xl p-1">
          {(Object.keys(PERIOD_LABELS) as Period[]).map(p => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`text-xs font-medium px-3 py-1.5 rounded-lg transition-colors ${
                period === p ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
              }`}
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
            label="Leads ativos"
            value={kpis.leadsAtivos}
            sub={`+${kpis.novosLeads} no período`}
            color="text-gray-900"
          />
          <KpiCard
            label="Orçamentos aceitos"
            value={kpis.aceitos}
            sub={`de ${kpis.enviados} enviados`}
            color="text-emerald-600"
          />
          <KpiCard
            label="Receita gerada"
            value={kpis.totalAceito > 0 ? fmtBRL.format(kpis.totalAceito) : '—'}
            sub={kpis.aceitos > 0 ? `ticket médio ${fmtBRL.format(kpis.ticketMedio)}` : undefined}
            color="text-emerald-600"
          />
          <KpiCard
            label="Taxa de conversão"
            value={`${kpis.taxaConv}%`}
            sub="orçamentos aceitos / enviados"
            color={kpis.taxaConv >= 50 ? 'text-emerald-600' : kpis.taxaConv >= 25 ? 'text-amber-500' : 'text-gray-900'}
          />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

          {/* ── Funil de orçamentos ── */}
          <div className="bg-white rounded-2xl border border-gray-200 p-5 shadow-sm">
            <h2 className="text-sm font-semibold text-gray-900 mb-4">Funil de Orçamentos</h2>
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
                      <div className="bg-gray-100 rounded-full h-2.5 overflow-hidden">
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

          {/* ── Status dos orçamentos ── */}
          <div className="bg-white rounded-2xl border border-gray-200 p-5 shadow-sm">
            <h2 className="text-sm font-semibold text-gray-900 mb-4">Distribuição de Status</h2>
            {statusDist.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-8">Nenhum orçamento no período</p>
            ) : (
              <div className="space-y-3">
                {statusDist.map(s => (
                  <div key={s.key} className="flex items-center gap-3">
                    <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: s.color }} />
                    <span className="text-xs text-gray-600 w-24 shrink-0">{s.label}</span>
                    <MiniBar value={s.count} max={filteredQuotes.length} color={s.color} />
                    <div className="flex items-center gap-1.5 shrink-0">
                      <span className="text-xs font-semibold text-gray-900 w-6 text-right">{s.count}</span>
                      <span className="text-[11px] text-gray-400 w-8">{s.pct}%</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* ── Leads por funil ── */}
        <div className="bg-white rounded-2xl border border-gray-200 p-5 shadow-sm">
          <h2 className="text-sm font-semibold text-gray-900 mb-4">Leads por Funil</h2>
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
                      <span className="text-xs font-bold text-gray-500">{total} leads</span>
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
                        <p className="text-xs text-gray-400 text-center py-2">Nenhum lead neste funil</p>
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
