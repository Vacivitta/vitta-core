'use client'

import { useState } from 'react'
import { createPortal } from 'react-dom'
import type { QuoteStatus } from '@/types/database'
import { enviarOrcamentoWhatsapp, legendaPadraoOrcamento } from '@/lib/orcamento/enviar-whatsapp'

interface Props {
  quote: {
    id:            string
    numero:        number | null
    token_publico: string
    /** Nome usado na saudação do texto sugerido */
    nome:          string
  }
  onClose:   () => void
  onEnviado: (status: QuoteStatus) => void
}

/**
 * Confirma o envio do PDF do orçamento no WhatsApp: o texto que vai junto vem
 * sugerido e pode ser editado, ou desligado para mandar só o arquivo.
 * Renderiza no <body> acima do painel do lead e dos diálogos dele (z 70).
 */
export default function EnviarOrcamentoDialog({ quote, onClose, onEnviado }: Props) {
  const link = `${window.location.origin}/orcamento/ver/${quote.token_publico}`
  const [texto,     setTexto]     = useState(() => legendaPadraoOrcamento(quote.numero, quote.nome, link))
  const [semTexto,  setSemTexto]  = useState(false)
  const [enviando,  setEnviando]  = useState(false)
  const [erro,      setErro]      = useState('')

  const legenda   = semTexto ? '' : texto
  const semLink   = !legenda.includes(link)
  const numero    = String(quote.numero ?? 0).padStart(4, '0')

  async function enviar() {
    setEnviando(true); setErro('')
    try {
      onEnviado(await enviarOrcamentoWhatsapp(quote.id, legenda))
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao enviar o orçamento.')
      setEnviando(false)
    }
  }

  return createPortal(
    <div style={{ position: 'relative', zIndex: 70 }}>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40" onClick={() => { if (!enviando) onClose() }}>
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-5 space-y-3" onClick={e => e.stopPropagation()}>
          <h3 className="text-sm font-bold text-gray-800">Enviar orçamento nº {numero} no WhatsApp</h3>

          <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer select-none">
            <input type="checkbox" checked={semTexto} onChange={e => setSemTexto(e.target.checked)} disabled={enviando} />
            Enviar só o PDF, sem texto
          </label>

          {!semTexto && (
            <textarea
              value={texto}
              onChange={e => setTexto(e.target.value)}
              disabled={enviando}
              rows={5}
              aria-label="Texto enviado com o PDF"
              className="w-full text-sm border border-gray-200 rounded-xl p-3 outline-none focus:border-green-500 resize-y"
            />
          )}

          {semLink && (
            <p className="text-xs text-amber-700">O link de aprovação não vai na mensagem: o cliente recebe só o PDF.</p>
          )}
          {erro && <p className="text-xs text-red-600">{erro}</p>}

          <div className="flex gap-2">
            <button
              onClick={onClose}
              disabled={enviando}
              className="flex-1 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-xl transition-colors disabled:opacity-60"
            >
              Cancelar
            </button>
            <button
              onClick={enviar}
              disabled={enviando}
              className="flex-1 py-2 text-sm font-semibold text-white rounded-xl disabled:opacity-60 transition-colors"
              style={{ background: '#25D366' }}
            >
              {enviando ? 'Gerando e enviando...' : 'Enviar'}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}
