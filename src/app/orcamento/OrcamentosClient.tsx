'use client'

import { useState, useMemo, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { Profile, Product, QuoteTemplate, QuoteStatus, UnitPaymentFees } from '@/types/database'
import { QUOTE_STATUS_LABELS } from '@/types/database'
import { enviarOrcamentoWhatsapp } from '@/lib/orcamento/enviar-whatsapp'
import QuoteModal, { StatusBadge, StatCard, type PatientOption, type QuoteRow } from '@/components/orcamento/QuoteModal'

// Tipos usados pelo page.tsx (o formulário vive em components/orcamento/QuoteModal)
export type { PatientOption, LeadOption, QuoteRow } from '@/components/orcamento/QuoteModal'

interface Props {
  currentUser:    Profile
  initialQuotes:  QuoteRow[]
  products:       Product[]
  templates:      QuoteTemplate[]
  leads:          PatientOption[]
  paymentFees:    UnitPaymentFees | null
  initialLeadId?:  string | null
  initialQuoteId?: string | null
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const fmtBRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

function patientName(q: { lead: PatientOption | null; paciente_nome?: string | null }): string {
  if (q.paciente_nome?.trim()) return q.paciente_nome.trim()
  const p = q.lead
  if (!p) return '—'
  return `${p.nome}${p.sobrenome ? ` ${p.sobrenome}` : ''}`
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function OrcamentosClient({
  currentUser, initialQuotes, products, templates, leads, paymentFees,
  initialLeadId, initialQuoteId,
}: Props) {
  const [quotes,      setQuotes]      = useState<QuoteRow[]>(initialQuotes)
  const [search,      setSearch]      = useState('')
  const [filterSt,    setFilterSt]    = useState<QuoteStatus | 'todos'>('todos')
  const [modalOpen,   setModalOpen]   = useState(false)
  const [editing,     setEditing]     = useState<QuoteRow | null>(null)
  const [copiedId,    setCopiedId]    = useState<string | null>(null)
  const [deletingId,  setDeletingId]  = useState<string | null>(null)
  const [enviandoId,  setEnviandoId]  = useState<string | null>(null)
  const [enviadoId,   setEnviadoId]   = useState<string | null>(null)

  const canDelete = currentUser.perfil === 'admin' || currentUser.perfil === 'gestor_unidade' || currentUser.perfil === 'gestor_vacivitta'

  // Pré-seleciona paciente ou orçamento ao navegar com query param
  const [initialPatient, setInitialPatient] = useState<PatientOption | null>(null)
  useEffect(() => {
    if (initialQuoteId) {
      const q = initialQuotes.find(x => x.id === initialQuoteId) ?? null
      if (q) { setEditing(q); setModalOpen(true) }
      return
    }
    if (initialLeadId) {
      const p = leads.find(l => l.id === initialLeadId)
      if (p) { setInitialPatient(p); setModalOpen(true) }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const filtered = useMemo(() => {
    return quotes.filter(q => {
      if (filterSt !== 'todos' && q.status !== filterSt) return false
      if (search.trim()) {
        const s    = search.toLowerCase()
        const name = patientName(q).toLowerCase()
        const num  = String(q.numero ?? '').padStart(4, '0')
        if (!name.includes(s) && !num.includes(s)) return false
      }
      return true
    })
  }, [quotes, search, filterSt])

  const stats = useMemo(() => {
    const aceitos     = quotes.filter(q => q.status === 'aceito')
    const recusados   = quotes.filter(q => q.status === 'recusado')
    const rascunhos   = quotes.filter(q => q.status === 'rascunho').length
    const enviados    = quotes.filter(q => ['enviado', 'visualizado'].includes(q.status)).length
    const aguardando    = quotes.filter(q => ['enviado', 'visualizado', 'em_negociacao'].includes(q.status))
    const totalAceito     = aceitos.reduce((s, q) => s + (q.total_calculado ?? 0), 0)
    const totalRecusado   = recusados.reduce((s, q) => s + (q.total_calculado ?? 0), 0)
    const totalAguardando = aguardando.reduce((s, q) => s + (q.total_calculado ?? 0), 0)
    return { total: quotes.length, aceitos: aceitos.length, recusados: recusados.length, rascunhos, enviados, totalAceito, totalRecusado, totalAguardando }
  }, [quotes])

  function handleSaved(q: QuoteRow, isNew: boolean) {
    setQuotes(prev => isNew ? [q, ...prev] : prev.map(x => x.id === q.id ? q : x))
    setModalOpen(false)
    setEditing(null)
  }

  async function handleDelete(q: QuoteRow) {
    if (!window.confirm(`Excluir orçamento #${String(q.numero ?? 0).padStart(4, '0')} de ${patientName(q)}? Esta ação não pode ser desfeita.`)) return
    setDeletingId(q.id)
    const supabase = createClient()
    const { error } = await supabase.from('quotes').delete().eq('id', q.id)
    setDeletingId(null)
    if (error) { alert('Erro ao excluir: ' + error.message); return }
    setQuotes(prev => prev.filter(x => x.id !== q.id))
  }

  async function handleCopyLink(q: QuoteRow) {
    const url = `${window.location.origin}/orcamento/ver/${q.token_publico}`

    if (q.status === 'rascunho') {
      const res = await fetch('/api/orcamento/respond', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: q.token_publico, status: 'enviado' }),
      })
      if (res.ok) {
        setQuotes(prev => prev.map(x =>
          x.id === q.id ? { ...x, status: 'enviado' as QuoteStatus } : x
        ))
      }
    }

    await navigator.clipboard.writeText(url)
    setCopiedId(q.id)
    setTimeout(() => setCopiedId(null), 2000)
  }

  /** Envia o PDF do orçamento na conversa de WhatsApp do cliente (ver enviarOrcamentoWhatsapp). */
  async function handleEnviarWhatsapp(q: QuoteRow) {
    setEnviandoId(q.id)
    try {
      const novoStatus = await enviarOrcamentoWhatsapp(q.id)
      setQuotes(prev => prev.map(x => x.id === q.id ? { ...x, status: novoStatus } : x))
      setEnviadoId(q.id)
      setTimeout(() => setEnviadoId(null), 3000)
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Erro ao enviar o orçamento.')
    } finally {
      setEnviandoId(null)
    }
  }

  return (
    <div className="flex flex-col flex-1 overflow-hidden">

      {/* Header */}
      <header className="bg-white shrink-0" style={{ padding: '16px 26px', borderBottom: '1px solid #E9E5D8' }}>
        <div className="flex items-center justify-between">
          <div>
            <h1 style={{ fontSize: '19px', fontWeight: 900, color: '#25402C' }}>Orçamentos</h1>
            <p style={{ fontSize: '11.5px', fontWeight: 600, color: '#9AA79C', marginTop: 2 }}>Crie e acompanhe propostas de vacinas e serviços</p>
          </div>
          <button
            onClick={() => { setEditing(null); setModalOpen(true) }}
            className="flex items-center gap-1.5 text-white transition-colors"
            style={{ fontSize: '13.5px', fontWeight: 800, padding: '10px 20px', borderRadius: '999px', background: '#3E9849', boxShadow: '0 5px 14px -6px rgba(62,152,73,0.55)' }}
            onMouseEnter={e => (e.currentTarget.style.background = '#35853F')}
            onMouseLeave={e => (e.currentTarget.style.background = '#3E9849')}
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Novo orçamento
          </button>
        </div>
      </header>

      {/* Stats */}
      <div className="bg-white flex items-center gap-6 shrink-0" style={{ padding: '12px 26px', borderBottom: '1px solid #E9E5D8' }}>
        <StatCard label="Total" value={stats.total} />
        <div style={{ width: 1, height: 32, background: '#EBE7DA' }} />
        <StatCard label="Rascunhos" value={stats.rascunhos} />
        <div style={{ width: 1, height: 32, background: '#EBE7DA' }} />
        <StatCard label="Aguardando" value={stats.enviados} valueColor="#1E86C0" />
        <div style={{ width: 1, height: 32, background: '#EBE7DA' }} />
        <StatCard label="Aceitos" value={stats.aceitos} valueColor="#3E9849" />
        <div style={{ width: 1, height: 32, background: '#EBE7DA' }} />
        <StatCard label="Recusados" value={stats.recusados} valueColor="#DC2626" />
        <div style={{ width: 1, height: 32, background: '#EBE7DA' }} />
        <StatCard
          label="Valor aguardando"
          value={stats.totalAguardando > 0 ? fmtBRL.format(stats.totalAguardando) : '—'}
          valueColor={stats.totalAguardando > 0 ? '#1E86C0' : '#9AA79C'}
        />
        <div style={{ width: 1, height: 32, background: '#EBE7DA' }} />
        <StatCard
          label="Valor aceito"
          value={stats.totalAceito > 0 ? fmtBRL.format(stats.totalAceito) : '—'}
          valueColor={stats.totalAceito > 0 ? '#3E9849' : '#9AA79C'}
        />
        <div style={{ width: 1, height: 32, background: '#EBE7DA' }} />
        <StatCard
          label="Valor recusado"
          value={stats.totalRecusado > 0 ? fmtBRL.format(stats.totalRecusado) : '—'}
          valueColor={stats.totalRecusado > 0 ? '#DC2626' : '#9AA79C'}
        />
      </div>

      {/* Filters */}
      <div className="bg-white flex items-center gap-3 shrink-0 flex-wrap" style={{ padding: '10px 26px', borderBottom: '1px solid #E9E5D8' }}>
        <div className="relative">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5" style={{ color: '#9AA79C' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            placeholder="Buscar paciente ou nº…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="focus:outline-none"
            style={{ paddingLeft: 32, paddingRight: 14, paddingBlock: 7, border: '1px solid #EBE7DA', borderRadius: '999px', fontSize: '12.5px', fontWeight: 600, color: '#35543B', width: 260 }}
          />
        </div>
        <select
          value={filterSt}
          onChange={e => setFilterSt(e.target.value as QuoteStatus | 'todos')}
          className="focus:outline-none"
          style={{ border: '1px solid #EBE7DA', borderRadius: '999px', padding: '7px 12px', fontSize: '12.5px', fontWeight: 700, color: '#71856F', background: '#fff', cursor: 'pointer' }}
        >
          <option value="todos">Todos os status</option>
          {(Object.keys(QUOTE_STATUS_LABELS) as QuoteStatus[]).map(s => (
            <option key={s} value={s}>{QUOTE_STATUS_LABELS[s]}</option>
          ))}
        </select>
        <span className="ml-auto" style={{ fontSize: '11.5px', fontWeight: 700, color: '#9AA79C' }}>
          {filtered.length} orçamento{filtered.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Table */}
      <main className="flex-1 overflow-auto">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center p-8">
            <div className="flex items-center justify-center mb-4" style={{ width: 64, height: 64, borderRadius: '50%', background: '#F1EFE5' }}>
              <svg className="w-8 h-8" style={{ color: '#9AA79C' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                  d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </div>
            <p style={{ fontSize: '13px', fontWeight: 700, color: '#71856F' }}>Nenhum orçamento encontrado</p>
            <p style={{ fontSize: '11.5px', color: '#9AA79C', marginTop: 4 }}>
              Clique em &ldquo;Novo orçamento&rdquo; para começar
            </p>
          </div>
        ) : (
          <table className="w-full" style={{ fontSize: '13px' }}>
            <thead className="sticky top-0" style={{ background: '#FBFAF4', borderBottom: '1px solid #EBE7DA' }}>
              <tr>
                <th className="text-left uppercase tracking-wide px-6 py-3" style={{ fontSize: '10.5px', fontWeight: 800, color: '#9AA79C' }}>Nº</th>
                <th className="text-left uppercase tracking-wide px-4 py-3" style={{ fontSize: '10.5px', fontWeight: 800, color: '#9AA79C' }}>Paciente</th>
                <th className="text-center uppercase tracking-wide px-4 py-3" style={{ fontSize: '10.5px', fontWeight: 800, color: '#9AA79C' }}>Status</th>
                <th className="text-right uppercase tracking-wide px-4 py-3" style={{ fontSize: '10.5px', fontWeight: 800, color: '#9AA79C' }}>Total</th>
                <th className="text-left uppercase tracking-wide px-4 py-3" style={{ fontSize: '10.5px', fontWeight: 800, color: '#9AA79C' }}>Responsável</th>
                <th className="text-left uppercase tracking-wide px-4 py-3" style={{ fontSize: '10.5px', fontWeight: 800, color: '#9AA79C' }}>Data</th>
                <th className="text-left uppercase tracking-wide px-4 py-3" style={{ fontSize: '10.5px', fontWeight: 800, color: '#9AA79C' }}>Vencimento</th>
                <th className="text-right uppercase tracking-wide px-6 py-3" style={{ fontSize: '10.5px', fontWeight: 800, color: '#9AA79C' }}>Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y bg-white" style={{ borderColor: '#EBE7DA' }}>
              {filtered.map(q => (
                <tr
                  key={q.id}
                  className="transition-colors"
                  onMouseEnter={e => (e.currentTarget.style.background = '#FBFAF4')}
                  onMouseLeave={e => (e.currentTarget.style.background = '')}
                >
                  <td className="px-6 py-3.5">
                    <span style={{ fontSize: '12px', fontWeight: 800, color: '#9AA79C' }}>
                      #{String(q.numero ?? 0).padStart(4, '0')}
                    </span>
                  </td>
                  <td className="px-4 py-3.5">
                    <div className="flex items-center gap-2.5">
                      <div className="rounded-full flex items-center justify-center shrink-0" style={{ width: 30, height: 30, background: '#D6EBD2' }}>
                        <span style={{ fontSize: '11px', fontWeight: 800, color: '#35853F' }}>{patientName(q)[0]?.toUpperCase()}</span>
                      </div>
                      <span style={{ fontSize: '13px', fontWeight: 800, color: '#25402C' }}>{patientName(q)}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3.5 text-center">
                    <StatusBadge status={q.status} />
                  </td>
                  <td className="px-4 py-3.5 text-right">
                    <span style={{ fontWeight: 800, color: '#25402C' }}>
                      {q.total_calculado != null
                        ? fmtBRL.format(q.total_calculado)
                        : <span style={{ color: '#9AA79C' }}>—</span>}
                    </span>
                  </td>
                  <td className="px-4 py-3.5">
                    <span style={{ fontSize: '12px', fontWeight: 600, color: '#71856F' }}>
                      {q.responsavel?.full_name?.split(' ')[0] ?? <span style={{ color: '#9AA79C' }}>—</span>}
                    </span>
                  </td>
                  <td className="px-4 py-3.5">
                    <span style={{ fontSize: '12px', color: '#9AA79C' }}>{fmtDate(q.criado_em)}</span>
                  </td>
                  <td className="px-4 py-3.5">
                    {q.validade_ate ? (() => {
                      const hoje = new Date(); hoje.setHours(0,0,0,0)
                      const venc = new Date(q.validade_ate + 'T00:00:00'); venc.setHours(0,0,0,0)
                      const diff = Math.ceil((venc.getTime() - hoje.getTime()) / 86400000)
                      const vencido = diff < 0
                      const proximo = diff >= 0 && diff <= 1
                      return (
                        <span style={{ fontSize: '12px', fontWeight: vencido || proximo ? 700 : 400, color: vencido ? '#C05B3A' : proximo ? '#D97706' : '#9AA79C' }}>
                          {fmtDate(q.validade_ate)}
                        </span>
                      )
                    })() : <span style={{ fontSize: '12px', color: '#9AA79C' }}>—</span>}
                  </td>
                  <td className="px-6 py-3.5 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        onClick={() => { setEditing(q); setModalOpen(true) }}
                        title="Editar"
                        className="p-1.5 rounded-lg transition-colors"
                        style={{ color: '#9AA79C' }}
                        onMouseEnter={e => { e.currentTarget.style.color = '#3E9849'; e.currentTarget.style.background = '#E8F4E6' }}
                        onMouseLeave={e => { e.currentTarget.style.color = '#9AA79C'; e.currentTarget.style.background = '' }}
                      >
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                            d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                        </svg>
                      </button>
                      {q.lead_id && (
                        <button
                          onClick={() => handleEnviarWhatsapp(q)}
                          disabled={enviandoId === q.id}
                          title={enviadoId === q.id ? 'Enviado no WhatsApp!' : 'Enviar PDF no WhatsApp do cliente'}
                          className="p-1.5 rounded-lg transition-colors disabled:opacity-60"
                          style={{ color: enviadoId === q.id ? '#3E9849' : '#9AA79C', background: enviadoId === q.id ? '#E8F4E6' : '' }}
                          onMouseEnter={e => { if (enviadoId !== q.id) { e.currentTarget.style.color = '#25D366'; e.currentTarget.style.background = '#E8F4E6' } }}
                          onMouseLeave={e => { if (enviadoId !== q.id) { e.currentTarget.style.color = '#9AA79C'; e.currentTarget.style.background = '' } }}
                        >
                          {enviandoId === q.id ? (
                            <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                            </svg>
                          ) : enviadoId === q.id ? (
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                            </svg>
                          ) : (
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                            </svg>
                          )}
                        </button>
                      )}
                      <button
                        onClick={() => handleCopyLink(q)}
                        title={copiedId === q.id ? 'Link copiado!' : 'Copiar link do paciente'}
                        className="p-1.5 rounded-lg transition-colors"
                        style={{ color: copiedId === q.id ? '#3E9849' : '#9AA79C', background: copiedId === q.id ? '#E8F4E6' : '' }}
                        onMouseEnter={e => { if (copiedId !== q.id) { e.currentTarget.style.color = '#3E9849'; e.currentTarget.style.background = '#E8F4E6' } }}
                        onMouseLeave={e => { if (copiedId !== q.id) { e.currentTarget.style.color = '#9AA79C'; e.currentTarget.style.background = '' } }}
                      >
                        {copiedId === q.id ? (
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                          </svg>
                        ) : (
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                              d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                          </svg>
                        )}
                      </button>
                      {canDelete && (
                        <button
                          onClick={() => handleDelete(q)}
                          disabled={deletingId === q.id}
                          title="Excluir orçamento"
                          className="p-1.5 rounded-lg transition-colors disabled:opacity-40"
                          style={{ color: '#9AA79C' }}
                          onMouseEnter={e => { e.currentTarget.style.color = '#C05B3A'; e.currentTarget.style.background = '#F9E7E0' }}
                          onMouseLeave={e => { e.currentTarget.style.color = '#9AA79C'; e.currentTarget.style.background = '' }}
                        >
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                              d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </main>

      {modalOpen && (
        <QuoteModal
          editing={editing}
          unitId={currentUser.unit_id}
          userId={currentUser.id}
          products={products}
          templates={templates}
          leads={leads}
          paymentFees={paymentFees}
          initialPatient={editing ? null : initialPatient}
          onClose={() => { setModalOpen(false); setEditing(null); setInitialPatient(null) }}
          onSaved={handleSaved}
        />
      )}
    </div>
  )
}
