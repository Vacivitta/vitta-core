'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { UnitPaymentFees } from '@/types/database'
import { PAYMENT_METHOD_LABELS } from '@/types/database'

const FEE_KEYS = Object.keys(PAYMENT_METHOD_LABELS) as (keyof typeof PAYMENT_METHOD_LABELS)[]

interface Props {
  unitId:      string
  initialFees: UnitPaymentFees | null
}

export default function TaxasClient({ unitId, initialFees }: Props) {
  const supabase = createClient()

  const [fees, setFees] = useState<Record<string, number>>(() => {
    const defaults: Record<string, number> = {}
    for (const k of FEE_KEYS) defaults[k] = 0
    if (initialFees) {
      for (const k of FEE_KEYS) {
        defaults[k] = Number((initialFees as unknown as Record<string, number>)[k] ?? 0)
      }
    }
    return defaults
  })

  const [saving, setSaving] = useState(false)
  const [saved, setSaved]   = useState(false)
  const [error, setError]   = useState('')

  function setFee(key: string, value: number) {
    setFees(prev => ({ ...prev, [key]: Math.max(0, Math.min(100, value)) }))
    setSaved(false)
  }

  async function handleSave() {
    setSaving(true)
    setError('')
    setSaved(false)

    const payload: Record<string, unknown> = { unit_id: unitId }
    for (const k of FEE_KEYS) payload[k] = fees[k]

    if (initialFees) {
      const { error: err } = await supabase
        .from('unit_payment_fees')
        .update(payload)
        .eq('id', initialFees.id)
      if (err) { setError(err.message); setSaving(false); return }
    } else {
      const { error: err } = await supabase
        .from('unit_payment_fees')
        .insert(payload)
      if (err) { setError(err.message); setSaving(false); return }
    }

    setSaving(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 3000)
  }

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <header className="bg-white shrink-0" style={{ padding: '16px 26px', borderBottom: '1px solid #E9E5D8' }}>
        <div className="flex items-center justify-between">
          <div>
            <h1 style={{ fontSize: '19px', fontWeight: 900, color: '#25402C' }}>Taxas de Pagamento</h1>
            <p style={{ fontSize: '11.5px', fontWeight: 600, color: '#9AA79C', marginTop: 2 }}>
              Configure as taxas da maquininha por forma de pagamento
            </p>
          </div>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-1.5 text-white transition-colors"
            style={{
              fontSize: '13.5px', fontWeight: 800, padding: '10px 20px', borderRadius: '999px',
              background: saved ? '#16a34a' : '#3E9849',
              boxShadow: '0 5px 14px -6px rgba(62,152,73,0.55)',
              opacity: saving ? 0.6 : 1,
            }}
          >
            {saving ? (
              <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            ) : saved ? (
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            ) : null}
            {saved ? 'Salvo' : 'Salvar'}
          </button>
        </div>
      </header>

      <main className="flex-1 overflow-auto" style={{ padding: '20px 26px' }}>
        {error && (
          <p className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-xl px-3 py-2 mb-4">
            {error}
          </p>
        )}

        <div style={{ maxWidth: 520 }}>
          <div className="border border-[#EBE7DA] rounded-xl overflow-hidden">
            <div className="flex items-center px-4 py-2.5" style={{ background: '#FBFAF4', borderBottom: '1px solid #EBE7DA' }}>
              <span className="flex-1 text-[10.5px] font-bold text-[#9AA79C] uppercase tracking-wide">Forma de pagamento</span>
              <span className="w-24 text-center text-[10.5px] font-bold text-[#9AA79C] uppercase tracking-wide">Taxa (%)</span>
            </div>

            {FEE_KEYS.map((key, i) => (
              <div
                key={key}
                className="flex items-center px-4 py-3"
                style={{ borderBottom: i < FEE_KEYS.length - 1 ? '1px solid #EBE7DA' : undefined }}
              >
                <span className="flex-1 text-sm font-medium text-[#25402C]">
                  {PAYMENT_METHOD_LABELS[key]}
                </span>
                <div className="relative w-24">
                  <input
                    type="number"
                    min="0"
                    max="100"
                    step="0.01"
                    value={fees[key]}
                    onChange={e => setFee(key, parseFloat(e.target.value) || 0)}
                    className="w-full text-sm text-center border border-[#EBE7DA] rounded-lg pl-2 pr-6 py-1.5 focus:outline-none focus:ring-1 focus:ring-[#3E9849] focus:border-[#3E9849]"
                  />
                  <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-[#9AA79C]">%</span>
                </div>
              </div>
            ))}
          </div>

          <p className="text-[11px] text-[#9AA79C] mt-3">
            As taxas configuradas aqui serão usadas para calcular a margem de lucro nos orçamentos.
          </p>
        </div>
      </main>
    </div>
  )
}
