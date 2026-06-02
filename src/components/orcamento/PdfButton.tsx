'use client'

// Loaded via dynamic import (ssr: false) — @react-pdf runs client-side only
import { useState } from 'react'
import { PDFDownloadLink, pdf } from '@react-pdf/renderer'
import OrcamentoPDF from './OrcamentoPDF'
import type { QuoteWithItems, TemplatePageImages } from '@/types/database'

interface Props {
  quote:      QuoteWithItems
  label?:     string
  variant?:   'download' | 'preview'
  className?: string
}

// ─── Pre-fetch images as base64 to avoid CORS issues in @react-pdf ──────────

async function urlToBase64(url: string): Promise<string> {
  const res  = await fetch(url)
  const blob = await res.blob()
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload  = () => resolve(reader.result as string)
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })
}

async function resolveImages(quote: QuoteWithItems): Promise<QuoteWithItems> {
  const paginas = quote.template?.paginas_imagens as TemplatePageImages | undefined
  if (!paginas || Object.keys(paginas).length === 0) return quote

  async function tryBase64(url: string | undefined): Promise<string | undefined> {
    if (!url) return undefined
    try { return await urlToBase64(url) } catch { return url }
  }

  const resolved: TemplatePageImages = {
    capa:         await tryBase64(paginas.capa),
    encerramento: await tryBase64(paginas.encerramento),
    intro:        paginas.intro
      ? await Promise.all(paginas.intro.map(u => tryBase64(u).then(r => r ?? u)))
      : undefined,
  }

  return {
    ...quote,
    template: quote.template
      ? { ...quote.template, paginas_imagens: resolved }
      : null,
  }
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function PdfButton({ quote, label = 'Baixar PDF', variant = 'download', className }: Props) {
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState<string | null>(null)
  const numStr   = quote.numero ? String(quote.numero).padStart(4, '0') : '0000'
  const fileName = `orcamento-${numStr}.pdf`

  const base = className ?? 'flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 border border-gray-200 text-gray-600 rounded-xl hover:bg-gray-50 transition-colors'

  async function handleAction() {
    setLoading(true)
    setError(null)
    try {
      const resolved = await resolveImages(quote)
      const blob     = await pdf(<OrcamentoPDF quote={resolved} />).toBlob()
      const url      = URL.createObjectURL(blob)
      if (variant === 'preview') {
        window.open(url, '_blank')
        setTimeout(() => URL.revokeObjectURL(url), 30_000)
      } else {
        const a = document.createElement('a')
        a.href = url; a.download = fileName; a.click()
        setTimeout(() => URL.revokeObjectURL(url), 5_000)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao gerar PDF.')
    } finally {
      setLoading(false)
    }
  }

  if (error) {
    return (
      <button onClick={() => setError(null)} title={error} className={`${base} border-red-200 text-red-500`}>
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
        </svg>
        Erro — clique para tentar novamente
      </button>
    )
  }

  return (
    <button
      onClick={handleAction}
      disabled={loading}
      className={`${base} disabled:opacity-50`}
    >
      {loading ? (
        <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
      ) : variant === 'preview' ? (
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
        </svg>
      ) : (
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
        </svg>
      )}
      {loading ? 'Gerando...' : label}
    </button>
  )
}
