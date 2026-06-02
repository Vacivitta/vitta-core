'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { QuoteWithItems, QuoteStatus } from '@/types/database'
import { QUOTE_STATUS_LABELS, QUOTE_STATUS_COLORS } from '@/types/database'
import dynamic from 'next/dynamic'

const PdfButton = dynamic(() => import('@/components/orcamento/PdfButton'), {
  ssr: false,
  loading: () => (
    <button className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 border border-gray-200 text-gray-400 rounded-xl">
      PDF...
    </button>
  ),
})

// ─── Helpers ─────────────────────────────────────────────────────────────────

const fmtBRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' })
}
function addDays(iso: string, dias: number) {
  const d = new Date(iso)
  d.setDate(d.getDate() + dias)
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

// ─── Component ───────────────────────────────────────────────────────────────

interface Props {
  quote: QuoteWithItems
  token: string
}

export default function PublicQuoteClient({ quote: initialQuote, token }: Props) {
  const supabase = createClient()

  const [quote,        setQuote]        = useState(initialQuote)
  const [showRefuse,   setShowRefuse]   = useState(false)
  const [motivoRecusa, setMotivoRecusa] = useState('')
  const [loading,      setLoading]      = useState(false)
  const [error,        setError]        = useState('')

  const t            = quote.template
  const corPrimaria  = t?.cor_primaria  ?? '#1D9E75'
  const nomeClinica  = t?.nome_clinica  ?? 'Vitta Core'
  const validadeDias = t?.validade_dias ?? 7
  const numStr       = String(quote.numero ?? 0).padStart(4, '0')
  const patientName  = quote.lead
    ? `${quote.lead.nome}${quote.lead.sobrenome ? ` ${quote.lead.sobrenome}` : ''}`
    : quote.client
    ? `${quote.client.nome}${quote.client.sobrenome ? ` ${quote.client.sobrenome}` : ''}`
    : '—'

  const canRespond = !['aceito', 'recusado', 'expirado'].includes(quote.status)

  async function updateStatus(status: QuoteStatus, motivo?: string) {
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/orcamento/respond', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, status, motivo }),
      })
      const json = await res.json()
      if (!res.ok) { setError(json.error ?? 'Erro ao processar. Tente novamente.'); return }
      setQuote(json.quote)
      setShowRefuse(false)
    } catch {
      setError('Erro ao processar. Tente novamente.')
    } finally {
      setLoading(false)
    }
  }

  async function handleAccept() {
    await updateStatus('aceito')
  }

  async function handleRefuse() {
    if (!motivoRecusa.trim()) { setError('Informe o motivo da recusa.'); return }
    await updateStatus('recusado', motivoRecusa.trim())
  }

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4">
      <div className="max-w-xl mx-auto space-y-4">

        {/* Header card */}
        <div className="rounded-2xl overflow-hidden shadow-sm">
          <div className="h-2" style={{ backgroundColor: corPrimaria }} />
          <div className="bg-white px-6 py-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs text-gray-400 font-medium uppercase tracking-wide">{nomeClinica}</p>
                <h1 className="text-xl font-bold text-gray-900 mt-0.5">Orçamento #{numStr}</h1>
                <p className="text-xs text-gray-500 mt-1">
                  Emitido em {fmtDate(quote.criado_em)}
                  {' · '}
                  Válido até {addDays(quote.criado_em, validadeDias)}
                </p>
              </div>
              <span className={`text-[11px] font-semibold px-2.5 py-1 rounded-full shrink-0 ${QUOTE_STATUS_COLORS[quote.status]}`}>
                {QUOTE_STATUS_LABELS[quote.status]}
              </span>
            </div>

            {/* Patient */}
            <div className="mt-4 pt-4 border-t border-gray-100 flex items-center gap-3">
              <div className="w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold text-white shrink-0"
                style={{ backgroundColor: corPrimaria }}>
                {patientName[0]}
              </div>
              <div>
                <p className="text-xs text-gray-400">Paciente</p>
                <p className="text-sm font-semibold text-gray-900">{patientName}</p>
              </div>
            </div>
          </div>
        </div>

        {/* Items */}
        <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-100">
            <h2 className="text-sm font-semibold text-gray-900">Itens do Orçamento</h2>
          </div>
          <div className="divide-y divide-gray-50">
            {quote.items.map(item => (
              <div key={item.id} className="px-6 py-3.5 flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900">{item.nome_snapshot}</p>
                  <p className="text-xs text-gray-400 mt-0.5">
                    {fmtBRL.format(item.valor_snapshot)} × {item.quantidade}
                    {item.desconto > 0 && ` · ${item.desconto}% desc.`}
                  </p>
                </div>
                <span className="text-sm font-semibold text-gray-900 shrink-0">
                  {fmtBRL.format(item.valor_final)}
                </span>
              </div>
            ))}
          </div>

          {/* Total */}
          <div className="px-6 py-4 border-t border-gray-100 flex items-center justify-between bg-gray-50">
            <span className="text-sm font-semibold text-gray-600">Total</span>
            <span className="text-xl font-bold" style={{ color: corPrimaria }}>
              {fmtBRL.format(quote.total_calculado ?? quote.items.reduce((s, i) => s + i.valor_final, 0))}
            </span>
          </div>
        </div>

        {/* Condições de pagamento */}
        {quote.pacote_ativo && quote.pacote_opcoes && quote.pacote_opcoes.length > 0 && (() => {
          const fmtBRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
          const base   = quote.total_calculado ?? quote.items.reduce((s, i) => s + i.valor_final, 0)
          return (
            <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
              <div className="px-6 py-4 border-b border-gray-100">
                <h2 className="text-sm font-semibold text-gray-900">Condições de Pagamento</h2>
                <p className="text-xs text-gray-400 mt-0.5">Selecione a forma que preferir ao confirmar</p>
              </div>
              {quote.pacote_opcoes.map(o => {
                const total = Math.round(base * (1 - o.desconto / 100) * 100) / 100
                return (
                  <div key={o.id} className="flex items-center justify-between px-6 py-4 border-b border-gray-50 last:border-0">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-gray-900">{o.label}</p>
                      <p className="text-xs text-gray-400 mt-0.5">{o.metodos.join(' · ')}</p>
                      {o.desconto > 0 && (
                        <span className="inline-block mt-1 text-[11px] font-medium text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded-full">
                          {o.desconto}% de desconto
                        </span>
                      )}
                    </div>
                    <div className="text-right shrink-0 ml-4">
                      <p className="text-base font-bold" style={{ color: corPrimaria }}>
                        {fmtBRL.format(total)}
                      </p>
                    </div>
                  </div>
                )
              })}
            </div>
          )
        })()}

        {/* Observações */}
        {quote.observacoes && (
          <div className="bg-white rounded-2xl shadow-sm px-6 py-4">
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">Observações</p>
            <p className="text-sm text-gray-700">{quote.observacoes}</p>
          </div>
        )}

        {/* Feedback de status */}
        {quote.status === 'aceito' && (
          <div className="bg-emerald-50 border border-emerald-200 rounded-2xl px-6 py-5 text-center">
            <p className="text-2xl mb-2">✓</p>
            <p className="text-sm font-semibold text-emerald-800">Orçamento aceito!</p>
            <p className="text-xs text-emerald-600 mt-1">Entraremos em contato para confirmar os próximos passos.</p>
          </div>
        )}

        {quote.status === 'recusado' && (
          <div className="bg-red-50 border border-red-200 rounded-2xl px-6 py-5">
            <p className="text-sm font-semibold text-red-800">Orçamento recusado</p>
            {quote.motivo_recusa && (
              <p className="text-xs text-red-600 mt-1">{quote.motivo_recusa}</p>
            )}
          </div>
        )}

        {/* Ações */}
        {canRespond && !showRefuse && (
          <div className="bg-white rounded-2xl shadow-sm px-6 py-5 space-y-3">
            <p className="text-sm font-medium text-gray-700 text-center">Deseja aceitar este orçamento?</p>
            <div className="flex gap-3">
              <button
                onClick={handleAccept}
                disabled={loading}
                className="flex-1 py-3 text-sm font-semibold text-white rounded-xl transition-colors disabled:opacity-50"
                style={{ backgroundColor: corPrimaria }}
              >
                {loading ? 'Processando...' : 'Aceitar orçamento'}
              </button>
              <button
                onClick={() => setShowRefuse(true)}
                disabled={loading}
                className="px-4 py-3 text-sm font-medium text-gray-600 border border-gray-200 rounded-xl hover:bg-gray-50 transition-colors disabled:opacity-50"
              >
                Recusar
              </button>
            </div>
          </div>
        )}

        {canRespond && showRefuse && (
          <div className="bg-white rounded-2xl shadow-sm px-6 py-5 space-y-3">
            <p className="text-sm font-medium text-gray-700">Por que deseja recusar?</p>
            <textarea
              value={motivoRecusa}
              onChange={e => setMotivoRecusa(e.target.value)}
              rows={3}
              placeholder="Descreva o motivo..."
              className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-red-400 resize-none"
            />
            {error && <p className="text-xs text-red-600">{error}</p>}
            <div className="flex gap-3">
              <button
                onClick={handleRefuse}
                disabled={loading}
                className="flex-1 py-3 text-sm font-semibold text-white bg-red-500 rounded-xl hover:bg-red-600 transition-colors disabled:opacity-50"
              >
                {loading ? 'Processando...' : 'Confirmar recusa'}
              </button>
              <button
                onClick={() => { setShowRefuse(false); setError('') }}
                className="px-4 py-3 text-sm font-medium text-gray-600 border border-gray-200 rounded-xl hover:bg-gray-50 transition-colors"
              >
                Voltar
              </button>
            </div>
          </div>
        )}

        {error && !showRefuse && (
          <p className="text-xs text-red-600 text-center">{error}</p>
        )}

        {/* PDF */}
        <div className="flex justify-center pb-4">
          <PdfButton quote={quote} label="Baixar PDF" variant="download" />
        </div>
      </div>
    </div>
  )
}
